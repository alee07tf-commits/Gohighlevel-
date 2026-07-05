// Credential resolver — the GoHighLevel cascade. For any provider, the
// effective config is layered: deployment env vars (platform) < agency
// defaults < per-location override. Per-location and per-agency credentials
// live encrypted in location_integrations / agency_integrations.
const db = require('../db');
const secretbox = require('./secretbox');

const PROVIDERS = ['email', 'twilio', 'stripe', 'ai', 'places'];

// The primary field whose presence means "this scope configured the provider".
const PRIMARY = {
  email: 'api_key',
  twilio: 'account_sid',
  stripe: 'secret_key',
  ai: 'api_key',
  places: 'google_places_api_key',
};

// Deployment env vars kept as the final fallback (backward compatible).
function envConfig(provider) {
  const e = process.env;
  switch (provider) {
    case 'email':
      return {
        vendor: e.RESEND_API_KEY ? 'resend' : e.SENDGRID_API_KEY ? 'sendgrid' : '',
        api_key: e.RESEND_API_KEY || e.SENDGRID_API_KEY || '',
        mail_from: e.MAIL_FROM || '',
      };
    case 'twilio':
      return {
        account_sid: e.TWILIO_ACCOUNT_SID || '',
        auth_token: e.TWILIO_AUTH_TOKEN || '',
        api_key_sid: e.TWILIO_API_KEY_SID || '',
        api_key_secret: e.TWILIO_API_KEY_SECRET || '',
        from_number: e.TWILIO_FROM_NUMBER || '',
        whatsapp_from: e.TWILIO_WHATSAPP_FROM || '',
      };
    case 'stripe':
      return { secret_key: e.STRIPE_SECRET_KEY || '' };
    case 'ai':
      return { api_key: e.ANTHROPIC_API_KEY || '', model: e.ANTHROPIC_MODEL || '' };
    case 'places':
      return { google_places_api_key: e.GOOGLE_PLACES_API_KEY || '', serper_api_key: e.SERPER_API_KEY || '' };
    default:
      return {};
  }
}

// Copies only non-empty fields from `over` onto `base`.
function overlay(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) if (v !== '' && v != null) out[k] = v;
  return out;
}

async function scopeConfig(table, col, id, provider) {
  if (!id) return null;
  const row = await db.get(`SELECT config, enabled FROM ${table} WHERE ${col} = ? AND provider = ?`, [id, provider]);
  if (!row || !row.enabled) return null;
  const cfg = secretbox.decrypt(row.config);
  return cfg && Object.keys(cfg).length ? cfg : null;
}

async function ctxIds({ locationId, agencyId }) {
  if (locationId && !agencyId) {
    const loc = await db.get('SELECT agency_id FROM locations WHERE id = ?', [locationId]);
    agencyId = loc ? loc.agency_id : null;
  }
  return { locationId: locationId || null, agencyId: agencyId || null };
}

// Resolves the effective config for a provider given a context. Returns
// { config, source } where source ∈ estancia | agencia | plataforma | none.
async function resolve(provider, ctx = {}) {
  const { locationId, agencyId } = await ctxIds(ctx);
  const env = envConfig(provider);
  const agency = agencyId ? await scopeConfig('agency_integrations', 'agency_id', agencyId, provider) : null;
  const location = locationId ? await scopeConfig('location_integrations', 'location_id', locationId, provider) : null;

  let config = env;
  if (agency) config = overlay(config, agency);
  if (location) config = overlay(config, location);

  const key = PRIMARY[provider];
  let source = 'none';
  if (location && location[key]) source = 'estancia';
  else if (agency && agency[key]) source = 'agencia';
  else if (env[key]) source = 'plataforma';
  else if (config[key]) source = 'plataforma';
  return { provider, config, source };
}

module.exports = { PROVIDERS, PRIMARY, envConfig, resolve, ctxIds };
