// Per-scope integration credentials (Phase 2). Sub-accounts can bring their
// own Stripe/Twilio/email/AI keys; if not set they inherit the
// agency defaults, and finally the deployment env vars. Secrets are stored
// encrypted and never returned in clear (masked to last 4 chars).
const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const secretbox = require('../services/secretbox');
const integrations = require('../services/integrations');
const providers = require('../services/providers');
const messaging = require('../services/messaging');

const router = express.Router();
router.use(requireAuth);

// Send a test email using this sub-account's resolved email config, so an admin
// can verify their Resend/SendGrid key end-to-end. Defaults to the current
// user's email. Returns { ok, provider, error? }; provider 'simulated' means no
// real key is configured yet.
router.post('/test-email', requireLocation, async (req, res) => {
  const to = (req.body && req.body.to) || req.user.email;
  if (!to) return res.status(400).json({ error: 'No hay dirección de destino' });
  const text = `Este es un email de prueba desde ${req.location.name || 'tu plataforma'}.\n\nSi lo estás leyendo, tu integración de email funciona correctamente. ✅`;
  const result = await providers.deliverEmail(
    {
      to,
      subject: 'Email de prueba ✅',
      text,
      html: messaging.renderEmailHtml(text, { fromName: req.location.name }),
      fromName: req.location.name,
    },
    { locationId: req.location.id, agencyId: req.user.agency_id }
  );
  res.json({ ...result, to });
});

// Field definitions per provider (secret fields are masked on read).
const FIELDS = {
  email: [{ k: 'vendor' }, { k: 'api_key', secret: true }, { k: 'mail_from' }],
  twilio: [
    { k: 'account_sid' }, { k: 'auth_token', secret: true }, { k: 'api_key_sid' },
    { k: 'api_key_secret', secret: true }, { k: 'from_number' }, { k: 'whatsapp_from' },
  ],
  stripe: [{ k: 'secret_key', secret: true }],
  ai: [{ k: 'api_key', secret: true }, { k: 'model' }],
};

function viewFields(provider, stored = {}) {
  return FIELDS[provider].map(({ k, secret }) => ({
    key: k,
    secret: !!secret,
    set: Boolean(stored[k]),
    value: stored[k] ? (secret ? secretbox.mask(stored[k]) : stored[k]) : '',
  }));
}

// Merge submitted fields onto existing config, ignoring blanks and unchanged
// masked secrets (values starting with the bullet char).
function mergeSubmitted(provider, existing, body) {
  const out = { ...existing };
  for (const { k } of FIELDS[provider]) {
    const v = body[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && (v === '' || v.startsWith('••••'))) continue;
    out[k] = v;
  }
  return out;
}

async function upsert(table, col, id, provider, config) {
  await db.run(
    `INSERT INTO ${table} (${col}, provider, config, enabled, updated_at)
     VALUES (?, ?, ?, 1, now())
     ON CONFLICT (${col}, provider) DO UPDATE SET config = EXCLUDED.config, enabled = 1, updated_at = now()`,
    [id, provider, secretbox.encrypt(config)]
  );
}

async function storedConfig(table, col, id, provider) {
  const row = await db.get(`SELECT config FROM ${table} WHERE ${col} = ? AND provider = ?`, [id, provider]);
  return row ? secretbox.decrypt(row.config) : {};
}

// ---- Per-location (sub-account) ----
router.get('/', requireLocation, async (req, res) => {
  const out = {};
  for (const provider of integrations.PROVIDERS) {
    const resolved = await integrations.resolve(provider, { locationId: req.location.id, agencyId: req.user.agency_id });
    const override = await db.get('SELECT id FROM location_integrations WHERE location_id = ? AND provider = ?', [req.location.id, provider]);
    const stored = override ? await storedConfig('location_integrations', 'location_id', req.location.id, provider) : {};
    out[provider] = { source: resolved.source, has_override: Boolean(override), fields: viewFields(provider, stored) };
  }
  res.json(out);
});

router.put('/:provider', requireLocation, async (req, res) => {
  const provider = req.params.provider;
  if (!FIELDS[provider]) return res.status(400).json({ error: 'Unknown provider' });
  // Revert to inheriting the agency/platform config.
  if (req.body?.use_agency) {
    await db.run('DELETE FROM location_integrations WHERE location_id = ? AND provider = ?', [req.location.id, provider]);
    return res.json({ ok: true, inherited: true });
  }
  const existing = await storedConfig('location_integrations', 'location_id', req.location.id, provider);
  const merged = mergeSubmitted(provider, existing, req.body || {});
  await upsert('location_integrations', 'location_id', req.location.id, provider, merged);
  res.json({ ok: true });
});

// ---- Agency-level defaults (admin) ----
router.get('/agency/:provider', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const provider = req.params.provider;
  if (!FIELDS[provider]) return res.status(400).json({ error: 'Unknown provider' });
  const stored = await storedConfig('agency_integrations', 'agency_id', req.user.agency_id, provider);
  res.json({ provider, fields: viewFields(provider, stored) });
});

router.put('/agency/:provider', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const provider = req.params.provider;
  if (!FIELDS[provider]) return res.status(400).json({ error: 'Unknown provider' });
  if (req.body?.clear) {
    await db.run('DELETE FROM agency_integrations WHERE agency_id = ? AND provider = ?', [req.user.agency_id, provider]);
    return res.json({ ok: true, cleared: true });
  }
  const existing = await storedConfig('agency_integrations', 'agency_id', req.user.agency_id, provider);
  const merged = mergeSubmitted(provider, existing, req.body || {});
  await upsert('agency_integrations', 'agency_id', req.user.agency_id, provider, merged);
  res.json({ ok: true });
});

module.exports = router;
