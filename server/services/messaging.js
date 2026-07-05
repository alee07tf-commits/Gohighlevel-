// Unified messaging: every outbound message is recorded in the contact's
// inbox and, when a real provider is configured (see services/providers.js),
// also delivered for real. Message.status reflects the outcome:
// 'simulated' | 'sent' | 'failed'.
const db = require('../db');
const providers = require('./providers');
const customValues = require('./customValues');

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

// Replaces {{first_name}}, {{last_name}}, {{email}}, {{phone}}, contact custom
// field tokens, and account-level {{custom_values.KEY}} tokens. {{link:slug}}
// expands to a per-contact trigger link. `cvMap` is an optional { key: value }
// map from customValues.getMap() (callers that have it pass it in).
function mergeFields(text, contact, cvMap = {}) {
  if (!text) return '';
  let out = customValues.apply(text, cvMap);
  out = out
    .replaceAll('{{first_name}}', contact.first_name || '')
    .replaceAll('{{last_name}}', contact.last_name || '')
    .replaceAll('{{email}}', contact.email || '')
    .replaceAll('{{phone}}', contact.phone || '');
  const custom = (() => { try { return JSON.parse(contact.custom_fields || '{}'); } catch { return {}; } })();
  out = out.replace(/\{\{link:([a-z0-9-]+)\}\}/g, (_, slug) => `${process.env.APP_URL || ''}/l/${slug}?c=${contact.id}`);
  out = out.replace(/\{\{([a-z0-9_]+)\}\}/g, (m, key) => (custom[key] !== undefined ? String(custom[key]) : m));
  return out;
}

async function deliveryStatus(result) {
  if (result.provider === 'simulated') return 'simulated';
  return result.ok ? 'sent' : 'failed';
}

// SaaS rebilling hook: meter a delivered message against the sub-account wallet
// when it's on a SaaS plan with rebilling. No-op until the billing service is
// present (Phase 3) and only bills real (non-simulated) sends.
async function meterUsage(locationId, category, result) {
  if (!result || result.provider === 'simulated' || result.ok === false) return;
  try {
    await require('./billing').recordUsage(locationId, category, 1);
  } catch {
    /* billing not enabled */
  }
}

async function locationBrand(locationId) {
  const loc = await db.get('SELECT name, company, brand_color FROM locations WHERE id = ?', [locationId]);
  return {
    name: loc ? loc.name || loc.company : '',
    color: (loc && /^#[0-9a-fA-F]{6}$/.test(loc.brand_color || '') && loc.brand_color) || '#4f46e5',
  };
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Turns an authored plain-text body into a clean, branded HTML email:
// escapes, auto-links URLs, keeps paragraphs/line breaks, wraps in a simple
// responsive shell tinted with the sub-account brand colour.
function renderEmailHtml(body, { color = '#4f46e5', fromName = '' } = {}) {
  const linked = escapeHtml(body).replace(
    /(https?:\/\/[^\s<]+)/g,
    (u) => `<a href="${u}" style="color:${color};text-decoration:underline">${u}</a>`
  );
  const paragraphs = linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f4f7;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="height:4px;background:${color}"></div>
      <div style="padding:28px 30px;color:#1f2937;font-size:15px;line-height:1.6">${paragraphs}</div>
      ${fromName ? `<div style="padding:14px 30px;border-top:1px solid #eee;color:#9ca3af;font-size:12px">${escapeHtml(fromName)}</div>` : ''}
    </div></body></html>`;
}

// `ctx` may carry a pre-fetched { cvMap, brand } so bulk senders (campaigns)
// don't re-query custom values and the location brand once per recipient.
async function sendEmail(locationId, contact, subject, body, ctx = {}) {
  if (contact.dnd) return null;
  const cv = ctx.cvMap || (await customValues.getMap(locationId));
  const mergedSubject = mergeFields(subject, contact, cv);
  const mergedBody = mergeFields(body, contact, cv);
  const brand = ctx.brand || (await locationBrand(locationId));
  const result = await providers.deliverEmail(
    {
      to: contact.email,
      subject: mergedSubject,
      text: mergedBody,
      html: renderEmailHtml(mergedBody, { color: brand.color, fromName: brand.name }),
      fromName: brand.name,
    },
    { locationId }
  );
  await meterUsage(locationId, 'email', result);
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

async function sendSms(locationId, contact, body, ctx = {}) {
  if (contact.dnd) return null;
  const merged = mergeFields(body, contact, ctx.cvMap || (await customValues.getMap(locationId)));
  const result = await providers.deliverSms({ to: contact.phone, body: merged }, { locationId });
  await meterUsage(locationId, 'sms', result);
  return recordMessage({
    locationId,
    contactId: contact.id,
    direction: 'outbound',
    channel: 'sms',
    body: merged,
    status: await deliveryStatus(result),
  });
}

async function sendWhatsapp(locationId, contact, body, ctx = {}) {
  if (contact.dnd) return null;
  const merged = mergeFields(body, contact, ctx.cvMap || (await customValues.getMap(locationId)));
  const result = await providers.deliverWhatsapp({ to: contact.phone, body: merged }, { locationId });
  await meterUsage(locationId, 'whatsapp', result);
  return recordMessage({
    locationId,
    contactId: contact.id,
    direction: 'outbound',
    channel: 'whatsapp',
    body: merged,
    status: await deliveryStatus(result),
  });
}

// Channel-generic helper used by campaigns and workflow actions. `ctx` may carry
// a pre-fetched { cvMap, brand } for bulk sends.
async function sendByChannel(channel, locationId, contact, { subject = '', body }, ctx = {}) {
  if (channel === 'email') return sendEmail(locationId, contact, subject, body, ctx);
  if (channel === 'whatsapp') return sendWhatsapp(locationId, contact, body, ctx);
  if (channel === 'chat')
    // Web chat lives in our own widget — no external provider, just the inbox.
    return recordMessage({
      locationId, contactId: contact.id, direction: 'outbound', channel: 'chat',
      body: mergeFields(body, contact, ctx.cvMap || (await customValues.getMap(locationId))),
    });
  return sendSms(locationId, contact, body, ctx);
}

// Builds the shared send context (custom values + brand) once for a location.
async function buildSendContext(locationId) {
  const [cvMap, brand] = await Promise.all([customValues.getMap(locationId), locationBrand(locationId)]);
  return { cvMap, brand };
}

module.exports = {
  getOrCreateConversation,
  recordMessage,
  mergeFields,
  renderEmailHtml,
  buildSendContext,
  sendEmail,
  sendSms,
  sendWhatsapp,
  sendByChannel,
};
