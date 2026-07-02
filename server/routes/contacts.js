const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const automation = require('../services/automation');

const router = express.Router();
router.use(requireAuth, requireLocation);

async function withTags(contact) {
  if (!contact) return contact;
  const tags = await db.all('SELECT tag FROM contact_tags WHERE contact_id = ? ORDER BY tag', [contact.id]);
  return { ...contact, custom_fields: JSON.parse(contact.custom_fields || '{}'), tags: tags.map((t) => t.tag) };
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
    sql += ` AND (c.first_name || ' ' || c.last_name ILIKE ? OR c.email ILIKE ? OR c.phone ILIKE ?)`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const rows = await db.all(sql, params);
  res.json(await Promise.all(rows.map(withTags)));
});

router.post('/', async (req, res) => {
  const { first_name, last_name, email, phone, source, tags, custom_fields } = req.body || {};
  if (!first_name && !email && !phone)
    return res.status(400).json({ error: 'At least one of first_name, email or phone is required' });
  const id = await db.insert(
    `INSERT INTO contacts (location_id, first_name, last_name, email, phone, source, custom_fields)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      req.location.id,
      first_name || '',
      last_name || '',
      email || '',
      phone || '',
      source || 'manual',
      JSON.stringify(custom_fields || {}),
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
  contact.appointments = await db.all(
    'SELECT * FROM appointments WHERE contact_id = ? ORDER BY starts_at DESC LIMIT 20',
    [contact.id]
  );
  res.json(contact);
});

router.put('/:id', getContact, async (req, res) => {
  const merged = { ...req.contact, ...req.body };
  await db.run(
    `UPDATE contacts SET first_name=?, last_name=?, email=?, phone=?, source=?, dnd=?, custom_fields=?,
     updated_at=now() WHERE id=?`,
    [
      merged.first_name,
      merged.last_name,
      merged.email,
      merged.phone,
      merged.source,
      merged.dnd ? 1 : 0,
      JSON.stringify(
        typeof merged.custom_fields === 'string' ? JSON.parse(merged.custom_fields) : merged.custom_fields || {}
      ),
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
  res.status(201).json(await db.get('SELECT * FROM notes WHERE id = ?', [id]));
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

module.exports = router;
