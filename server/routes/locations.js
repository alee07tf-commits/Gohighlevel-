const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../auth');
const provisioning = require('../services/provisioning');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(await db.all('SELECT * FROM locations WHERE agency_id = ? ORDER BY id', [req.user.agency_id]));
});

router.post('/', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { name, company, phone, email, website, timezone } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const result = await provisioning.provisionSubAccount({
    agencyId: req.user.agency_id,
    profile: { name, company, phone, email, website, timezone },
    snapshotId: req.body?.snapshot_id, // undefined → agency default; 0 → empty
    client:
      req.body?.client_email && req.body?.client_password
        ? { name: req.body.client_name, email: req.body.client_email, password: req.body.client_password }
        : null,
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

// ---- Granular module permissions for a member (empty list = full access) ----
const { PERMISSION_MODULES } = require('../auth');

router.get('/team/users/:id/permissions', async (req, res) => {
  const target = await db.get('SELECT permissions FROM users WHERE id = ? AND agency_id = ?', [req.params.id, req.user.agency_id]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  let allowed = [];
  try { allowed = target.permissions ? JSON.parse(target.permissions) : []; } catch { allowed = []; }
  res.json({ modules: PERMISSION_MODULES, allowed });
});

router.put('/team/users/:id/permissions', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const target = await db.get('SELECT * FROM users WHERE id = ? AND agency_id = ?', [req.params.id, req.user.agency_id]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  // Keep only known module keys; an empty array clears restrictions (full access).
  const allowed = Array.isArray(req.body?.allowed)
    ? [...new Set(req.body.allowed.filter((m) => PERMISSION_MODULES.includes(m)))]
    : [];
  await db.run('UPDATE users SET permissions = ? WHERE id = ?', [allowed.length ? JSON.stringify(allowed) : '', target.id]);
  res.json({ ok: true, allowed });
});

module.exports = router;
