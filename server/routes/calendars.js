const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const automation = require('../services/automation');
const scheduler = require('../services/scheduler');
const scoring = require('../services/scoring');

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

async function uniqueSlug(base) {
  let slug = base;
  let i = 1;
  while (await db.get('SELECT id FROM calendars WHERE slug = ?', [slug])) slug = `${base}-${i++}`;
  return slug;
}

router.get('/', async (req, res) => {
  res.json(await db.all('SELECT * FROM calendars WHERE location_id = ? ORDER BY id', [req.location.id]));
});

router.post('/', async (req, res) => {
  const { name, description, duration_minutes, start_hour, end_hour, days, reminder_hours } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = await db.insert(
    `INSERT INTO calendars (location_id, name, slug, description, duration_minutes, start_hour, end_hour, days, reminder_hours)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.location.id,
      name,
      await uniqueSlug(slugify(name)),
      description || '',
      Number(duration_minutes) || 30,
      Number.isFinite(Number(start_hour)) && start_hour !== undefined ? Number(start_hour) : 9,
      Number.isFinite(Number(end_hour)) && end_hour !== undefined ? Number(end_hour) : 17,
      JSON.stringify(days || [1, 2, 3, 4, 5]),
      Number.isFinite(Number(reminder_hours)) && reminder_hours !== undefined ? Number(reminder_hours) : 24,
    ]
  );
  res.status(201).json(await db.get('SELECT * FROM calendars WHERE id = ?', [id]));
});

router.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM calendars WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!info.changes) return res.status(404).json({ error: 'Calendar not found' });
  res.json({ ok: true });
});

// ---- Appointments ----
router.get('/appointments/all', async (req, res) => {
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
  res.json(await db.all(sql, params));
});

router.post('/:id/appointments', async (req, res) => {
  const calendar = await db.get('SELECT * FROM calendars WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!calendar) return res.status(404).json({ error: 'Calendar not found' });
  const { contact_id, title, starts_at, ends_at, notes } = req.body || {};
  if (!title || !starts_at) return res.status(400).json({ error: 'title and starts_at are required' });
  const end =
    ends_at || new Date(new Date(starts_at).getTime() + calendar.duration_minutes * 60000).toISOString();
  const id = await db.insert(
    `INSERT INTO appointments (location_id, calendar_id, contact_id, title, starts_at, ends_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.location.id, calendar.id, contact_id || null, title, starts_at, end, notes || '']
  );
  if (contact_id) {
    const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [contact_id]);
    await scoring.addScore(contact_id, 'appointment_booked');
    await scheduler.scheduleAppointmentReminder(calendar, id, starts_at);
    await automation.logActivity(req.location.id, contact_id, 'appointment', `Appointment "${title}" booked`);
    await automation.trigger(req.location.id, 'appointment_booked', contact, { calendar_id: calendar.id });
  }
  res.status(201).json(await db.get('SELECT * FROM appointments WHERE id = ?', [id]));
});

router.put('/appointments/:id', async (req, res) => {
  const appt = await db.get('SELECT * FROM appointments WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });
  const merged = { ...appt, ...req.body };
  await db.run('UPDATE appointments SET title=?, starts_at=?, ends_at=?, status=?, notes=? WHERE id=?', [
    merged.title,
    merged.starts_at,
    merged.ends_at,
    merged.status,
    merged.notes,
    appt.id,
  ]);
  res.json(await db.get('SELECT * FROM appointments WHERE id = ?', [appt.id]));
});

router.delete('/appointments/:id', async (req, res) => {
  const info = await db.run('DELETE FROM appointments WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!info.changes) return res.status(404).json({ error: 'Appointment not found' });
  res.json({ ok: true });
});

module.exports = router;
