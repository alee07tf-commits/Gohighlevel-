// Native app marketplace (v3.1). Lists first-party integrations, starts the
// OAuth handshake, receives the provider callback and stores the connection.
// The public OAuth callback is defined BEFORE requireAuth so the provider's
// browser redirect (which carries no session) can reach it; it trusts the
// HMAC-signed `state` minted at connect time to bind back to the location.
const express = require('express');
const db = require('../db');
const apps = require('../services/apps');
const secretbox = require('../services/secretbox');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();

// Our public redirect target, registered once with each provider. Prefers an
// explicit PUBLIC_URL, else derives from the request.
function callbackUrl(req) {
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/api/apps/oauth/callback`;
}

// Exchange an authorization code for tokens. Network + real credentials
// required; returns { ok, tokens } or { ok:false, error }.
async function exchangeCode(app, { code, redirectUri, shop }) {
  try {
    let tokenUrl = app.token;
    if (app.needsShop && shop) tokenUrl = tokenUrl.replace('{shop}', shop);
    const body = new URLSearchParams({
      client_id: apps.clientId(app),
      client_secret: apps.clientSecret(app),
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!resp.ok) return { ok: false, error: json.error_description || json.error || `HTTP ${resp.status}` };
    return { ok: true, tokens: json };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---- PUBLIC OAuth callback (no auth; validated by signed state) ----
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const fail = (msg) => res.redirect(`/?integration_error=${encodeURIComponent(msg)}#/marketplace`);
  if (error) return fail(error_description || error);
  const payload = apps.verifyState(state);
  if (!payload) return fail('invalid_state');
  // Freshness: 15 min. (Date.now is fine here — request-time, not workflow.)
  if (Date.now() - Number(payload.ts) > 15 * 60 * 1000) return fail('expired_state');
  const app = apps.get(payload.app);
  if (!app) return fail('unknown_app');
  const loc = await db.get('SELECT id FROM locations WHERE id = ?', [payload.loc]);
  if (!loc) return fail('unknown_location');

  const result = await exchangeCode(app, { code, redirectUri: callbackUrl(req), shop: payload.shop });
  if (!result.ok) return fail(`token_exchange_failed: ${result.error}`);

  const tk = result.tokens;
  const expiresAt = tk.expires_in ? new Date(Date.now() + Number(tk.expires_in) * 1000).toISOString() : null;
  await storeConnection(payload.loc, app.key, {
    access_token: tk.access_token || '',
    refresh_token: tk.refresh_token || '',
    scopes: tk.scope || app.scopes || '',
    external_id: tk.stripe_user_id || tk.account_id || payload.shop || '',
    display_name: app.name,
    expires_at: expiresAt,
    data: { shop: payload.shop || '' },
  });
  res.redirect(`/?connected=${app.key}#/marketplace`);
});

// Upsert a connection (tokens encrypted at rest).
async function storeConnection(locationId, appKey, c) {
  await db.run(
    `INSERT INTO connected_accounts
       (location_id, app, external_id, display_name, access_token, refresh_token, scopes, data, status, expires_at, connected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, now())
     ON CONFLICT (location_id, app) DO UPDATE SET
       external_id = EXCLUDED.external_id, display_name = EXCLUDED.display_name,
       access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
       scopes = EXCLUDED.scopes, data = EXCLUDED.data, status = 'connected',
       expires_at = EXCLUDED.expires_at, connected_at = now()`,
    [
      locationId, appKey, c.external_id || '', c.display_name || '',
      c.access_token ? secretbox.encrypt({ v: c.access_token }) : '',
      c.refresh_token ? secretbox.encrypt({ v: c.refresh_token }) : '',
      c.scopes || '', JSON.stringify(c.data || {}), c.expires_at || null,
    ]
  );
}

// ---- Authenticated marketplace API ----
router.use(requireAuth);

// Marketplace: catalog + this sub-account's connections (tokens never leaked).
router.get('/', requireLocation, async (req, res) => {
  const rows = await db.all(
    `SELECT id, app, external_id, display_name, scopes, status, expires_at, connected_at, data
       FROM connected_accounts WHERE location_id = ? ORDER BY connected_at DESC`,
    [req.location.id]
  );
  const connected = {};
  for (const r of rows) {
    let data = {};
    try { data = JSON.parse(r.data || '{}'); } catch { data = {}; }
    connected[r.app] = {
      id: r.id, external_id: r.external_id, display_name: r.display_name,
      scopes: r.scopes, status: r.status, expires_at: r.expires_at, connected_at: r.connected_at, data,
    };
  }
  res.json({ catalog: apps.publicCatalog(), categories: apps.CATEGORIES, connected });
});

// Begin OAuth: returns { authorize_url } or { needs_config, missing } / errors.
router.post('/:key/connect', requireLocation, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const app = apps.get(req.params.key);
  if (!app) return res.status(404).json({ error: 'Unknown app' });
  if (app.status === 'soon') return res.status(400).json({ error: 'Esta integración aún no está disponible' });
  if (!apps.isConfigured(app)) return res.json({ needs_config: true, missing: apps.missingEnv(app) });
  const shop = (req.body && req.body.shop ? String(req.body.shop).trim() : '').replace(/^https?:\/\//, '');
  if (app.needsShop && !shop) return res.status(400).json({ error: 'shop domain is required' });
  const url = apps.authorizeUrl(app, { redirectUri: callbackUrl(req), locationId: req.location.id, ts: Date.now(), shop });
  if (!url) return res.status(400).json({ error: 'No se pudo construir la URL de autorización' });
  res.json({ authorize_url: url });
});

// Manually store a connection (for API-key style apps, or pasting a token).
router.post('/:key/manual', requireLocation, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const app = apps.get(req.params.key);
  if (!app) return res.status(404).json({ error: 'Unknown app' });
  const { access_token, external_id, display_name, data } = req.body || {};
  if (!access_token) return res.status(400).json({ error: 'access_token is required' });
  await storeConnection(req.location.id, app.key, {
    access_token, external_id: external_id || '', display_name: display_name || app.name,
    scopes: app.scopes || '', data: data || {},
  });
  res.status(201).json({ ok: true });
});

// Disconnect.
router.delete('/connected/:id', requireLocation, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const info = await db.run('DELETE FROM connected_accounts WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!info.changes) return res.status(404).json({ error: 'Connection not found' });
  res.json({ ok: true });
});

module.exports = router;
module.exports.storeConnection = storeConnection;
