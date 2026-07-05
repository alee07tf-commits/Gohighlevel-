const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const messaging = require('../services/messaging');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/', async (req, res) => {
  res.json(
    await db.all(
      `SELECT cv.*, c.first_name, c.last_name, c.email, c.phone,
         (SELECT body FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body,
         (SELECT channel FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_channel
       FROM conversations cv JOIN contacts c ON c.id = cv.contact_id
       WHERE cv.location_id = ? ORDER BY cv.last_message_at DESC`,
      [req.location.id]
    )
  );
});

async function getConversation(req, res, next) {
  const conv = await db.get('SELECT * FROM conversations WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  req.conversation = conv;
  next();
}

router.get('/:id/messages', getConversation, async (req, res) => {
  await db.run('UPDATE conversations SET unread = 0 WHERE id = ?', [req.conversation.id]);
  res.json(
    await db.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, id', [req.conversation.id])
  );
});

// Send an outbound message (simulated provider records it in the inbox).
router.post('/:id/messages', getConversation, async (req, res) => {
  const { channel = 'sms', subject = '', body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [req.conversation.contact_id]);
  if (contact.dnd) return res.status(400).json({ error: 'Contact has DND enabled' });
  const message = await messaging.sendByChannel(channel, req.location.id, contact, { subject, body });
  res.status(201).json(message);
});

// Start (or reuse) a conversation with a contact.
router.post('/start/:contactId', async (req, res) => {
  const contact = await db.get('SELECT * FROM contacts WHERE id = ? AND location_id = ?', [
    req.params.contactId,
    req.location.id,
  ]);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  res.json(await messaging.getOrCreateConversation(req.location.id, contact.id));
});

// Simulate an inbound message (testing tool; real inbound arrives via
// /api/webhooks/twilio/:locationId).
router.post('/:id/simulate-inbound', getConversation, async (req, res) => {
  const { channel = 'sms', body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  if (!['sms', 'email', 'whatsapp', 'chat', 'note'].includes(channel))
    return res.status(400).json({ error: 'Canal no válido' });
  const message = await messaging.recordMessage({
    locationId: req.location.id,
    contactId: req.conversation.contact_id,
    direction: 'inbound',
    channel,
    body,
  });
  await require('../services/scoring').addScore(req.conversation.contact_id, 'inbound_message');
  res.status(201).json(message);
});

// Pause/resume the AI agent for one conversation (human takeover).
router.put('/:id/ai', getConversation, async (req, res) => {
  await db.run('UPDATE conversations SET ai_paused = ? WHERE id = ?', [req.body?.paused ? 1 : 0, req.conversation.id]);
  res.json({ ok: true, ai_paused: req.body?.paused ? 1 : 0 });
});

module.exports = router;
