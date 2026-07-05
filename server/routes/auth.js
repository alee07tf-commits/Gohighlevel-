const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../auth');

const router = express.Router();

// Register creates the agency, its admin user, and a first sub-account.
router.post('/register', async (req, res) => {
  const { agency_name, name, email, password, location_name } = req.body || {};
  if (!agency_name || !name || !email || !password)
    return res.status(400).json({ error: 'agency_name, name, email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (await db.get('SELECT id FROM users WHERE email = ?', [email]))
    return res.status(409).json({ error: 'Email already registered' });

  const userId = await db.tx(async (t) => {
    const agencyId = await t.insert('INSERT INTO agencies (name) VALUES (?)', [agency_name]);
    const uid = await t.insert(
      'INSERT INTO users (agency_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [agencyId, name, email, bcrypt.hashSync(password, 10), 'admin']
    );
    await t.insert('INSERT INTO locations (agency_id, name) VALUES (?, ?)', [
      agencyId,
      location_name || 'My First Sub-Account',
    ]);
    return uid;
  });

  const user = await db.get('SELECT id, agency_id, name, email, role FROM users WHERE id = ?', [userId]);
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email || '']);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  const { password_hash, ...safe } = user;
  res.json({ token: signToken(user), user: safe });
});

router.get('/me', requireAuth, async (req, res) => {
  // agency = the effective scope (may be a client we've drilled into);
  // homeAgency = the tenant the user actually belongs to; parentAgency lets the
  // UI offer "← back" when acting inside a child.
  const agency = await db.get('SELECT * FROM agencies WHERE id = ?', [req.user.agency_id]);
  const homeAgency =
    req.user.homeAgencyId === req.user.agency_id
      ? agency
      : await db.get('SELECT id, name, slug, brand_color, logo_url FROM agencies WHERE id = ?', [req.user.homeAgencyId]);
  const parentAgency =
    req.actingAsChild && agency.parent_agency_id
      ? await db.get('SELECT id, name FROM agencies WHERE id = ?', [agency.parent_agency_id])
      : null;
  const { client_count } = await db.get(
    'SELECT COUNT(*)::int AS client_count FROM agencies WHERE parent_agency_id = ?',
    [req.user.agency_id]
  );
  const locations = await db.all('SELECT * FROM locations WHERE agency_id = ?', [req.user.agency_id]);
  res.json({
    user: req.user,
    agency,
    homeAgency,
    parentAgency,
    actingAsChild: req.actingAsChild,
    clientCount: client_count,
    canManageClients: req.user.role === 'admin',
    locations,
  });
});

module.exports = router;
