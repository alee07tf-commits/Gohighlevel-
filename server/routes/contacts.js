const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const automation = require('../services/automation');
const scoring = require('../services/scoring');
const messaging = require('../services/messaging');

const router = express.Router();
router.use(requireAuth, requireLocation);

function parseCF(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}
function parseArr(raw) {
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v.filter(Boolean) : []; } catch { return []; }
}
function enrich(c) {
  return { ...c, custom_fields: parseCF(c.custom_fields), additional_emails: parseArr(c.additional_emails), additional_phones: parseArr(c.additional_phones) };
}

async function withTags(contact) {
  if (!contact) return contact;
  const tags = await db.all('SELECT tag FROM contact_tags WHERE contact_id = ? ORDER BY tag', [contact.id]);
  return { ...enrich(contact), tags: tags.map((t) => t.tag) };
}

// Attaches tags to many contacts with a single grouped query (avoids N+1).
async function withTagsBulk(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');
  const tagRows = await db.all(`SELECT contact_id, tag FROM contact_tags WHERE contact_id IN (${ph}) ORDER BY tag`, ids);
  const byId = {};
  for (const tr of tagRows) (byId[tr.contact_id] || (byId[tr.contact_id] = [])).push(tr.tag);
  return rows.map((c) => ({ ...enrich(c), tags: byId[c.id] || [] }));
}

router.get('/', async (req, res) => {
  const { q, tag, limit = 200, offset = 0 } = req.query;
  let sql = 'SELECT DISTINCT c.* FROM contacts c';
  const params = [];
  if (tag) {
    sql += ' JOIN contact_tags ct ON ct.contact_id = c.id AND ct.tag = ?';
    params.push(tag);
  }
  sql += ' WHERE c.location_id = ?';
  params.push(req.location.id);
  if (q) {
    sql += ` AND (c.first_name || ' ' || c.last_name ILIKE ? OR c.email ILIKE ? OR c.phone ILIKE ?
             OR c.additional_emails ILIKE ? OR c.additional_phones ILIKE ?)`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const rows = await db.all(sql, params);
  res.json(await withTagsBulk(rows));
});

router.post('/', async (req, res) => {
  const { first_name, last_name, email, phone, source, tags, custom_fields, company_id } = req.body || {};
  if (!first_name && !email && !phone)
    return res.status(400).json({ error: 'At least one of first_name, email or phone is required' });
  let companyId = company_id ? Number(company_id) : null;
  if (companyId) {
    const co = await db.get('SELECT id FROM companies WHERE id = ? AND location_id = ?', [companyId, req.location.id]);
    if (!co) companyId = null;
  }
  const id = await db.insert(
    `INSERT INTO contacts (location_id, first_name, last_name, email, phone, source, custom_fields, company_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.location.id,
      first_name || '',
      last_name || '',
      email || '',
      phone || '',
      source || 'manual',
      JSON.stringify(custom_fields || {}),
      companyId,
    ]
  );
  const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
  for (const tag of tags || []) {
    await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [contact.id, tag]);
  }
  await automation.logActivity(req.location.id, contact.id, 'contact', 'Contact created');
  await automation.trigger(req.location.id, 'contact_created', contact);
  for (const tag of tags || []) await automation.trigger(req.location.id, 'tag_added', contact, { tag });
  res.status(201).json(await withTags(contact));
});

async function getContact(req, res, next) {
  const contact = await db.get('SELECT * FROM contacts WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  req.contact = contact;
  next();
}

// Whether a contact's DND blocks a channel (global DND, or per-channel).
function dndBlocks(c, channel) {
  if (c.dnd) return true;
  if (channel === 'email') return !!c.dnd_email;
  if (channel === 'sms' || channel === 'whatsapp') return !!c.dnd_sms;
  return false;
}

// Returns the caller-owned contact rows for a set of ids (scopes to location).
async function ownedContacts(ids, locationId) {
  const clean = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!clean.length) return [];
  const ph = clean.map(() => '?').join(',');
  return db.all(`SELECT * FROM contacts WHERE location_id = ? AND id IN (${ph})`, [locationId, ...clean]);
}

// ---- Bulk actions (defined before /:id/* so "bulk" is never read as an id) ----
router.post('/bulk/tags', async (req, res) => {
  const { ids, tag, op = 'add' } = req.body || {};
  if (!tag) return res.status(400).json({ error: 'tag is required' });
  const rows = await ownedContacts(ids, req.location.id);
  for (const c of rows) {
    if (op === 'remove') {
      await db.run('DELETE FROM contact_tags WHERE contact_id = ? AND tag = ?', [c.id, tag]);
    } else {
      const info = await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [c.id, tag]);
      if (info.changes) await automation.trigger(req.location.id, 'tag_added', await withTags(c), { tag });
    }
  }
  res.json({ ok: true, affected: rows.length });
});

router.post('/bulk/delete', async (req, res) => {
  const rows = await ownedContacts(req.body?.ids, req.location.id);
  for (const c of rows) await db.run('DELETE FROM contacts WHERE id = ?', [c.id]);
  res.json({ ok: true, affected: rows.length });
});

router.post('/bulk/message', async (req, res) => {
  const { ids, channel = 'sms', subject = '', body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  const rows = await ownedContacts(ids, req.location.id);
  let sent = 0, skipped = 0;
  for (const c of rows) {
    if (dndBlocks(c, channel)) { skipped++; continue; }
    try { await messaging.sendByChannel(channel, req.location.id, await withTags(c), { subject, body }); sent++; }
    catch { skipped++; }
  }
  res.json({ ok: true, sent, skipped });
});

router.post('/bulk/workflow', async (req, res) => {
  const { ids, workflow_id } = req.body || {};
  if (!workflow_id) return res.status(400).json({ error: 'workflow_id is required' });
  const rows = await ownedContacts(ids, req.location.id);
  let enrolled = 0;
  for (const c of rows) if (await automation.enroll(req.location.id, workflow_id, await withTags(c))) enrolled++;
  res.json({ ok: true, enrolled });
});

// ---- Advanced filtered search (multi-condition; savable as a smart list) ----
// filters: [{ field, op, value }]; match: 'all' | 'any'. Supported fields:
// name, email, phone (contains); tag / no_tag; dnd; source; owner; score_gte;
// created_before / created_after (ISO); has_opportunity; custom:<key>.
function buildFilter(filters, match, locationId) {
  const where = ['c.location_id = ?'];
  const params = [locationId];
  const conds = [];
  for (const f of Array.isArray(filters) ? filters : []) {
    const v = f.value;
    switch (f.field) {
      case 'name': conds.push(`(c.first_name || ' ' || c.last_name ILIKE ?)`); params.push(`%${v}%`); break;
      case 'email': conds.push('c.email ILIKE ?'); params.push(`%${v}%`); break;
      case 'phone': conds.push('c.phone ILIKE ?'); params.push(`%${v}%`); break;
      case 'source': conds.push('c.source = ?'); params.push(v); break;
      case 'dnd': conds.push('c.dnd = ?'); params.push(v ? 1 : 0); break;
      case 'owner': conds.push('c.owner_user_id = ?'); params.push(Number(v) || 0); break;
      case 'score_gte': conds.push('COALESCE(c.score,0) >= ?'); params.push(Number(v) || 0); break;
      case 'created_after': conds.push('c.created_at >= ?'); params.push(v); break;
      case 'created_before': conds.push('c.created_at <= ?'); params.push(v); break;
      case 'tag': conds.push('EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag = ?)'); params.push(v); break;
      case 'no_tag': conds.push('NOT EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag = ?)'); params.push(v); break;
      case 'has_opportunity': conds.push('EXISTS (SELECT 1 FROM opportunities o WHERE o.contact_id = c.id)'); break;
      default:
        if (typeof f.field === 'string' && f.field.startsWith('custom:')) {
          // JSON text match on a custom field key (DB-agnostic LIKE).
          conds.push('c.custom_fields LIKE ?'); params.push(`%${JSON.stringify(f.field.slice(7))}:%${v}%`);
        }
    }
  }
  if (conds.length) where.push(`(${conds.join(match === 'any' ? ' OR ' : ' AND ')})`);
  return { where: where.join(' AND '), params };
}

router.post('/search', async (req, res) => {
  const { filters, match = 'all', limit = 200, offset = 0 } = req.body || {};
  const { where, params } = buildFilter(filters, match, req.location.id);
  const rows = await db.all(
    `SELECT c.* FROM contacts c WHERE ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );
  res.json(await withTagsBulk(rows));
});

router.get('/:id', getContact, async (req, res) => {
  const contact = await withTags(req.contact);
  contact.notes = await db.all(
    `SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id
     WHERE n.contact_id = ? ORDER BY n.created_at DESC`,
    [contact.id]
  );
  contact.activities = await db.all(
    'SELECT * FROM activities WHERE contact_id = ? ORDER BY created_at DESC LIMIT 50',
    [contact.id]
  );
  contact.opportunities = await db.all(
    `SELECT o.*, p.name AS pipeline_name, s.name AS stage_name FROM opportunities o
     JOIN pipelines p ON p.id = o.pipeline_id JOIN stages s ON s.id = o.stage_id
     WHERE o.contact_id = ? ORDER BY o.created_at DESC`,
    [contact.id]
  );
  contact.tasks = await db.all(
    `SELECT t.*, u.name AS user_name FROM tasks t LEFT JOIN users u ON u.id = t.user_id
     WHERE t.contact_id = ? ORDER BY t.status, t.due_at NULLS LAST LIMIT 20`,
    [contact.id]
  );
  if (contact.owner_user_id) {
    const owner = await db.get('SELECT name FROM users WHERE id = ?', [contact.owner_user_id]);
    contact.owner_name = owner ? owner.name : null;
  }
  if (contact.company_id) {
    contact.company = await db.get('SELECT id, name FROM companies WHERE id = ? AND location_id = ?', [contact.company_id, req.location.id]);
  }
  contact.appointments = await db.all(
    'SELECT * FROM appointments WHERE contact_id = ? ORDER BY starts_at DESC LIMIT 20',
    [contact.id]
  );
  res.json(contact);
});

router.put('/:id', getContact, async (req, res) => {
  const merged = { ...req.contact, ...req.body };
  let customFieldsJson;
  try {
    customFieldsJson = JSON.stringify(
      typeof merged.custom_fields === 'string' ? JSON.parse(merged.custom_fields) : merged.custom_fields || {}
    );
  } catch {
    return res.status(400).json({ error: 'custom_fields no es JSON válido' });
  }
  const asArr = (v) => JSON.stringify(Array.isArray(v) ? v.filter(Boolean) : parseArr(v));
  // Validate the company belongs to this location (or clear it).
  let companyId = merged.company_id ? Number(merged.company_id) : null;
  if (companyId) {
    const co = await db.get('SELECT id FROM companies WHERE id = ? AND location_id = ?', [companyId, req.location.id]);
    if (!co) companyId = null;
  }
  await db.run(
    `UPDATE contacts SET first_name=?, last_name=?, email=?, phone=?, source=?, dnd=?, dnd_email=?, dnd_sms=?,
     owner_user_id=?, company_id=?, additional_emails=?, additional_phones=?, custom_fields=?, updated_at=now() WHERE id=?`,
    [
      merged.first_name,
      merged.last_name,
      merged.email,
      merged.phone,
      merged.source,
      merged.dnd ? 1 : 0,
      merged.dnd_email ? 1 : 0,
      merged.dnd_sms ? 1 : 0,
      merged.owner_user_id || null,
      companyId,
      asArr(merged.additional_emails),
      asArr(merged.additional_phones),
      customFieldsJson,
      req.contact.id,
    ]
  );
  res.json(await withTags(await db.get('SELECT * FROM contacts WHERE id = ?', [req.contact.id])));
});

router.delete('/:id', getContact, async (req, res) => {
  await db.run('DELETE FROM contacts WHERE id = ?', [req.contact.id]);
  res.json({ ok: true });
});

router.post('/:id/tags', getContact, async (req, res) => {
  const { tag } = req.body || {};
  if (!tag) return res.status(400).json({ error: 'tag is required' });
  const info = await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [
    req.contact.id,
    tag,
  ]);
  if (info.changes) {
    await scoring.addScore(req.contact.id, 'tag_added');
    await automation.logActivity(req.location.id, req.contact.id, 'tag', `Tag "${tag}" added`);
    await automation.trigger(req.location.id, 'tag_added', req.contact, { tag });
  }
  res.json(await withTags(await db.get('SELECT * FROM contacts WHERE id = ?', [req.contact.id])));
});

router.delete('/:id/tags/:tag', getContact, async (req, res) => {
  await db.run('DELETE FROM contact_tags WHERE contact_id = ? AND tag = ?', [req.contact.id, req.params.tag]);
  res.json(await withTags(await db.get('SELECT * FROM contacts WHERE id = ?', [req.contact.id])));
});

router.post('/:id/notes', getContact, async (req, res) => {
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  const id = await db.insert('INSERT INTO notes (contact_id, user_id, body) VALUES (?, ?, ?)', [
    req.contact.id,
    req.user.id,
    body,
  ]);
  await automation.logActivity(req.location.id, req.contact.id, 'note', 'Note added');
  await automation.trigger(req.location.id, 'note_added', await withTags(req.contact), { note: body });
  res.status(201).json(await db.get('SELECT * FROM notes WHERE id = ?', [id]));
});

// ---- Quick actions from the contact card ----
// Send a message directly to this contact (opens/uses its conversation).
router.post('/:id/message', getContact, async (req, res) => {
  const { channel = 'sms', subject = '', body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  if (dndBlocks(req.contact, channel)) return res.status(400).json({ error: 'El contacto tiene DND activado para este canal' });
  const message = await messaging.sendByChannel(channel, req.location.id, await withTags(req.contact), { subject, body });
  res.status(201).json(message);
});

// Enroll this contact into a workflow.
router.post('/:id/workflow', getContact, async (req, res) => {
  const { workflow_id } = req.body || {};
  if (!workflow_id) return res.status(400).json({ error: 'workflow_id is required' });
  const ok = await automation.enroll(req.location.id, workflow_id, await withTags(req.contact));
  if (!ok) return res.status(404).json({ error: 'Workflow not found' });
  res.json({ ok: true });
});

// ---- CSV import/export ----
router.get('/export/csv', async (req, res) => {
  const rows = await db.all('SELECT * FROM contacts WHERE location_id = ? ORDER BY id LIMIT 50000', [req.location.id]);
  const withT = await withTagsBulk(rows);
  const escCsv = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = [
    'first_name,last_name,email,phone,source,tags,score,created_at',
    ...withT.map((c) =>
      [c.first_name, c.last_name, c.email, c.phone, c.source, c.tags.join(';'), c.score, c.created_at]
        .map(escCsv)
        .join(',')
    ),
  ].join('\n');
  res.type('text/csv').attachment('contacts.csv').send(csv);
});

// Import: header row with first_name,last_name,email,phone,tags (tags split by ";").
// Imported contacts do NOT fire automations (avoids mass-send accidents).
router.post('/import/csv', async (req, res) => {
  const { csv } = req.body || {};
  if (!csv) return res.status(400).json({ error: 'csv is required' });
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return res.status(400).json({ error: 'CSV needs a header row and at least one data row' });
  const parseLine = (line) => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  let imported = 0, skipped = 0;
  for (const line of lines.slice(1)) {
    const cols = parseLine(line);
    const get = (name) => (idx(name) >= 0 ? (cols[idx(name)] || '').trim() : '');
    const email = get('email'), phone = get('phone'), first = get('first_name');
    if (!email && !phone && !first) { skipped++; continue; }
    const existing =
      (email && (await db.get(`SELECT id FROM contacts WHERE location_id = ? AND email = ? AND email != ''`, [req.location.id, email]))) ||
      (phone && (await db.get(`SELECT id FROM contacts WHERE location_id = ? AND phone = ? AND phone != ''`, [req.location.id, phone])));
    if (existing) { skipped++; continue; }
    const cid = await db.insert(
      'INSERT INTO contacts (location_id, first_name, last_name, email, phone, source) VALUES (?, ?, ?, ?, ?, ?)',
      [req.location.id, first, get('last_name'), email, phone, 'import']
    );
    for (const tag of get('tags').split(';').map((t) => t.trim()).filter(Boolean)) {
      await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [cid, tag]);
    }
    imported++;
  }
  res.json({ imported, skipped });
});

// Distinct tags in this location (for filters/segments).
router.get('/meta/tags', async (req, res) => {
  res.json(
    await db.all(
      `SELECT ct.tag, COUNT(*)::int AS count FROM contact_tags ct
       JOIN contacts c ON c.id = ct.contact_id WHERE c.location_id = ?
       GROUP BY ct.tag ORDER BY ct.tag`,
      [req.location.id]
    )
  );
});

// ---- Smart lists (saved filters) ----
router.get('/meta/smart-lists', async (req, res) => {
  const lists = await db.all('SELECT * FROM smart_lists WHERE location_id = ? ORDER BY id', [req.location.id]);
  res.json(lists.map((l) => ({ ...l, filters: JSON.parse(l.filters || '{}') })));
});

router.post('/meta/smart-lists', async (req, res) => {
  const { name, filters } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = await db.insert('INSERT INTO smart_lists (location_id, name, filters) VALUES (?, ?, ?)', [
    req.location.id, name, JSON.stringify(filters || {}),
  ]);
  res.status(201).json(await db.get('SELECT * FROM smart_lists WHERE id = ?', [id]));
});

router.delete('/meta/smart-lists/:id', async (req, res) => {
  const info = await db.run('DELETE FROM smart_lists WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!info.changes) return res.status(404).json({ error: 'List not found' });
  res.json({ ok: true });
});

// ---- Duplicate detection & merge ----
router.get('/meta/duplicates', async (req, res) => {
  const byEmail = await db.all(
    `SELECT email AS value, 'email' AS kind, array_agg(id ORDER BY id) AS ids
     FROM contacts WHERE location_id = ? AND email != '' GROUP BY email HAVING COUNT(*) > 1`,
    [req.location.id]
  );
  const byPhone = await db.all(
    `SELECT phone AS value, 'phone' AS kind, array_agg(id ORDER BY id) AS ids
     FROM contacts WHERE location_id = ? AND phone != '' GROUP BY phone HAVING COUNT(*) > 1`,
    [req.location.id]
  );
  const groups = [...byEmail, ...byPhone];
  const detailed = [];
  for (const g of groups) {
    const rows = await db.all(`SELECT id, first_name, last_name, email, phone, source, created_at FROM contacts WHERE id = ANY(?)`, [g.ids]);
    detailed.push({ kind: g.kind, value: g.value, contacts: rows });
  }
  res.json(detailed);
});

// Merge `merge_id` into `keep_id`: children move over, tags union, then the
// duplicate is deleted.
router.post('/merge', async (req, res) => {
  const { keep_id, merge_id } = req.body || {};
  if (!keep_id || !merge_id || Number(keep_id) === Number(merge_id))
    return res.status(400).json({ error: 'keep_id and merge_id required' });
  const keep = await db.get('SELECT * FROM contacts WHERE id = ? AND location_id = ?', [keep_id, req.location.id]);
  const dup = await db.get('SELECT * FROM contacts WHERE id = ? AND location_id = ?', [merge_id, req.location.id]);
  if (!keep || !dup) return res.status(404).json({ error: 'Contact not found' });

  await db.tx(async (t) => {
    for (const table of ['notes', 'activities', 'opportunities', 'appointments', 'form_submissions', 'review_requests', 'tasks', 'invoices', 'campaign_recipients', 'workflow_runs']) {
      await t.run(`UPDATE ${table} SET contact_id = ? WHERE contact_id = ?`, [keep.id, dup.id]);
    }
    const dupTags = await t.all('SELECT tag FROM contact_tags WHERE contact_id = ?', [dup.id]);
    for (const r of dupTags) {
      await t.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [keep.id, r.tag]);
    }
    const keepConv = await t.get('SELECT * FROM conversations WHERE location_id = ? AND contact_id = ?', [req.location.id, keep.id]);
    const dupConv = await t.get('SELECT * FROM conversations WHERE location_id = ? AND contact_id = ?', [req.location.id, dup.id]);
    if (dupConv && !keepConv) {
      await t.run('UPDATE conversations SET contact_id = ? WHERE id = ?', [keep.id, dupConv.id]);
    } else if (dupConv && keepConv) {
      await t.run('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?', [keepConv.id, dupConv.id]);
      await t.run('DELETE FROM conversations WHERE id = ?', [dupConv.id]);
    }
    // Fill gaps in the kept contact from the duplicate.
    await t.run(
      `UPDATE contacts SET email = CASE WHEN email = '' THEN ? ELSE email END,
        phone = CASE WHEN phone = '' THEN ? ELSE phone END,
        last_name = CASE WHEN last_name = '' THEN ? ELSE last_name END WHERE id = ?`,
      [dup.email, dup.phone, dup.last_name, keep.id]
    );
    await t.run('DELETE FROM contacts WHERE id = ?', [dup.id]);
  });
  await automation.logActivity(req.location.id, keep.id, 'note', `Merged duplicate contact #${dup.id}`);
  res.json({ ok: true });
});

module.exports = router;
