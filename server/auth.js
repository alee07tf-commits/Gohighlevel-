const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'leadflow-dev-secret-change-me';

function signToken(user) {
  return jwt.sign({ id: user.id, agency_id: user.agency_id, role: user.role }, JWT_SECRET, {
    expiresIn: '7d',
  });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, agency_id, name, email, role FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Resolves the sub-account (location) from the X-Location-Id header and
// verifies it belongs to the authenticated user's agency.
function requireLocation(req, res, next) {
  const locationId = Number(req.headers['x-location-id']);
  if (!locationId) return res.status(400).json({ error: 'X-Location-Id header required' });
  const location = db
    .prepare('SELECT * FROM locations WHERE id = ? AND agency_id = ?')
    .get(locationId, req.user.agency_id);
  if (!location) return res.status(404).json({ error: 'Location not found in your agency' });
  req.location = location;
  next();
}

module.exports = { signToken, requireAuth, requireLocation, JWT_SECRET };
