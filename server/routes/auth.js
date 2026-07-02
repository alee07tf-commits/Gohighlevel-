const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../auth');

const router = express.Router();

// Register creates the agency, its admin user, and a first sub-account.
router.post('/register', (req, res) => {
  const { agency_name, name, email, password, location_name } = req.body || {};
  if (!agency_name || !name || !email || !password)
    return res.status(400).json({ error: 'agency_name, name, email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'Email already registered' });

  const result = db.transaction(() => {
    const agency = db.prepare('INSERT INTO agencies (name) VALUES (?)').run(agency_name);
    const user = db
      .prepare('INSERT INTO users (agency_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(agency.lastInsertRowid, name, email, bcrypt.hashSync(password, 10), 'admin');
    const location = db
      .prepare('INSERT INTO locations (agency_id, name) VALUES (?, ?)')
      .run(agency.lastInsertRowid, location_name || 'My First Sub-Account');
    return { userId: user.lastInsertRowid, locationId: location.lastInsertRowid };
  })();

  const user = db.prepare('SELECT id, agency_id, name, email, role FROM users WHERE id = ?').get(result.userId);
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  const { password_hash, ...safe } = user;
  res.json({ token: signToken(user), user: safe });
});

router.get('/me', requireAuth, (req, res) => {
  const agency = db.prepare('SELECT * FROM agencies WHERE id = ?').get(req.user.agency_id);
  const locations = db.prepare('SELECT * FROM locations WHERE agency_id = ?').all(req.user.agency_id);
  res.json({ user: req.user, agency, locations });
});

module.exports = router;
