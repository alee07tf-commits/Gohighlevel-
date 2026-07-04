const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../auth');
const snapshots = require('../services/snapshots');

const router = express.Router();
router.use(requireAuth);

// Default account-level custom values seeded from the sub-account profile, so
// snapshot templates ({{custom_values.business_name}}, …) resolve immediately.
function defaultCustomValues({ name, company, phone, email, website }) {
  return [
    { key: 'business_name', label: 'Nombre del negocio', value: name || company || '' },
    { key: 'main_phone', label: 'Teléfono principal', value: phone || '' },
    { key: 'business_email', label: 'Email del negocio', value: email || '' },
    { key: 'website', label: 'Sitio web', value: website || '' },
    { key: 'address', label: 'Dirección', value: '' },
    { key: 'booking_link', label: 'Enlace de reservas', value: '' },
  ];
}

router.get('/', async (req, res) => {
  res.json(await db.all('SELECT * FROM locations WHERE agency_id = ? ORDER BY id', [req.user.agency_id]));
});

router.post('/', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { name, company, phone, email, website, timezone } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  // Resolve the snapshot to auto-load: explicit snapshot_id, else the agency's
  // default. `snapshot_id: 0/null` with no default → provision an empty account.
  let snap = null;
  if (req.body?.snapshot_id) {
    snap = await db.get('SELECT * FROM snapshots WHERE id = ? AND agency_id = ?', [req.body.snapshot_id, req.user.agency_id]);
  } else if (req.body?.snapshot_id !== 0) {
    snap = await db.get('SELECT * FROM snapshots WHERE agency_id = ? AND is_default = 1 ORDER BY id DESC LIMIT 1', [req.user.agency_id]);
  }
  const snapData = snap ? (() => { try { return JSON.parse(snap.data || '{}'); } catch { return {}; } })() : null;

  const result = await db.tx(async (t) => {
    const locId = await t.insert(
      `INSERT INTO locations (agency_id, name, company, phone, email, website, timezone, source_snapshot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.agency_id, name, company || '', phone || '', email || '', website || '', timezone || 'UTC', snap ? snap.id : null]
    );

    // Auto-load the snapshot's structural config.
    const provisioned = snapData ? await snapshots.applySnapshot(t, locId, snapData) : {};

    // Seed default custom values (business profile), skipping any the snapshot
    // already provided so we don't clobber template-specific values.
    let cvSeeded = provisioned.custom_values || 0;
    for (const cv of defaultCustomValues({ name, company, phone, email, website })) {
      const exists = await t.get('SELECT id FROM custom_values WHERE location_id = ? AND key = ?', [locId, cv.key]);
      if (exists) continue;
      await t.run('INSERT INTO custom_values (location_id, key, label, value) VALUES (?, ?, ?, ?)', [
        locId, cv.key, cv.label, cv.value,
      ]);
      cvSeeded++;
    }

    // Optionally create the client user and scope them to this sub-account.
    if (req.body?.client_email && req.body?.client_password) {
      const dupe = await t.get('SELECT id FROM users WHERE email = ?', [req.body.client_email]);
      if (!dupe) {
        const uid = await t.insert(
          'INSERT INTO users (agency_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
          [req.user.agency_id, req.body.client_name || name, req.body.client_email, bcrypt.hashSync(req.body.client_password, 10), 'member']
        );
        await t.run('INSERT INTO user_locations (user_id, location_id) VALUES (?, ?)', [uid, locId]);
      }
    }

    return { locId, provisioned: { ...provisioned, custom_values: cvSeeded }, snapshot: snap ? snap.name : null };
  });

  const location = await db.get('SELECT * FROM locations WHERE id = ?', [result.locId]);
  res.status(201).json({ ...location, provisioned: result.provisioned, snapshot: result.snapshot });
});

router.put('/:id', async (req, res) => {
  const loc = await db.get('SELECT * FROM locations WHERE id = ? AND agency_id = ?', [
    req.params.id,
    req.user.agency_id,
  ]);
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  const m = { ...loc, ...req.body };
  await db.run(
    `UPDATE locations SET name=?, company=?, phone=?, email=?, website=?, timezone=?,
     brand_color=?, logo_url=?, review_link_google=?, review_link_facebook=?,
     briefing_enabled=?, briefing_hour=?, briefing_email=?, ai_agent_enabled=?, ai_agent_prompt=?, missed_call_text=? WHERE id=?`,
    [
      m.name, m.company, m.phone, m.email, m.website, m.timezone,
      m.brand_color || '#4f46e5', m.logo_url || '', m.review_link_google || '', m.review_link_facebook || '',
      m.briefing_enabled ? 1 : 0, Number(m.briefing_hour) || 8, m.briefing_email || '',
      m.ai_agent_enabled ? 1 : 0, m.ai_agent_prompt || '', m.missed_call_text || '',
      loc.id,
    ]
  );
  // (Re)schedule the daily briefing when it's enabled.
  if (m.briefing_enabled) {
    const scheduler = require('../services/scheduler');
    await scheduler.scheduleDailyBriefing(loc.id, Number(m.briefing_hour) || 8);
  }
  res.json(await db.get('SELECT * FROM locations WHERE id = ?', [loc.id]));
});

// ---- Agency team management ----
router.get('/team/users', async (req, res) => {
  res.json(
    await db.all('SELECT id, name, email, role, created_at FROM users WHERE agency_id = ? ORDER BY id', [
      req.user.agency_id,
    ])
  );
});

router.post('/team/users', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (await db.get('SELECT id FROM users WHERE email = ?', [email]))
    return res.status(409).json({ error: 'Email already registered' });
  const id = await db.insert(
    'INSERT INTO users (agency_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    [req.user.agency_id, name, email, bcrypt.hashSync(password, 10), role === 'admin' ? 'admin' : 'member']
  );
  res.status(201).json(await db.get('SELECT id, name, email, role FROM users WHERE id = ?', [id]));
});

router.delete('/team/users/:id', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  const info = await db.run('DELETE FROM users WHERE id = ? AND agency_id = ?', [req.params.id, req.user.agency_id]);
  if (!info.changes) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

// ---- User ↔ sub-account assignments (granular access for members) ----
router.get('/team/users/:id/locations', async (req, res) => {
  const rows = await db.all('SELECT location_id FROM user_locations WHERE user_id = ?', [req.params.id]);
  res.json(rows.map((r) => r.location_id));
});

router.put('/team/users/:id/locations', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const target = await db.get('SELECT * FROM users WHERE id = ? AND agency_id = ?', [req.params.id, req.user.agency_id]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const ids = Array.isArray(req.body?.location_ids) ? req.body.location_ids.map(Number).filter(Boolean) : [];
  await db.tx(async (t) => {
    await t.run('DELETE FROM user_locations WHERE user_id = ?', [target.id]);
    for (const lid of ids) {
      const loc = await t.get('SELECT id FROM locations WHERE id = ? AND agency_id = ?', [lid, req.user.agency_id]);
      if (loc) await t.run('INSERT INTO user_locations (user_id, location_id) VALUES (?, ?)', [target.id, lid]);
    }
  });
  res.json({ ok: true, location_ids: ids });
});

module.exports = router;
