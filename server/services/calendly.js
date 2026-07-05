// Calendly deep integration (v3.6). Receives Calendly v2 webhooks
// (invitee.created / invitee.canceled) at a per-connection tokenized URL and
// turns them into CRM contacts + appointments. Signature is verified with the
// webhook signing key when configured.
const crypto = require('crypto');

// Verifies the Calendly-Webhook-Signature header: "t=<ts>,v1=<hmac>", where the
// HMAC is SHA-256 of "<ts>.<rawBody>" keyed by the signing key.
function verifySignature(header, rawBody, signingKey) {
  if (!signingKey) return true; // not configured → skip (dev)
  if (!header || !rawBody) return false;
  const parts = Object.fromEntries(String(header).split(',').map((kv) => kv.split('=').map((s) => s.trim())));
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', signingKey).update(`${parts.t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Maps a Calendly webhook payload to a contact + event shape.
function mapPayload(body = {}) {
  const p = body.payload || {};
  const ev = p.scheduled_event || {};
  const name = String(p.name || '').trim();
  const parts = name.split(/\s+/);
  // Phone can arrive in questions_and_answers or text_reminder_number.
  let phone = p.text_reminder_number || '';
  for (const qa of p.questions_and_answers || []) {
    if (/phone|tel|móvil|movil|whatsapp/i.test(qa.question || '') && qa.answer) phone = qa.answer;
  }
  return {
    kind: body.event, // invitee.created | invitee.canceled
    contact: {
      email: p.email || '',
      phone,
      first_name: parts[0] || '',
      last_name: parts.slice(1).join(' '),
    },
    event: {
      title: ev.name || 'Cita de Calendly',
      start_time: ev.start_time || null,
      end_time: ev.end_time || null,
      uri: ev.uri || p.uri || '',
    },
  };
}

module.exports = { verifySignature, mapPayload };
