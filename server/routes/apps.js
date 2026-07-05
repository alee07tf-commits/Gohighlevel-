// Native app marketplace (v3.1). Lists first-party integrations, starts the
// OAuth handshake, receives the provider callback and stores the connection.
// The public OAuth callback is defined BEFORE requireAuth so the provider's
// browser redirect (which carries no session) can reach it; it trusts the
// HMAC-signed `state` minted at connect time to bind back to the location.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const apps = require('../services/apps');
const secretbox = require('../services/secretbox');
const providers = require('../services/providers');
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

// Upsert a connection (tokens/credentials encrypted at rest). Pass either
// `access_token` (a raw OAuth token, stored as { v }) or `credentials` (an
// arbitrary object of API-key fields, stored as-is) — both go, encrypted, into
// the access_token column so they never round-trip to the client.
async function storeConnection(locationId, appKey, c) {
  const secret = c.credentials ? secretbox.encrypt(c.credentials) : c.access_token ? secretbox.encrypt({ v: c.access_token }) : '';
  const token = crypto.randomBytes(12).toString('hex'); // used only if none exists yet
  await db.run(
    `INSERT INTO connected_accounts
       (location_id, app, external_id, display_name, access_token, refresh_token, scopes, data, status, expires_at, webhook_token, connected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, now())
     ON CONFLICT (location_id, app) DO UPDATE SET
       external_id = EXCLUDED.external_id, display_name = EXCLUDED.display_name,
       access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
       scopes = EXCLUDED.scopes, data = EXCLUDED.data, status = 'connected',
       expires_at = EXCLUDED.expires_at, connected_at = now(),
       webhook_token = COALESCE(connected_accounts.webhook_token, EXCLUDED.webhook_token)`,
    [
      locationId, appKey, c.external_id || '', c.display_name || '',
      secret,
      c.refresh_token ? secretbox.encrypt({ v: c.refresh_token }) : '',
      c.scopes || '', JSON.stringify(c.data || {}), c.expires_at || null, token,
    ]
  );
}

// ---- Authenticated marketplace API ----
router.use(requireAuth);

// Marketplace: catalog + this sub-account's connections (tokens never leaked).
router.get('/', requireLocation, async (req, res) => {
  const rows = await db.all(
    `SELECT id, app, external_id, display_name, scopes, status, expires_at, connected_at, data, webhook_token
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
      webhook_token: r.webhook_token || null,
    };
  }
  // Managed-service tier (SMS/WhatsApp/Email/AI): backend status from the
  // agency→sub-account credential cascade, gated by the plan the sub-account is
  // on (its active subscription's features). No subscription → no gating.
  const status = await providers.status({ locationId: req.location.id, agencyId: req.user.agency_id });
  const sub = await db.get(
    `SELECT p.features FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.location_id = ? AND s.status = 'active' ORDER BY s.id DESC LIMIT 1`,
    [req.location.id]
  );
  let planFeatures = null;
  if (sub) { try { planFeatures = JSON.parse(sub.features || '{}'); } catch { planFeatures = {}; } }
  res.json({
    catalog: apps.publicCatalog(), categories: apps.CATEGORIES, connected,
    managed: apps.managedStatus(status, planFeatures), plan_gated: Boolean(sub),
  });
});

// Begin OAuth: returns { authorize_url } or { needs_config, missing } / errors.
router.post('/:key/connect', requireLocation, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const app = apps.get(req.params.key);
  if (!app) return res.status(404).json({ error: 'Unknown app' });
  if (app.status === 'soon') return res.status(400).json({ error: 'Esta integración aún no está disponible' });
  if (app.auth !== 'oauth') return res.status(400).json({ error: 'Esta app no usa OAuth; conéctala con sus credenciales' });
  if (!apps.isConfigured(app)) return res.json({ needs_config: true, missing: apps.missingEnv(app) });
  const shop = (req.body && req.body.shop ? String(req.body.shop).trim() : '').replace(/^https?:\/\//, '');
  if (app.needsShop && !shop) return res.status(400).json({ error: 'shop domain is required' });
  const url = apps.authorizeUrl(app, { redirectUri: callbackUrl(req), locationId: req.location.id, ts: Date.now(), shop });
  if (!url) return res.status(400).json({ error: 'No se pudo construir la URL de autorización' });
  res.json({ authorize_url: url });
});

// Manually store a connection. Two shapes:
//   { fields: {...} }        — API-key apps: validate against the catalog's
//                              field spec, encrypt the whole blob, keep only
//                              non-secret values + masked secrets in `data`.
//   { access_token, ... }    — raw token (OAuth apps, or mapping a Meta page).
router.post('/:key/manual', requireLocation, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const app = apps.get(req.params.key);
  if (!app) return res.status(404).json({ error: 'Unknown app' });
  const body = req.body || {};

  if (body.fields && typeof body.fields === 'object') {
    const spec = app.fields || [];
    if (!spec.length) return res.status(400).json({ error: 'Esta app no admite conexión manual por campos' });
    const creds = {};
    const display = {};
    const masked = {};
    for (const f of spec) {
      const v = body.fields[f.k];
      if (v === undefined || v === null || v === '') continue;
      creds[f.k] = v;
      if (f.secret) masked[f.k] = secretbox.mask(v);
      else display[f.k] = v;
    }
    // Require every non-secret field and at least one secret to be present.
    const missing = spec.filter((f) => !(f.k in creds)).map((f) => f.k);
    if (missing.length) return res.status(400).json({ error: `Faltan campos: ${missing.join(', ')}` });
    await storeConnection(req.location.id, app.key, {
      credentials: creds, display_name: app.name,
      external_id: display.domain || display.site_url || display.measurement_id || '',
      data: { display, masked },
    });
    return res.status(201).json({ ok: true });
  }

  const { access_token, external_id, display_name, data } = body;
  if (!access_token) return res.status(400).json({ error: 'access_token or fields is required' });
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
