// Unified messaging: every outbound message is recorded in the contact's
// inbox and, when a real provider is configured (see services/providers.js),
// also delivered for real. Message.status reflects the outcome:
// 'simulated' | 'sent' | 'failed'.
const db = require('../db');
const providers = require('./providers');

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

async function recordMessage({ locationId, contactId, direction, channel, subject = '', body, status = 'sent' }) {
  const conv = await getOrCreateConversation(locationId, contactId);
  const id = await db.insert(
    `INSERT INTO messages (conversation_id, direction, channel, subject, body, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [conv.id, direction, channel, subject, body, status]
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

async function deliveryStatus(result) {
  if (result.provider === 'simulated') return 'simulated';
  return result.ok ? 'sent' : 'failed';
}

async function locationName(locationId) {
  const loc = await db.get('SELECT name, company FROM locations WHERE id = ?', [locationId]);
  return loc ? loc.name || loc.company : '';
}

async function sendEmail(locationId, contact, subject, body) {
  if (contact.dnd) return null;
  const mergedSubject = mergeFields(subject, contact);
  const mergedBody = mergeFields(body, contact);
  const result = await providers.deliverEmail({
    to: contact.email,
    subject: mergedSubject,
    text: mergedBody,
    fromName: await locationName(locationId),
  });
  return recordMessage({
    locationId,
    contactId: contact.id,
    direction: 'outbound',
    channel: 'email',
    subject: mergedSubject,
    body: result.ok === false ? `${mergedBody}\n\n[Delivery failed: ${result.error}]` : mergedBody,
    status: await deliveryStatus(result),
  });
}

async function sendSms(locationId, contact, body) {
  if (contact.dnd) return null;
  const merged = mergeFields(body, contact);
  const result = await providers.deliverSms({ to: contact.phone, body: merged });
  return recordMessage({
    locationId,
    contactId: contact.id,
    direction: 'outbound',
    channel: 'sms',
    body: merged,
    status: await deliveryStatus(result),
  });
}

async function sendWhatsapp(locationId, contact, body) {
  if (contact.dnd) return null;
  const merged = mergeFields(body, contact);
  const result = await providers.deliverWhatsapp({ to: contact.phone, body: merged });
  return recordMessage({
    locationId,
    contactId: contact.id,
    direction: 'outbound',
    channel: 'whatsapp',
    body: merged,
    status: await deliveryStatus(result),
  });
}

// Channel-generic helper used by campaigns and workflow actions.
async function sendByChannel(channel, locationId, contact, { subject = '', body }) {
  if (channel === 'email') return sendEmail(locationId, contact, subject, body);
  if (channel === 'whatsapp') return sendWhatsapp(locationId, contact, body);
  return sendSms(locationId, contact, body);
}

module.exports = {
  getOrCreateConversation,
  recordMessage,
  mergeFields,
  sendEmail,
  sendSms,
  sendWhatsapp,
  sendByChannel,
};
