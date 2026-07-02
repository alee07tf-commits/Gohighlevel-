// Messaging provider abstraction. v1 ships with a simulated provider that
// records every message in the unified inbox. Swap `sendSms`/`sendEmail`
// internals for Twilio / SMTP / SendGrid without touching callers.
const db = require('../db');

async function getOrCreateConversation(locationId, contactId) {
  let conv = await db.get('SELECT * FROM conversations WHERE location_id = ? AND contact_id = ?', [
    locationId,
    contactId,
  ]);
  if (!conv) {
    const id = await db.insert('INSERT INTO conversations (location_id, contact_id) VALUES (?, ?)', [
      locationId,
      contactId,
    ]);
    conv = await db.get('SELECT * FROM conversations WHERE id = ?', [id]);
  }
  return conv;
}

async function recordMessage({ locationId, contactId, direction, channel, subject = '', body }) {
  const conv = await getOrCreateConversation(locationId, contactId);
  const id = await db.insert(
    `INSERT INTO messages (conversation_id, direction, channel, subject, body)
     VALUES (?, ?, ?, ?, ?)`,
    [conv.id, direction, channel, subject, body]
  );
  await db.run('UPDATE conversations SET last_message_at = now(), unread = unread + ? WHERE id = ?', [
    direction === 'inbound' ? 1 : 0,
    conv.id,
  ]);
  return db.get('SELECT * FROM messages WHERE id = ?', [id]);
}

// Replaces {{first_name}}, {{last_name}}, {{email}}, {{phone}} merge fields.
function mergeFields(text, contact) {
  if (!text) return '';
  return text
    .replaceAll('{{first_name}}', contact.first_name || '')
    .replaceAll('{{last_name}}', contact.last_name || '')
    .replaceAll('{{email}}', contact.email || '')
    .replaceAll('{{phone}}', contact.phone || '');
}

async function sendEmail(locationId, contact, subject, body) {
  if (contact.dnd) return null;
  return recordMessage({
    locationId,
    contactId: contact.id,
    direction: 'outbound',
    channel: 'email',
    subject: mergeFields(subject, contact),
    body: mergeFields(body, contact),
  });
}

async function sendSms(locationId, contact, body) {
  if (contact.dnd) return null;
  return recordMessage({
    locationId,
    contactId: contact.id,
    direction: 'outbound',
    channel: 'sms',
    body: mergeFields(body, contact),
  });
}

module.exports = { getOrCreateConversation, recordMessage, mergeFields, sendEmail, sendSms };
