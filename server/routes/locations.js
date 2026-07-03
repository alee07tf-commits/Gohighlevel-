const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(await db.all('SELECT * FROM locations WHERE agency_id = ? ORDER BY id', [req.user.agency_id]));
});

router.post('/', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { name, company, phone, email, website, timezone } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = await db.insert(
    `INSERT INTO locations (agency_id, name, company, phone, email, website, timezone)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user.agency_id, name, company || '', phone || '', email || '', website || '', timezone || 'UTC']
  );
  res.status(201).json(await db.get('SELECT * FROM locations WHERE id = ?', [id]));
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
     briefing_enabled=?, briefing_hour=?, briefing_email=? WHERE id=?`,
    [
      m.name, m.company, m.phone, m.email, m.website, m.timezone,
      m.brand_color || '#4f46e5', m.logo_url || '', m.review_link_google || '', m.review_link_facebook || '',
      m.briefing_enabled ? 1 : 0, Number(m.briefing_hour) || 8, m.briefing_email || '',
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

module.exports = router;
