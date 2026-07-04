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
  const obj = (event.data && event.data.object) || {};
  const sessionId = obj.id;
  if (!sessionId) return res.status(400).json({ error: 'Missing session id' });
  try {
    const providers = require('../services/providers');
    const meta = obj.metadata || {};
    // Resolve which Stripe key created the session before re-fetching it: SaaS
    // signups use the agency's key; invoice checkouts use the sub-account's.
    let ctx = {};
    if (meta.saas_plan) ctx = { agencyId: Number(meta.saas_agency) };
    else if (meta.invoice_id) {
      const inv0 = await db.get('SELECT location_id FROM invoices WHERE id = ?', [meta.invoice_id]);
      if (inv0) ctx = { locationId: inv0.location_id };
    }
    const session = await providers.retrieveCheckoutSession(sessionId, ctx);
    const m = session.metadata || {};

    // SaaS subscription: provision the client's sub-account on first payment.
    if (m.saas_plan && (session.payment_status === 'paid' || session.status === 'complete')) {
      const agency = await db.get('SELECT * FROM agencies WHERE id = ?', [m.saas_agency]);
      const plan = await db.get('SELECT * FROM plans WHERE id = ? AND agency_id = ?', [m.saas_plan, m.saas_agency]);
      const already = await db.get('SELECT id FROM users WHERE email = ?', [m.saas_email || '']);
      if (agency && plan && !already) {
        await require('../services/saas').provisionFromPlan({
          agency, plan,
          client: { name: m.saas_name, email: m.saas_email, business_name: m.saas_business },
          stripe: { subscription_id: session.subscription || '', customer_id: session.customer || '' },
        });
      }
      return res.json({ received: true });
    }

    if (session.payment_status === 'paid' && m.invoice_id) {
      const inv = await db.get('SELECT * FROM invoices WHERE id = ? AND token = ?', [m.invoice_id, m.invoice_token || '']);
      if (inv) await require('./payments').settleInvoice(inv.id, 'stripe');
    }
    res.json({ received: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Missed-call text-back: point the Twilio phone number's *status callback*
// (or voice webhook fallback) here. When a call isn't answered, the caller
// instantly receives the location's configured SMS.
router.post('/twilio-voice/:locationId', express.urlencoded({ extended: false }), async (req, res) => {
  const location = await db.get('SELECT * FROM locations WHERE id = ?', [req.params.locationId]);
  if (!location) return res.status(404).send('Unknown location');
  const status = String(req.body.CallStatus || req.body.DialCallStatus || '').toLowerCase();
  const from = String(req.body.From || '').replace('whatsapp:', '');
  if (!['no-answer', 'busy', 'failed'].includes(status) || !from || !location.missed_call_text) {
    return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
  let contact = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND phone = ? AND phone != ''`, [
    location.id, from,
  ]);
  if (!contact) {
    const id = await db.insert(
      'INSERT INTO contacts (location_id, first_name, phone, source) VALUES (?, ?, ?, ?)',
      [location.id, from, from, 'missed-call']
    );
    contact = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
    await automation.trigger(location.id, 'contact_created', contact);
  }
  await messaging.sendSms(location.id, contact, location.missed_call_text);
  await automation.logActivity(location.id, contact.id, 'note', `Missed call → text-back sent`);
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

module.exports = router;
