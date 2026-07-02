const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const automation = require('../services/automation');

const router = express.Router();
router.use(requireAuth, requireLocation);

function withTags(contact) {
  if (!contact) return contact;
  const tags = db.prepare('SELECT tag FROM contact_tags WHERE contact_id = ? ORDER BY tag').all(contact.id);
  return { ...contact, custom_fields: JSON.parse(contact.custom_fields || '{}'), tags: tags.map((t) => t.tag) };
}

router.get('/', (req, res) => {
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
    sql += ` AND (c.first_name || ' ' || c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  res.json(db.prepare(sql).all(...params).map(withTags));
});

router.post('/', (req, res) => {
  const { first_name, last_name, email, phone, source, tags, custom_fields } = req.body || {};
  if (!first_name && !email && !phone)
    return res.status(400).json({ error: 'At least one of first_name, email or phone is required' });
  const info = db
    .prepare(
      `INSERT INTO contacts (location_id, first_name, last_name, email, phone, source, custom_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.location.id,
      first_name || '',
      last_name || '',
      email || '',
      phone || '',
      source || 'manual',
      JSON.stringify(custom_fields || {})
    );
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
  for (const tag of tags || []) {
    db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)').run(contact.id, tag);
  }
  automation.logActivity(req.location.id, contact.id, 'contact', 'Contact created');
  automation.trigger(req.location.id, 'contact_created', contact);
  for (const tag of tags || []) automation.trigger(req.location.id, 'tag_added', contact, { tag });
  res.status(201).json(withTags(contact));
});

function getContact(req, res, next) {
  const contact = db
    .prepare('SELECT * FROM contacts WHERE id = ? AND location_id = ?')
    .get(req.params.id, req.location.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  req.contact = contact;
  next();
}

router.get('/:id', getContact, (req, res) => {
  const contact = withTags(req.contact);
  contact.notes = db
    .prepare(
      `SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id
       WHERE n.contact_id = ? ORDER BY n.created_at DESC`
    )
    .all(contact.id);
  contact.activities = db
    .prepare('SELECT * FROM activities WHERE contact_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(contact.id);
  contact.opportunities = db
    .prepare(
      `SELECT o.*, p.name AS pipeline_name, s.name AS stage_name FROM opportunities o
       JOIN pipelines p ON p.id = o.pipeline_id JOIN stages s ON s.id = o.stage_id
       WHERE o.contact_id = ? ORDER BY o.created_at DESC`
    )
    .all(contact.id);
  contact.appointments = db
    .prepare('SELECT * FROM appointments WHERE contact_id = ? ORDER BY starts_at DESC LIMIT 20')
    .all(contact.id);
  res.json(contact);
});

router.put('/:id', getContact, (req, res) => {
  const merged = { ...req.contact, ...req.body };
  db.prepare(
    `UPDATE contacts SET first_name=?, last_name=?, email=?, phone=?, source=?, dnd=?, custom_fields=?,
     updated_at=datetime('now') WHERE id=?`
  ).run(
    merged.first_name,
    merged.last_name,
    merged.email,
    merged.phone,
    merged.source,
    merged.dnd ? 1 : 0,
    JSON.stringify(
      typeof merged.custom_fields === 'string' ? JSON.parse(merged.custom_fields) : merged.custom_fields || {}
    ),
    req.contact.id
  );
  res.json(withTags(db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.contact.id)));
});

router.delete('/:id', getContact, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.contact.id);
  res.json({ ok: true });
});

router.post('/:id/tags', getContact, (req, res) => {
  const { tag } = req.body || {};
  if (!tag) return res.status(400).json({ error: 'tag is required' });
  const info = db
    .prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)')
    .run(req.contact.id, tag);
  if (info.changes) {
    automation.logActivity(req.location.id, req.contact.id, 'tag', `Tag "${tag}" added`);
    automation.trigger(req.location.id, 'tag_added', req.contact, { tag });
  }
  res.json(withTags(db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.contact.id)));
});

router.delete('/:id/tags/:tag', getContact, (req, res) => {
  db.prepare('DELETE FROM contact_tags WHERE contact_id = ? AND tag = ?').run(req.contact.id, req.params.tag);
  res.json(withTags(db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.contact.id)));
});

router.post('/:id/notes', getContact, (req, res) => {
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  const info = db
    .prepare('INSERT INTO notes (contact_id, user_id, body) VALUES (?, ?, ?)')
    .run(req.contact.id, req.user.id, body);
  automation.logActivity(req.location.id, req.contact.id, 'note', 'Note added');
  res.status(201).json(db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid));
});

// Distinct tags in this location (for filters/segments).
router.get('/meta/tags', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT ct.tag, COUNT(*) AS count FROM contact_tags ct
         JOIN contacts c ON c.id = ct.contact_id WHERE c.location_id = ?
         GROUP BY ct.tag ORDER BY ct.tag`
      )
      .all(req.location.id)
  );
});

module.exports = router;
