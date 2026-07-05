// Shared lead ingestion: upsert a contact into a sub-account from an external
// source (generic inbound webhook, Meta Lead Ads, etc.) and fire the same
// contact_created / form_submitted / tag_added automations. Centralised so every
// "connect a lead source" path behaves identically.
const db = require('../db');
const automation = require('./automation');
const scoring = require('./scoring');

// Splits a full name into first/last when first_name is absent.
function splitName(data) {
  let first_name = data.first_name || '';
  let last_name = data.last_name || '';
  if (!first_name && data.name) {
    const parts = String(data.name).trim().split(/\s+/);
    first_name = parts[0] || '';
    last_name = parts.slice(1).join(' ');
  }
  return { first_name, last_name };
}

// Ingests a lead. Returns { contact_id, created }. `source` labels the origin
// (e.g. "webhook:Landing" or "meta:Formulario X"). `custom` are extra fields.
async function ingestLead({ location_id, email = '', phone = '', first_name, last_name, name, source = 'external', tag = '', custom = {}, activityLabel } = {}) {
  email = String(email || '').trim();
  phone = String(phone || '').trim();
  if (!email && !phone) throw Object.assign(new Error('email or phone is required'), { status: 400 });
  const names = first_name || last_name ? { first_name: first_name || '', last_name: last_name || '' } : splitName({ name });

  let contact = null;
  if (email) contact = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND email = ? AND email != ''`, [location_id, email]);
  if (!contact && phone) contact = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND phone = ? AND phone != ''`, [location_id, phone]);

  let isNew = false;
  if (!contact) {
    const id = await db.insert(
      `INSERT INTO contacts (location_id, first_name, last_name, email, phone, source, custom_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [location_id, names.first_name, names.last_name, email, phone, source, JSON.stringify(custom || {})]
    );
    contact = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
    isNew = true;
  } else if (custom && Object.keys(custom).length) {
    let existing = {};
    try { existing = JSON.parse(contact.custom_fields || '{}'); } catch { existing = {}; }
    await db.run('UPDATE contacts SET custom_fields = ? WHERE id = ?', [JSON.stringify({ ...existing, ...custom }), contact.id]);
  }

  if (tag) await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [contact.id, tag]);
  await scoring.addScore(contact.id, 'form_submitted');
  if (activityLabel) await automation.logActivity(location_id, contact.id, 'form', activityLabel);
  if (isNew) await automation.trigger(location_id, 'contact_created', contact);
  await automation.trigger(location_id, 'form_submitted', contact, { source });
  if (tag) await automation.trigger(location_id, 'tag_added', contact, { tag });
  return { contact_id: contact.id, created: isNew };
}

module.exports = { ingestLead, splitName };
