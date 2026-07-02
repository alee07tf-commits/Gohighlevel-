const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM locations WHERE agency_id = ? ORDER BY id').all(req.user.agency_id));
});

router.post('/', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { name, company, phone, email, website, timezone } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare(
      `INSERT INTO locations (agency_id, name, company, phone, email, website, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.agency_id, name, company || '', phone || '', email || '', website || '', timezone || 'UTC');
  res.status(201).json(db.prepare('SELECT * FROM locations WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const loc = db
    .prepare('SELECT * FROM locations WHERE id = ? AND agency_id = ?')
    .get(req.params.id, req.user.agency_id);
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  const { name, company, phone, email, website, timezone } = { ...loc, ...req.body };
  db.prepare(
    'UPDATE locations SET name=?, company=?, phone=?, email=?, website=?, timezone=? WHERE id=?'
  ).run(name, company, phone, email, website, timezone, loc.id);
  res.json(db.prepare('SELECT * FROM locations WHERE id = ?').get(loc.id));
});

// ---- Agency team management ----
router.get('/team/users', (req, res) => {
  res.json(
    db.prepare('SELECT id, name, email, role, created_at FROM users WHERE agency_id = ? ORDER BY id').all(req.user.agency_id)
  );
});

router.post('/team/users', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'Email already registered' });
  const info = db
    .prepare('INSERT INTO users (agency_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.agency_id, name, email, bcrypt.hashSync(password, 10), role === 'admin' ? 'admin' : 'member');
  res.status(201).json(db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/team/users/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  const info = db
    .prepare('DELETE FROM users WHERE id = ? AND agency_id = ?')
    .run(req.params.id, req.user.agency_id);
  if (!info.changes) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

module.exports = router;
