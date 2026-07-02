const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const messaging = require('../services/messaging');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT cv.*, c.first_name, c.last_name, c.email, c.phone,
           (SELECT body FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body,
           (SELECT channel FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_channel
         FROM conversations cv JOIN contacts c ON c.id = cv.contact_id
         WHERE cv.location_id = ? ORDER BY cv.last_message_at DESC`
      )
      .all(req.location.id)
  );
});

function getConversation(req, res, next) {
  const conv = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND location_id = ?')
    .get(req.params.id, req.location.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  req.conversation = conv;
  next();
}

router.get('/:id/messages', getConversation, (req, res) => {
  db.prepare('UPDATE conversations SET unread = 0 WHERE id = ?').run(req.conversation.id);
  res.json(
    db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, id').all(req.conversation.id)
  );
});

// Send an outbound message (simulated provider records it in the inbox).
router.post('/:id/messages', getConversation, (req, res) => {
  const { channel = 'sms', subject = '', body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.conversation.contact_id);
  if (contact.dnd) return res.status(400).json({ error: 'Contact has DND enabled' });
  const message =
    channel === 'email'
      ? messaging.sendEmail(req.location.id, contact, subject, body)
      : messaging.sendSms(req.location.id, contact, body);
  res.status(201).json(message);
});

// Start (or reuse) a conversation with a contact.
router.post('/start/:contactId', (req, res) => {
  const contact = db
    .prepare('SELECT * FROM contacts WHERE id = ? AND location_id = ?')
    .get(req.params.contactId, req.location.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  res.json(messaging.getOrCreateConversation(req.location.id, contact.id));
});

// Simulate an inbound message (webhook stand-in for Twilio/Mailgun in v1).
router.post('/:id/simulate-inbound', getConversation, (req, res) => {
  const { channel = 'sms', body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  const message = messaging.recordMessage({
    locationId: req.location.id,
    contactId: req.conversation.contact_id,
    direction: 'inbound',
    channel,
    body,
  });
  res.status(201).json(message);
});

module.exports = router;
