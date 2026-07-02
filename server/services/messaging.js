// Messaging provider abstraction. v1.0 ships with a simulated provider that
// records every message in the unified inbox. Swap `sendSms`/`sendEmail`
// internals for Twilio / SMTP / SendGrid without touching callers.
const db = require('../db');

function getOrCreateConversation(locationId, contactId) {
  let conv = db
    .prepare('SELECT * FROM conversations WHERE location_id = ? AND contact_id = ?')
    .get(locationId, contactId);
  if (!conv) {
    const info = db
      .prepare('INSERT INTO conversations (location_id, contact_id) VALUES (?, ?)')
      .run(locationId, contactId);
    conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
  }
  return conv;
}

function recordMessage({ locationId, contactId, direction, channel, subject = '', body }) {
  const conv = getOrCreateConversation(locationId, contactId);
  const info = db
    .prepare(
      `INSERT INTO messages (conversation_id, direction, channel, subject, body)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(conv.id, direction, channel, subject, body);
  db.prepare(
    `UPDATE conversations SET last_message_at = datetime('now'), unread = unread + ? WHERE id = ?`
  ).run(direction === 'inbound' ? 1 : 0, conv.id);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
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

function sendEmail(locationId, contact, subject, body) {
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

function sendSms(locationId, contact, body) {
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
