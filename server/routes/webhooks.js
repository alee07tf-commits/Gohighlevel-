// Inbound webhooks from external providers.
// Twilio (SMS/WhatsApp): point the phone number's webhook to
//   POST https://<your-app>/api/webhooks/twilio/<locationId>
const express = require('express');
const db = require('../db');
const messaging = require('../services/messaging');
const scoring = require('../services/scoring');
const automation = require('../services/automation');

const router = express.Router();

router.post('/twilio/:locationId', express.urlencoded({ extended: false }), async (req, res) => {
  const location = await db.get('SELECT * FROM locations WHERE id = ?', [req.params.locationId]);
  if (!location) return res.status(404).send('Unknown location');
  const from = String(req.body.From || '');
  const body = String(req.body.Body || '').trim();
  if (!from || !body) return res.status(400).send('Missing From/Body');

  const isWhatsapp = from.startsWith('whatsapp:');
  const phone = from.replace('whatsapp:', '');

  let contact = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND phone = ? AND phone != ''`, [
    location.id,
    phone,
  ]);
  if (!contact) {
    const id = await db.insert(
      'INSERT INTO contacts (location_id, first_name, phone, source) VALUES (?, ?, ?, ?)',
      [location.id, phone, phone, isWhatsapp ? 'whatsapp-inbound' : 'sms-inbound']
    );
    contact = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
    await automation.trigger(location.id, 'contact_created', contact);
  }

  await messaging.recordMessage({
    locationId: location.id,
    contactId: contact.id,
    direction: 'inbound',
    channel: isWhatsapp ? 'whatsapp' : 'sms',
    body,
  });
  await scoring.addScore(contact.id, 'inbound_message');
  await automation.logActivity(location.id, contact.id, 'note', `Inbound ${isWhatsapp ? 'WhatsApp' : 'SMS'} received`);
  await automation.trigger(location.id, 'message_received', contact, {});

  // Conversation AI: auto-reply on the same channel when enabled.
  if (location.ai_agent_enabled) {
    const conv = await db.get('SELECT * FROM conversations WHERE location_id = ? AND contact_id = ?', [
      location.id, contact.id,
    ]);
    if (conv && !conv.ai_paused) {
      try {
        const agent = require('../services/agent');
        const { reply } = await agent.respond({ location, contact, conversationId: conv.id, inbound: body });
        if (reply) {
          if (isWhatsapp) await messaging.sendWhatsapp(location.id, contact, reply);
          else await messaging.sendSms(location.id, contact, reply);
        }
      } catch (err) {
        console.error('agent error:', err.message);
      }
    }
  }

  // Twilio expects TwiML; empty response = no auto-reply.
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

// Stripe: point the webhook to POST https://<your-app>/api/webhooks/stripe
// with the checkout.session.completed event. We never trust the payload --
// the session is re-fetched from Stripe's API before settling the invoice.
router.post('/stripe', express.json(), async (req, res) => {
  const event = req.body || {};
  if (event.type !== 'checkout.session.completed') return res.json({ received: true });
  const sessionId = event.data && event.data.object && event.data.object.id;
  if (!sessionId) return res.status(400).json({ error: 'Missing session id' });
  try {
    const providers = require('../services/providers');
    const session = await providers.retrieveCheckoutSession(sessionId);
    if (session.payment_status === 'paid' && session.metadata && session.metadata.invoice_id) {
      const inv = await db.get('SELECT * FROM invoices WHERE id = ? AND token = ?', [
        session.metadata.invoice_id,
        session.metadata.invoice_token || '',
      ]);
      if (inv) await require('./payments').settleInvoice(inv.id, 'stripe');
    }
    res.json({ received: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
