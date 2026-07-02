// Integration status: which channels are live vs simulated. Read-only —
// configuration happens via environment variables (see README/.env.example).
const express = require('express');
const { requireAuth } = require('../auth');
const providers = require('../services/providers');

const router = express.Router();
router.use(requireAuth);

router.get('/integrations', (req, res) => {
  res.json({
    ...providers.status(),
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
