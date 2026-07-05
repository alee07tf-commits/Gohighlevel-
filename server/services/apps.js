// Native app catalog (v3.2). The GoHighLevel-style "marketplace" of first-party
// integrations, matched to the apps GHL ships natively. Three connection styles:
//
//   auth: 'oauth'   — the platform operator supplies OAuth client credentials
//                     (env vars). Connecting redirects the user to the provider.
//   auth: 'apikey'  — the tenant pastes their own credentials (API key, SMTP…);
//                     no operator setup needed. Stored encrypted.
//   auth: 'builtin' — no connection object; works through our own API keys +
//                     webhooks (Zapier / Make / n8n). Card links to Developers.
//
// No secrets live here — only public metadata and the *names* of the env vars.
const crypto = require('crypto');
const { JWT_SECRET } = require('../auth');

// Category order + labels (es/en). Order here drives the UI section order.
const CATEGORIES = {
  ads: ['Publicidad y Leads', 'Ads & Leads'],
  scheduling: ['Calendario y Agenda', 'Calendar & Scheduling'],
  social: ['Redes sociales', 'Social'],
  messaging: ['Mensajería y Teléfono', 'Messaging & Phone'],
  email: ['Email', 'Email'],
  payments: ['Pagos', 'Payments'],
  accounting: ['Contabilidad', 'Accounting'],
  ecommerce: ['E-commerce', 'E-commerce'],
  analytics: ['Analítica', 'Analytics'],
  content: ['Web y Contenido', 'Website & Content'],
  automation: ['CRM y Automatización', 'CRM & Automation'],
};

// Shared OAuth endpoint presets so the many Google/Meta/Microsoft cards stay DRY.
const GOOGLE = { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', params: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' } };
const META = { authorize: 'https://www.facebook.com/v19.0/dialog/oauth', token: 'https://graph.facebook.com/v19.0/oauth/access_token' };
const MICROSOFT = { authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token' };
const TIKTOK = { authorize: 'https://www.tiktok.com/v2/auth/authorize/', token: 'https://open.tiktokapis.com/v2/oauth/token/' };

const CATALOG = [
  // ---- Ads & Leads ----
  { key: 'meta', name: 'Meta — Facebook & Instagram', category: 'ads', auth: 'oauth', ...META,
    env: ['META_APP_ID', 'META_APP_SECRET'], scopes: 'leads_retrieval,pages_show_list,pages_manage_metadata,pages_read_engagement',
    blurb: ['Importa los Lead Ads de Facebook e Instagram: cada lead entra como contacto y dispara tus automatizaciones.',
            'Import Facebook & Instagram Lead Ads: every lead becomes a contact and fires your automations.'] },
  { key: 'google_ads', name: 'Google Ads', category: 'ads', auth: 'oauth', ...GOOGLE,
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], scopes: 'https://www.googleapis.com/auth/adwords',
    blurb: ['Seguimiento de conversiones y atribución de llamadas de tus campañas de Google Ads.',
            'Conversion tracking and call attribution from your Google Ads campaigns.'] },
  { key: 'tiktok_ads', name: 'TikTok Lead Generation', category: 'ads', auth: 'oauth', ...TIKTOK,
    env: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'], scopes: 'user.info.basic',
    blurb: ['Captura los formularios de TikTok Lead Ads directamente en el CRM.',
            'Capture TikTok Lead Ads forms straight into the CRM.'] },

  // ---- Calendar & Scheduling ----
  { key: 'google', name: 'Google — Calendar & Reseñas', category: 'scheduling', auth: 'oauth', ...GOOGLE,
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/business.manage',
    blurb: ['Sincroniza Google Calendar (dos vías, evita solapes), Google Meet y las reseñas de tu Perfil de Empresa.',
            'Two-way Google Calendar sync, Google Meet links and Google Business Profile reviews.'] },
  { key: 'microsoft', name: 'Microsoft — Outlook & Teams', category: 'scheduling', auth: 'oauth', ...MICROSOFT,
    env: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'], scopes: 'offline_access Calendars.ReadWrite OnlineMeetings.ReadWrite',
    blurb: ['Sincroniza el calendario de Outlook/Office 365 y genera enlaces de Microsoft Teams en tus citas.',
            'Sync Outlook/Office 365 calendar and generate Microsoft Teams links on bookings.'] },
  { key: 'calendly', name: 'Calendly', category: 'scheduling', auth: 'oauth',
    authorize: 'https://auth.calendly.com/oauth/authorize', token: 'https://auth.calendly.com/oauth/token',
    env: ['CALENDLY_CLIENT_ID', 'CALENDLY_CLIENT_SECRET'], scopes: '',
    blurb: ['Trae los eventos de Calendly como citas, crea el contacto y lanza flujos automáticamente.',
            'Pull Calendly events in as appointments, create the contact and trigger workflows.'] },
  { key: 'zoom', name: 'Zoom', category: 'scheduling', auth: 'oauth',
    authorize: 'https://zoom.us/oauth/authorize', token: 'https://zoom.us/oauth/token',
    env: ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'], scopes: '',
    blurb: ['Genera un enlace de reunión de Zoom único para cada cita reservada.',
            'Generate a unique Zoom meeting link for each booked appointment.'] },
  { key: 'icloud', name: 'iCloud Calendar', category: 'scheduling', auth: 'apikey',
    fields: [{ k: 'apple_id', label: ['Apple ID', 'Apple ID'] }, { k: 'app_password', secret: true, label: ['Contraseña de app', 'App-specific password'] }],
    blurb: ['Sincroniza tu calendario de iCloud para comprobar disponibilidad y evitar solapes.',
            'Sync your iCloud calendar to check availability and avoid conflicts.'] },

  // ---- Social (Social Planner publishing) ----
  { key: 'linkedin', name: 'LinkedIn', category: 'social', auth: 'oauth',
    authorize: 'https://www.linkedin.com/oauth/v2/authorization', token: 'https://www.linkedin.com/oauth/v2/accessToken',
    env: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'], scopes: 'w_member_social r_liteprofile r_organization_social',
    blurb: ['Publica en perfiles y páginas de empresa de LinkedIn desde el planificador social.',
            'Publish to LinkedIn profiles and company pages from the social planner.'] },
  { key: 'tiktok', name: 'TikTok', category: 'social', auth: 'oauth', ...TIKTOK,
    env: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'], scopes: 'user.info.basic,video.publish,video.upload',
    blurb: ['Programa y publica vídeos en TikTok desde el planificador social.',
            'Schedule and publish TikTok videos from the social planner.'] },
  { key: 'twitter', name: 'X (Twitter)', category: 'social', auth: 'oauth',
    authorize: 'https://twitter.com/i/oauth2/authorize', token: 'https://api.twitter.com/2/oauth2/token',
    env: ['TWITTER_CLIENT_ID', 'TWITTER_CLIENT_SECRET'], scopes: 'tweet.read tweet.write users.read offline.access',
    blurb: ['Publica en X (Twitter) desde el planificador social.',
            'Publish to X (Twitter) from the social planner.'] },
  { key: 'youtube', name: 'YouTube', category: 'social', auth: 'oauth', ...GOOGLE,
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], scopes: 'https://www.googleapis.com/auth/youtube.upload',
    blurb: ['Sube vídeos y shorts a YouTube desde el planificador social.',
            'Upload videos and shorts to YouTube from the social planner.'] },
  { key: 'pinterest', name: 'Pinterest', category: 'social', auth: 'oauth',
    authorize: 'https://www.pinterest.com/oauth/', token: 'https://api.pinterest.com/v5/oauth/token',
    env: ['PINTEREST_APP_ID', 'PINTEREST_APP_SECRET'], scopes: 'boards:read,pins:read,pins:write',
    blurb: ['Crea pines y publica en tus tableros de Pinterest.',
            'Create pins and publish to your Pinterest boards.'] },

  // ---- Messaging & Phone ----
  { key: 'messenger', name: 'Facebook Messenger', category: 'messaging', auth: 'oauth', ...META,
    env: ['META_APP_ID', 'META_APP_SECRET'], scopes: 'pages_messaging,pages_manage_metadata',
    blurb: ['Recibe y responde mensajes de Messenger en la bandeja unificada.',
            'Receive and reply to Messenger DMs in the unified inbox.'] },
  { key: 'instagram_dm', name: 'Instagram DMs', category: 'messaging', auth: 'oauth', ...META,
    env: ['META_APP_ID', 'META_APP_SECRET'], scopes: 'instagram_manage_messages,pages_manage_metadata',
    blurb: ['Recibe y responde mensajes directos de Instagram en la bandeja unificada.',
            'Receive and reply to Instagram DMs in the unified inbox.'] },
  // NOTE: SMS and WhatsApp are NOT connect-your-own-account apps. They are
  // "servicios incluidos" the agency provides centrally (see MANAGED below), so
  // a client uses them with zero setup — no token, no account. That mirrors
  // GoHighLevel's LC Phone / LC WhatsApp model.

  // ---- Email ----
  { key: 'mailgun', name: 'Mailgun', category: 'email', auth: 'apikey',
    fields: [{ k: 'api_key', secret: true, label: ['API key', 'API key'] }, { k: 'domain', label: ['Dominio de envío', 'Sending domain'] }],
    blurb: ['Envío de email con dominio propio y buena entregabilidad vía Mailgun.',
            'Custom-domain email sending and deliverability via Mailgun.'] },
  { key: 'sendgrid', name: 'SendGrid', category: 'email', auth: 'apikey',
    fields: [{ k: 'api_key', secret: true, label: ['API key', 'API key'] }],
    blurb: ['Envío de email a escala con SendGrid.',
            'Send email at scale with SendGrid.'] },
  { key: 'smtp', name: 'SMTP (personalizado)', category: 'email', auth: 'apikey',
    fields: [{ k: 'host', label: ['Servidor', 'Host'] }, { k: 'port', label: ['Puerto', 'Port'] }, { k: 'username', label: ['Usuario', 'Username'] }, { k: 'password', secret: true, label: ['Contraseña', 'Password'] }],
    blurb: ['Conecta cualquier proveedor de email por SMTP.',
            'Connect any email provider over SMTP.'] },

  // ---- Payments ----
  { key: 'stripe', name: 'Stripe', category: 'payments', auth: 'oauth',
    authorize: 'https://connect.stripe.com/oauth/authorize', token: 'https://connect.stripe.com/oauth/token',
    env: ['STRIPE_CONNECT_CLIENT_ID'], scopes: 'read_write',
    blurb: ['Cobra a tus clientes y sincroniza pagos vía Stripe Connect.',
            'Charge customers and sync payments via Stripe Connect.'] },
  { key: 'paypal', name: 'PayPal', category: 'payments', auth: 'oauth',
    authorize: 'https://www.paypal.com/connect', token: 'https://api-m.paypal.com/v1/oauth2/token',
    env: ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET'], scopes: 'openid https://uri.paypal.com/services/paypalattributes',
    blurb: ['Acepta pagos con PayPal y concilia las transacciones.',
            'Accept PayPal payments and reconcile transactions.'] },
  { key: 'square', name: 'Square', category: 'payments', auth: 'oauth',
    authorize: 'https://connect.squareup.com/oauth2/authorize', token: 'https://connect.squareup.com/oauth2/token',
    env: ['SQUARE_APP_ID', 'SQUARE_APP_SECRET'], scopes: 'PAYMENTS_READ PAYMENTS_WRITE ORDERS_READ',
    blurb: ['Pasarela de pago Square en formularios, facturas y enlaces de pago.',
            'Square payment gateway across order forms, invoices and payment links.'] },
  { key: 'authorize_net', name: 'Authorize.net', category: 'payments', auth: 'apikey',
    fields: [{ k: 'login_id', label: ['API Login ID', 'API Login ID'] }, { k: 'transaction_key', secret: true, label: ['Transaction Key', 'Transaction Key'] }],
    blurb: ['Pasarela de tarjeta Authorize.net para formularios y reservas.',
            'Authorize.net card gateway for order forms and bookings.'] },
  { key: 'nmi', name: 'NMI', category: 'payments', auth: 'apikey',
    fields: [{ k: 'security_key', secret: true, label: ['Security Key', 'Security Key'] }],
    blurb: ['Pasarela de pago con tarjeta y eCheck vía NMI.',
            'Card and eCheck payment gateway via NMI.'] },
  { key: 'razorpay', name: 'Razorpay', category: 'payments', auth: 'apikey',
    fields: [{ k: 'key_id', label: ['Key ID', 'Key ID'] }, { k: 'key_secret', secret: true, label: ['Key Secret', 'Key Secret'] }],
    blurb: ['Pasarela de pago Razorpay (foco en India).',
            'Razorpay payment gateway (India-focused).'] },

  // ---- Accounting ----
  { key: 'quickbooks', name: 'QuickBooks', category: 'accounting', auth: 'oauth',
    authorize: 'https://appcenter.intuit.com/connect/oauth2', token: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    env: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'], scopes: 'com.intuit.quickbooks.accounting',
    blurb: ['Envía facturas y clientes a QuickBooks Online.',
            'Push invoices and customers to QuickBooks Online.'] },

  // ---- E-commerce ----
  { key: 'shopify', name: 'Shopify', category: 'ecommerce', auth: 'oauth',
    authorize: 'https://{shop}/admin/oauth/authorize', token: 'https://{shop}/admin/oauth/access_token',
    env: ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET'], scopes: 'read_customers,read_orders', needsShop: true,
    blurb: ['Sincroniza clientes y pedidos de tu tienda Shopify hacia el CRM.',
            'Sync customers and orders from your Shopify store into the CRM.'] },

  // ---- Analytics ----
  { key: 'google_analytics', name: 'Google Analytics (GA4)', category: 'analytics', auth: 'apikey',
    fields: [{ k: 'measurement_id', label: ['Measurement ID (G-XXXX)', 'Measurement ID (G-XXXX)'] }, { k: 'api_secret', secret: true, label: ['API secret (Measurement Protocol)', 'API secret (Measurement Protocol)'] }],
    blurb: ['Envía conversiones y eventos a Google Analytics 4.',
            'Send conversions and events to Google Analytics 4.'] },

  // ---- Website & Content ----
  { key: 'wordpress', name: 'WordPress', category: 'content', auth: 'apikey',
    fields: [{ k: 'site_url', label: ['URL del sitio', 'Site URL'] }, { k: 'username', label: ['Usuario', 'Username'] }, { k: 'application_password', secret: true, label: ['Contraseña de aplicación', 'Application password'] }],
    blurb: ['Incrusta formularios, seguimiento y disparadores en tu WordPress.',
            'Embed forms, tracking and triggers into your WordPress site.'] },

  // ---- CRM & Automation ----
  { key: 'hubspot', name: 'HubSpot', category: 'automation', auth: 'oauth',
    authorize: 'https://app.hubspot.com/oauth/authorize', token: 'https://api.hubapi.com/oauth/v1/token',
    env: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'], scopes: 'crm.objects.contacts.read crm.objects.contacts.write',
    blurb: ['Sincroniza contactos con HubSpot desde los flujos de trabajo.',
            'Sync contacts with HubSpot from your workflows.'] },
  { key: 'zapier', name: 'Zapier', category: 'automation', auth: 'builtin',
    blurb: ['Conecta con 6.000+ apps usando tus API keys y webhooks.',
            'Connect to 6,000+ apps using your API keys and webhooks.'] },
  { key: 'make', name: 'Make (Integromat)', category: 'automation', auth: 'builtin',
    blurb: ['Automatizaciones multi-paso con Make usando tus API keys y webhooks.',
            'Multi-step automations with Make using your API keys and webhooks.'] },
  { key: 'n8n', name: 'n8n', category: 'automation', auth: 'builtin',
    blurb: ['Automatización open-source con n8n vía API keys y webhooks.',
            'Open-source automation with n8n via API keys and webhooks.'] },
];

// ---- Managed services (tier 2): provided centrally by the agency, used by
// every client with ZERO setup — no token, no account. The agency configures
// the underlying provider once (platform env or agency-level integration) and
// it cascades to every sub-account (services/integrations.js). This is GHL's
// LC Phone / LC WhatsApp / Email / Conversations-AI model. `statusKey` maps to
// providers.status(); `sourceKey` maps to its .sources.
const MANAGED = [
  { key: 'sms', name: 'SMS y llamadas', provider: 'twilio', statusKey: 'sms', sourceKey: 'sms',
    blurb: ['Envía SMS a tus contactos desde Conversaciones y automatizaciones, sin configurar nada.',
            'Send SMS to your contacts from Conversations and automations, with zero setup.'] },
  { key: 'whatsapp', name: 'WhatsApp', provider: 'twilio', statusKey: 'whatsapp', sourceKey: 'whatsapp',
    blurb: ['Envía y recibe WhatsApp sin crear cuenta ni token: lo provee tu agencia.',
            'Send and receive WhatsApp with no account or token: your agency provides it.'] },
  { key: 'email', name: 'Email', provider: 'email', statusKey: 'email', sourceKey: 'email',
    blurb: ['Envío de email para campañas, secuencias y respuestas, listo para usar.',
            'Email sending for campaigns, sequences and replies, ready to use.'] },
  { key: 'ai', name: 'IA conversacional', provider: 'ai', statusKey: 'ai', sourceKey: 'ai',
    blurb: ['Respuestas y redacción con IA en toda la plataforma, sin claves por tu parte.',
            'AI replies and copywriting across the platform, with no keys on your side.'] },
];

// Resolves the managed-service tier for a context using providers.status(): each
// service reports whether it's active and where it's configured (plataforma /
// agencia / estancia). Pure metadata + status — no secrets.
function managedStatus(status) {
  return MANAGED.map((m) => {
    const raw = status[m.statusKey];
    const active = m.statusKey === 'ai' ? Boolean(raw) : Boolean(raw) && raw !== 'simulated';
    return {
      key: m.key, name: m.name, blurb: m.blurb, provider: m.provider,
      active, source: (status.sources && status.sources[m.sourceKey]) || 'none',
    };
  });
}

const BY_KEY = Object.fromEntries(CATALOG.map((a) => [a.key, a]));

function get(key) {
  return BY_KEY[key] || null;
}

// An OAuth app is "configured" once every operator env credential is present.
// API-key and builtin apps need no operator setup, so they're always available.
function isConfigured(app) {
  if (app.auth !== 'oauth') return true;
  return (app.env || []).every((v) => Boolean(process.env[v]));
}

function missingEnv(app) {
  if (app.auth !== 'oauth') return [];
  return (app.env || []).filter((v) => !process.env[v]);
}

function clientId(app) {
  return (app.env && process.env[app.env[0]]) || '';
}
function clientSecret(app) {
  return (app.env && app.env[1] ? process.env[app.env[1]] : '') || '';
}

// Signed, short-lived state that binds the OAuth round-trip to a location + app
// so the public callback can trust it without a session cookie.
function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(state) {
  if (!state || typeof state !== 'string' || !state.includes('.')) return null;
  const [body, sig] = state.split('.');
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || !payload.ts) return null;
  return payload;
}

// Builds the provider authorize URL for a location. Returns null if the app is
// not OAuth, not configured, or (Shopify) missing its shop domain.
function authorizeUrl(app, { redirectUri, locationId, ts, shop }) {
  if (app.auth !== 'oauth' || !isConfigured(app)) return null;
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

// Public field metadata for an API-key app (keys + secret flags + labels only).
function publicFields(app) {
  return (app.fields || []).map((f) => ({ key: f.k, secret: !!f.secret, label: f.label || [f.k, f.k] }));
}

// Public metadata for the marketplace UI (no secrets, no env values).
function publicCatalog() {
  return CATALOG.map((a) => ({
    key: a.key,
    name: a.name,
    category: a.category,
    blurb: a.blurb,
    auth: a.auth,
    status: a.status || 'available',
    needs_shop: !!a.needsShop,
    configured: isConfigured(a),
    missing_env: missingEnv(a),
    fields: a.auth === 'apikey' ? publicFields(a) : [],
  }));
}

module.exports = {
  CATALOG, CATEGORIES, MANAGED, BY_KEY, get, isConfigured, missingEnv, managedStatus,
  clientId, clientSecret, signState, verifyState, authorizeUrl, publicCatalog, publicFields,
};
