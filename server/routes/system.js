// Integration status: which channels are live vs simulated. Read-only —
// configuration happens via environment variables (see README/.env.example).
const express = require('express');
const { requireAuth } = require('../auth');
const providers = require('../services/providers');

const db = require('../db');

const router = express.Router();

// Public DB health check — no auth so it works even when login is broken.
// Surfaces the underlying driver error instead of hanging into a 504.
router.get('/health', async (req, res) => {
  const info = { database: process.env.DATABASE_URL ? 'postgres' : 'pglite' };
  try {
    await db.get('SELECT 1 AS ok');
    res.json({ ok: true, ...info });
  } catch (err) {
    res.status(500).json({ ok: false, ...info, error: err.message });
  }
});

// Idempotent demo-data seeding (safe to expose: only creates the demo agency
// if it doesn't exist yet). Surfaces seed errors that background auto-seed
// would swallow on serverless.
router.post('/seed-demo', async (req, res) => {
  try {
    const seeded = await require('../demo-seed').seedDemo();
    res.json({ ok: true, seeded });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.use(requireAuth);

router.get('/integrations', async (req, res) => {
  const locationId = Number(req.headers['x-location-id']) || undefined;
  res.json({
    ...(await providers.status({ locationId, agencyId: req.user.agency_id })),
    cron_secret: Boolean(process.env.CRON_SECRET),
    recommended: {
      email: 'Resend (resend.com) — RESEND_API_KEY + MAIL_FROM',
      sms: 'Twilio (twilio.com) — TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER',
      whatsapp: 'Twilio WhatsApp — TWILIO_WHATSAPP_FROM',
      ai: 'Claude API (console.anthropic.com) — ANTHROPIC_API_KEY',
    },
  });
});

module.exports = router;
