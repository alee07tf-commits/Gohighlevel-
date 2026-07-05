const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const messaging = require('../services/messaging');

const router = express.Router();
router.use(requireAuth, requireLocation);

// Inbox list with filters: filter=all|unread|unanswered|mine and channel=<ch>.
router.get('/', async (req, res) => {
  const { filter = 'all', channel } = req.query;
  const where = ['cv.location_id = ?'];
  const params = [req.location.id];
  if (filter === 'unread') where.push('cv.unread > 0');
  if (filter === 'mine') { where.push('cv.assigned_user_id = ?'); params.push(req.user.id); }
  if (filter === 'unanswered') {
    where.push(`(SELECT direction FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) = 'inbound'`);
  }
  if (channel) {
    where.push(`(SELECT channel FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) = ?`);
    params.push(channel);
  }
  res.json(
    await db.all(
      `SELECT cv.*, c.first_name, c.last_name, c.email, c.phone, u.name AS assigned_name,
         (SELECT body FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body,
         (SELECT channel FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_channel,
         (SELECT direction FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_direction
       FROM conversations cv JOIN contacts c ON c.id = cv.contact_id
       LEFT JOIN users u ON u.id = cv.assigned_user_id
       WHERE ${where.join(' AND ')} ORDER BY cv.last_message_at DESC`,
      params
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

// Assign a conversation to a team member (or unassign with null).
router.put('/:id/assign', getConversation, async (req, res) => {
  let userId = req.body?.user_id ? Number(req.body.user_id) : null;
  if (userId) {
    const u = await db.get('SELECT id FROM users WHERE id = ? AND agency_id = ?', [userId, req.user.agency_id]);
    if (!u) userId = null;
  }
  await db.run('UPDATE conversations SET assigned_user_id = ? WHERE id = ?', [userId, req.conversation.id]);
  res.json({ ok: true, assigned_user_id: userId });
});

// Draft an AI reply suggestion from the recent thread — pure text, no side
// effects (does not send or book). Falls back to a friendly template offline.
router.post('/:id/ai-suggest', getConversation, async (req, res) => {
  const ai = require('../services/ai');
  const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [req.conversation.contact_id]);
  const msgs = await db.all('SELECT direction, channel, body FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 8', [req.conversation.id]);
  const history = msgs.reverse().map((m) => `${m.direction === 'inbound' ? 'Cliente' : 'Nosotros'}: ${m.body}`).join('\n');
  const ctx = { locationId: req.location.id, agencyId: req.user.agency_id };
  if (!(await ai.ready(ctx))) {
    const name = contact.first_name ? ` ${contact.first_name}` : '';
    return res.json({ reply: `¡Hola${name}! Gracias por tu mensaje, ¿en qué podemos ayudarte?`, provider: 'template' });
  }
  try {
    const system = 'Eres un agente de atención al cliente de un negocio local. Redacta una respuesta breve, cordial y útil al último mensaje del cliente. Devuelve solo el texto de la respuesta, sin comillas.';
    const reply = await ai.complete(system, `Conversación reciente:\n${history}\n\nRedacta la próxima respuesta nuestra.`, 400, ctx);
    res.json({ reply: (reply || '').trim(), provider: 'ai' });
  } catch (err) {
    res.json({ reply: '¡Gracias por tu mensaje! Enseguida te atendemos.', provider: 'template', error: err.message });
  }
});

module.exports = router;
