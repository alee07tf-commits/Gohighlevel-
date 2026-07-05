const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../auth');
const { rateLimit } = require('../middleware/security');

const router = express.Router();

// Brute-force protection on credential + reset endpoints.
const authLimiter = rateLimit({ windowMs: 60_000, max: 10, bucket: 'auth' });
const resetLimiter = rateLimit({ windowMs: 60_000, max: 5, bucket: 'reset' });

// Register creates the agency, its admin user, and a first sub-account.
router.post('/register', authLimiter, async (req, res) => {
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

router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email || '']);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  const { password_hash, ...safe } = user;
  res.json({ token: signToken(user), user: safe });
});

// ---- Forgot password ----
// Always responds 200 so it never reveals whether an email exists. When it does,
// a single-use token (1h) is created and the reset link emailed (best-effort).
router.post('/forgot', resetLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const user = email ? await db.get('SELECT * FROM users WHERE email = ?', [email]) : null;
  if (user) {
    const token = crypto.randomBytes(24).toString('hex');
    await db.run(
      "INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, now() + interval '1 hour')",
      [token, user.id]
    );
    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/#/reset/${token}`;
    try {
      const loc = await db.get('SELECT id, name FROM locations WHERE agency_id = ? ORDER BY id LIMIT 1', [user.agency_id]);
      const providers = require('../services/providers');
      await providers.deliverEmail({
        to: user.email, subject: 'Restablece tu contraseña', fromName: (loc && loc.name) || 'Upcro',
        text: `Hola ${user.name},\n\nPara restablecer tu contraseña abre este enlace (caduca en 1 hora):\n${link}\n\nSi no lo solicitaste, ignora este mensaje.`,
        locationId: loc && loc.id,
      });
    } catch { /* best-effort; still return ok */ }
  }
  res.json({ ok: true });
});

router.post('/reset', resetLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });
  if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const row = await db.get('SELECT * FROM password_resets WHERE token = ?', [token]);
  if (!row || new Date(row.expires_at).getTime() < Date.now())
    return res.status(400).json({ error: 'Enlace no válido o caducado. Solicita uno nuevo.' });
  await db.tx(async (t) => {
    await t.run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(password, 10), row.user_id]);
    await t.run('DELETE FROM password_resets WHERE user_id = ?', [row.user_id]);
  });
  const user = await db.get('SELECT id, agency_id, name, email, role FROM users WHERE id = ?', [row.user_id]);
  res.json({ ok: true, token: signToken(user), user });
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
