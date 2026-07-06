const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'upcro-dev-secret-change-me';
const API_KEY_PREFIX = 'lf_';

// Maps an API mount path to the nav module key used in per-user permissions.
// Endpoints not listed here are always allowed (infra: auth, locations,
// notifications, custom fields/values, settings, billing, etc.).
const MODULE_BY_BASE = {
  '/api/contacts': 'contacts', '/api/conversations': 'conversations', '/api/pipelines': 'pipelines',
  '/api/calendars': 'calendar', '/api/marketing': 'marketing', '/api/workflows': 'automations',
  '/api/funnels': 'funnels', '/api/forms': 'forms', '/api/surveys': 'surveys', '/api/payments': 'payments',
  '/api/documents': 'documents', '/api/prospecting': 'prospecting', '/api/reputation': 'reputation',
  '/api/tasks': 'tasks', '/api/training': 'training', '/api/community': 'community', '/api/analytics': 'analytics',
  '/api/apps': 'marketplace',
};
// The set of gated module keys, exposed so the team UI can offer them.
const PERMISSION_MODULES = [...new Set(Object.values(MODULE_BY_BASE))];

// Public API keys: a random secret shown once, stored only as a SHA-256 hash.
function generateApiKey() {
  const key = API_KEY_PREFIX + crypto.randomBytes(24).toString('hex');
  return { key, prefix: key.slice(0, 10), hash: hashKey(key) };
}
function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

// Resolves an API key from headers (X-Api-Key or `Authorization: Bearer lf_…`).
async function resolveApiKey(req) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const raw = req.headers['x-api-key'] || (bearer.startsWith(API_KEY_PREFIX) ? bearer : '');
  if (!raw) return null;
  const row = await db.get('SELECT * FROM api_keys WHERE key_hash = ?', [hashKey(raw)]);
  if (!row) return { invalid: true };
  db.run('UPDATE api_keys SET last_used_at = now() WHERE id = ?', [row.id]).catch(() => {});
  return { agency_id: row.agency_id };
}

function signToken(user) {
  return jwt.sign({ id: user.id, agency_id: user.agency_id, role: user.role }, JWT_SECRET, {
    expiresIn: '7d',
  });
}

// ---- Recursive tenancy helpers (Phase 4) ----
// Agencies form a tree via agencies.parent_agency_id. "Scope" for a request is
// an *effective* agency: the user's own agency by default, or — when the
// X-Agency-Id header is present — a descendant the user has drilled into
// (Upcross entering one of its clients, a client entering its sub-client…).

// Chain from an agency up to the root: [agencyId, parent, grandparent, …].
async function ancestorIds(agencyId) {
  const chain = [];
  let cur = Number(agencyId);
  // Depth cap guards against a cycle from bad data.
  for (let i = 0; cur && i < 64; i++) {
    chain.push(cur);
    const row = await db.get('SELECT parent_agency_id FROM agencies WHERE id = ?', [cur]);
    cur = row && row.parent_agency_id ? Number(row.parent_agency_id) : null;
  }
  return chain;
}

// True when `agencyId` is `rootId` itself or any descendant of it — i.e. a user
// homed at `rootId` is allowed to act within `agencyId`.
async function isInSubtree(agencyId, rootId) {
  if (Number(agencyId) === Number(rootId)) return true;
  return (await ancestorIds(agencyId)).includes(Number(rootId));
}

async function requireAuth(req, res, next) {
  // Public API key auth (external apps / Zapier / Make). Scope is fixed to the
  // key's agency; a synthetic admin user is attached so routes work unchanged.
  const apiAuth = await resolveApiKey(req);
  if (apiAuth) {
    if (apiAuth.invalid) return res.status(401).json({ error: 'Invalid API key' });
    req.user = { id: null, agency_id: apiAuth.agency_id, homeAgencyId: apiAuth.agency_id, name: 'API', email: '', role: 'admin' };
    req.actingAsChild = false;
    req.apiKey = true;
    return next();
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.get('SELECT id, agency_id, name, email, role, permissions FROM users WHERE id = ?', [payload.id]);
    if (!user) return res.status(401).json({ error: 'User not found' });

    // Granular per-module permissions (members only; empty = full access).
    if (user.role === 'member' && user.permissions) {
      let allowed = [];
      try { allowed = JSON.parse(user.permissions); } catch { allowed = []; }
      if (Array.isArray(allowed) && allowed.length) {
        const mod = MODULE_BY_BASE[req.baseUrl];
        if (mod && !allowed.includes(mod)) {
          return res.status(403).json({ error: 'No tienes acceso a este módulo' });
        }
      }
    }

    // Home agency = the tenant the user belongs to. Effective agency = the one
    // this request operates on (may be a descendant when drilling into a client).
    const homeAgencyId = user.agency_id;
    let effectiveAgencyId = homeAgencyId;
    const requested = Number(req.headers['x-agency-id']);
    if (requested && requested !== homeAgencyId) {
      // Only admins may drill into a client (child) tenant; and only within
      // their own subtree.
      if (user.role !== 'admin') return res.status(403).json({ error: 'Solo los administradores pueden gestionar clientes' });
      if (!(await isInSubtree(requested, homeAgencyId)))
        return res.status(403).json({ error: 'No tienes acceso a esa cuenta' });
      effectiveAgencyId = requested;
    }

    user.homeAgencyId = homeAgencyId;
    user.agency_id = effectiveAgencyId; // every downstream route scopes by this
    req.user = user;
    req.actingAsChild = effectiveAgencyId !== homeAgencyId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Resolves the sub-account (location) from the X-Location-Id header and
// verifies it belongs to the authenticated user's (effective) agency. Members
// with explicit assignments are restricted to those sub-accounts; members with
// no assignments (and all admins) can access every location in the agency.
async function requireLocation(req, res, next) {
  const locationId = Number(req.headers['x-location-id']);
  if (!locationId) return res.status(400).json({ error: 'X-Location-Id header required' });
  const location = await db.get('SELECT * FROM locations WHERE id = ? AND agency_id = ?', [
    locationId,
    req.user.agency_id,
  ]);
  if (!location) return res.status(404).json({ error: 'Location not found in your agency' });
  if (req.user.role !== 'admin') {
    const assignments = await db.all('SELECT location_id FROM user_locations WHERE user_id = ?', [req.user.id]);
    if (assignments.length && !assignments.some((a) => a.location_id === locationId))
      return res.status(403).json({ error: 'No tienes acceso a esta sub-cuenta' });
  }
  req.location = location;
  next();
}

module.exports = { signToken, requireAuth, requireLocation, ancestorIds, isInSubtree, generateApiKey, hashKey, JWT_SECRET, PERMISSION_MODULES };
