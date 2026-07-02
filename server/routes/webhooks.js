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

  // Twilio expects TwiML; empty response = no auto-reply.
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

module.exports = router;
