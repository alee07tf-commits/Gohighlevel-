// Native app catalog (v3.1). The GoHighLevel-style "marketplace" of first-party
// integrations a sub-account can connect via OAuth. Each app declares the env
// vars that hold the platform's OAuth client credentials; until those are set
// the app shows as "config pendiente" (nothing the tenant does, the operator
// supplies them once). Connecting mints a signed state, sends the user to the
// provider, and the callback stores encrypted tokens in connected_accounts.
//
// No secrets live here — only public metadata and the *names* of the env vars.
const crypto = require('crypto');
const { JWT_SECRET } = require('../auth');

// Category order/labels for grouping in the UI (es/en).
const CATEGORIES = {
  ads: ['Publicidad y Leads', 'Ads & Leads'],
  ecommerce: ['E-commerce', 'E-commerce'],
  productivity: ['Productividad', 'Productivity'],
  payments: ['Pagos', 'Payments'],
  accounting: ['Contabilidad', 'Accounting'],
  messaging: ['Mensajería', 'Messaging'],
};

// The catalog. `env` = platform OAuth client credential var names (all required
// to be "configured"). `authorize`/`token` = provider OAuth endpoints. `scopes`
// = requested scopes. `params` = extra static authorize-url params. `note` flags
// a special connect flow (e.g. Shopify needs a shop domain first).
const CATALOG = [
  {
    key: 'meta',
    name: 'Meta — Facebook & Instagram',
    category: 'ads',
    blurb: ['Importa los Lead Ads de Facebook e Instagram: cada lead entra como contacto y dispara tus automatizaciones.',
            'Import Facebook & Instagram Lead Ads: every lead becomes a contact and fires your automations.'],
    env: ['META_APP_ID', 'META_APP_SECRET'],
    authorize: 'https://www.facebook.com/v19.0/dialog/oauth',
    token: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: 'leads_retrieval,pages_show_list,pages_manage_metadata,pages_read_engagement',
  },
  {
    key: 'google',
    name: 'Google — Calendar & Reseñas',
    category: 'productivity',
    blurb: ['Sincroniza Google Calendar y las reseñas de tu Perfil de Empresa de Google.',
            'Sync Google Calendar and your Google Business Profile reviews.'],
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/business.manage',
    params: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  {
    key: 'shopify',
    name: 'Shopify',
    category: 'ecommerce',
    blurb: ['Sincroniza clientes y pedidos de tu tienda Shopify hacia el CRM.',
            'Sync customers and orders from your Shopify store into the CRM.'],
    env: ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET'],
    token: 'https://{shop}/admin/oauth/access_token',
    authorize: 'https://{shop}/admin/oauth/authorize',
    scopes: 'read_customers,read_orders',
    needsShop: true,
  },
  {
    key: 'zoom',
    name: 'Zoom',
    category: 'productivity',
    blurb: ['Crea reuniones de Zoom automáticamente para tus citas.',
            'Automatically create Zoom meetings for your appointments.'],
    env: ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'],
    authorize: 'https://zoom.us/oauth/authorize',
    token: 'https://zoom.us/oauth/token',
    scopes: '',
  },
  {
    key: 'stripe',
    name: 'Stripe',
    category: 'payments',
    blurb: ['Cobra a tus clientes y sincroniza pagos vía Stripe Connect.',
            'Charge customers and sync payments via Stripe Connect.'],
    env: ['STRIPE_CONNECT_CLIENT_ID'],
    authorize: 'https://connect.stripe.com/oauth/authorize',
    token: 'https://connect.stripe.com/oauth/token',
    scopes: 'read_write',
  },
  {
    key: 'paypal',
    name: 'PayPal',
    category: 'payments',
    blurb: ['Acepta pagos con PayPal y concilia las transacciones.',
            'Accept PayPal payments and reconcile transactions.'],
    env: ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET'],
    authorize: 'https://www.paypal.com/connect',
    token: 'https://api-m.paypal.com/v1/oauth2/token',
    scopes: 'openid https://uri.paypal.com/services/paypalattributes',
  },
  {
    key: 'quickbooks',
    name: 'QuickBooks',
    category: 'accounting',
    blurb: ['Envía facturas y clientes a QuickBooks Online.',
            'Push invoices and customers to QuickBooks Online.'],
    env: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'],
    authorize: 'https://appcenter.intuit.com/connect/oauth2',
    token: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    scopes: 'com.intuit.quickbooks.accounting',
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp Business',
    category: 'messaging',
    blurb: ['Envía y recibe mensajes de WhatsApp (requiere Meta / Twilio).',
            'Send and receive WhatsApp messages (requires Meta / Twilio).'],
    env: ['META_APP_ID', 'META_APP_SECRET'],
    scopes: 'whatsapp_business_messaging,whatsapp_business_management',
    authorize: 'https://www.facebook.com/v19.0/dialog/oauth',
    token: 'https://graph.facebook.com/v19.0/oauth/access_token',
    status: 'soon', // deferred per roadmap
  },
];

const BY_KEY = Object.fromEntries(CATALOG.map((a) => [a.key, a]));

function get(key) {
  return BY_KEY[key] || null;
}

// An app is "configured" when every env credential it needs is present.
function isConfigured(app) {
  return (app.env || []).every((v) => Boolean(process.env[v]));
}

function missingEnv(app) {
  return (app.env || []).filter((v) => !process.env[v]);
}

function clientId(app) {
  return process.env[app.env[0]] || '';
}
function clientSecret(app) {
  return app.env[1] ? process.env[app.env[1]] || '' : '';
}

// Signed, short-lived state that binds the OAuth round-trip to a location + app
// so the public callback can trust it without a session cookie.
function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(state, maxAgeMs = 15 * 60 * 1000) {
  if (!state || typeof state !== 'string' || !state.includes('.')) return null;
  const [body, sig] = state.split('.');
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  // Constant-time compare; lengths must match first.
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || !payload.ts) return null;
  return payload; // caller checks freshness against a passed-in "now"
}

// Builds the provider authorize URL for a location. `redirectUri` is our public
// callback; `shop` is required for Shopify. Returns null if not configured.
function authorizeUrl(app, { redirectUri, locationId, ts, shop }) {
  if (!isConfigured(app)) return null;
  const state = signState({ app: app.key, loc: locationId, ts, shop: shop || '' });
  let authorize = app.authorize;
  if (app.needsShop) {
    if (!shop) return null;
    authorize = authorize.replace('{shop}', shop);
  }
  const params = new URLSearchParams({
    client_id: clientId(app),
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    ...(app.scopes ? { scope: app.scopes } : {}),
    ...(app.params || {}),
  });
  return `${authorize}?${params.toString()}`;
}

// Public metadata for the marketplace UI (no secrets).
function publicCatalog() {
  return CATALOG.map((a) => ({
    key: a.key,
    name: a.name,
    category: a.category,
    blurb: a.blurb,
    status: a.status || 'available',
    needs_shop: !!a.needsShop,
    configured: isConfigured(a),
    missing_env: missingEnv(a),
  }));
}

module.exports = {
  CATALOG, CATEGORIES, BY_KEY, get, isConfigured, missingEnv,
  clientId, clientSecret, signState, verifyState, authorizeUrl, publicCatalog,
};
