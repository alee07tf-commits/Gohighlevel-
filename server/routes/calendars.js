const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const automation = require('../services/automation');

const router = express.Router();
router.use(requireAuth, requireLocation);

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'calendar'
  );
}

function uniqueSlug(base) {
  let slug = base;
  let i = 1;
  while (db.prepare('SELECT id FROM calendars WHERE slug = ?').get(slug)) slug = `${base}-${i++}`;
  return slug;
}

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM calendars WHERE location_id = ? ORDER BY id').all(req.location.id));
});

router.post('/', (req, res) => {
  const { name, description, duration_minutes, start_hour, end_hour, days } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare(
      `INSERT INTO calendars (location_id, name, slug, description, duration_minutes, start_hour, end_hour, days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.location.id,
      name,
      uniqueSlug(slugify(name)),
      description || '',
      Number(duration_minutes) || 30,
      Number.isFinite(Number(start_hour)) && start_hour !== undefined ? Number(start_hour) : 9,
      Number.isFinite(Number(end_hour)) && end_hour !== undefined ? Number(end_hour) : 17,
      JSON.stringify(days || [1, 2, 3, 4, 5])
    );
  res.status(201).json(db.prepare('SELECT * FROM calendars WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM calendars WHERE id = ? AND location_id = ?')
    .run(req.params.id, req.location.id);
  if (!info.changes) return res.status(404).json({ error: 'Calendar not found' });
  res.json({ ok: true });
});

// ---- Appointments ----
router.get('/appointments/all', (req, res) => {
  const { from, to } = req.query;
  let sql = `SELECT a.*, c.first_name, c.last_name, c.email, c.phone, cal.name AS calendar_name
             FROM appointments a
             LEFT JOIN contacts c ON c.id = a.contact_id
             JOIN calendars cal ON cal.id = a.calendar_id
             WHERE a.location_id = ?`;
  const params = [req.location.id];
  if (from) { sql += ' AND a.starts_at >= ?'; params.push(from); }
  if (to) { sql += ' AND a.starts_at <= ?'; params.push(to); }
  sql += ' ORDER BY a.starts_at';
  res.json(db.prepare(sql).all(...params));
});

router.post('/:id/appointments', (req, res) => {
  const calendar = db
    .prepare('SELECT * FROM calendars WHERE id = ? AND location_id = ?')
    .get(req.params.id, req.location.id);
  if (!calendar) return res.status(404).json({ error: 'Calendar not found' });
  const { contact_id, title, starts_at, ends_at, notes } = req.body || {};
  if (!title || !starts_at) return res.status(400).json({ error: 'title and starts_at are required' });
  const end =
    ends_at || new Date(new Date(starts_at).getTime() + calendar.duration_minutes * 60000).toISOString();
  const info = db
    .prepare(
      `INSERT INTO appointments (location_id, calendar_id, contact_id, title, starts_at, ends_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.location.id, calendar.id, contact_id || null, title, starts_at, end, notes || '');
  if (contact_id) {
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact_id);
    automation.logActivity(req.location.id, contact_id, 'appointment', `Appointment "${title}" booked`);
    automation.trigger(req.location.id, 'appointment_booked', contact, { calendar_id: calendar.id });
  }
  res.status(201).json(db.prepare('SELECT * FROM appointments WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/appointments/:id', (req, res) => {
  const appt = db
    .prepare('SELECT * FROM appointments WHERE id = ? AND location_id = ?')
    .get(req.params.id, req.location.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });
  const merged = { ...appt, ...req.body };
  db.prepare('UPDATE appointments SET title=?, starts_at=?, ends_at=?, status=?, notes=? WHERE id=?').run(
    merged.title,
    merged.starts_at,
    merged.ends_at,
    merged.status,
    merged.notes,
    appt.id
  );
  res.json(db.prepare('SELECT * FROM appointments WHERE id = ?').get(appt.id));
});

router.delete('/appointments/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM appointments WHERE id = ? AND location_id = ?')
    .run(req.params.id, req.location.id);
  if (!info.changes) return res.status(404).json({ error: 'Appointment not found' });
  res.json({ ok: true });
});

module.exports = router;
