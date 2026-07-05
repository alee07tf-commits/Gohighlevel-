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

// Keeps only user ids that belong to the caller's agency (for round-robin).
async function validAssignees(list, agencyId) {
  const ids = Array.isArray(list) ? list.map(Number).filter(Boolean) : [];
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const rows = await db.all(`SELECT id FROM users WHERE agency_id = ? AND id IN (${ph})`, [agencyId, ...ids]);
  return rows.map((r) => r.id);
}

function cleanBlockedDates(v) {
  const arr = Array.isArray(v) ? v : [];
  return arr.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
}

router.post('/', async (req, res) => {
  const { name, description, duration_minutes, start_hour, end_hour, days, reminder_hours, capacity, assignees, buffer_minutes, min_notice_hours, blocked_dates } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = await db.insert(
    `INSERT INTO calendars (location_id, name, slug, description, duration_minutes, start_hour, end_hour, days, reminder_hours, capacity, assignees, buffer_minutes, min_notice_hours, blocked_dates)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      Math.max(1, Number(capacity) || 1),
      JSON.stringify(await validAssignees(assignees, req.user.agency_id)),
      Math.max(0, Number(buffer_minutes) || 0),
      Math.max(0, Number(min_notice_hours) || 0),
      JSON.stringify(cleanBlockedDates(blocked_dates)),
    ]
  );
  res.status(201).json(await db.get('SELECT * FROM calendars WHERE id = ?', [id]));
});

// Update a calendar (name, availability window, buffer/notice, blocked dates,
// round-robin assignees).
router.put('/:id', async (req, res) => {
  const cal = await db.get('SELECT * FROM calendars WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!cal) return res.status(404).json({ error: 'Calendar not found' });
  const b = req.body || {};
  const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== undefined && v !== null && v !== '' ? Number(v) : fallback);
  const assignees = b.assignees !== undefined ? await validAssignees(b.assignees, req.user.agency_id) : JSON.parse(cal.assignees || '[]');
  await db.run(
    `UPDATE calendars SET name=?, description=?, duration_minutes=?, start_hour=?, end_hour=?, days=?,
       reminder_hours=?, capacity=?, assignees=?, buffer_minutes=?, min_notice_hours=?, blocked_dates=? WHERE id=?`,
    [
      b.name || cal.name, b.description ?? cal.description,
      num(b.duration_minutes, cal.duration_minutes), num(b.start_hour, cal.start_hour), num(b.end_hour, cal.end_hour),
      b.days !== undefined ? JSON.stringify(b.days) : cal.days,
      num(b.reminder_hours, cal.reminder_hours), Math.max(1, num(b.capacity, cal.capacity)),
      JSON.stringify(assignees), Math.max(0, num(b.buffer_minutes, cal.buffer_minutes)),
      Math.max(0, num(b.min_notice_hours, cal.min_notice_hours)),
      b.blocked_dates !== undefined ? JSON.stringify(cleanBlockedDates(b.blocked_dates)) : cal.blocked_dates,
      cal.id,
    ]
  );
  res.json(await db.get('SELECT * FROM calendars WHERE id = ?', [cal.id]));
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
  if (contact_id) {
    const owns = await db.get('SELECT id FROM contacts WHERE id = ? AND location_id = ?', [contact_id, req.location.id]);
    if (!owns) return res.status(400).json({ error: 'Contacto no encontrado en esta sub-cuenta' });
  }
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
  if (req.body.status && !['confirmed', 'cancelled', 'completed', 'no_show'].includes(req.body.status))
    return res.status(400).json({ error: 'Estado no válido' });
  const merged = { ...appt, ...req.body };
  await db.run('UPDATE appointments SET title=?, starts_at=?, ends_at=?, status=?, notes=? WHERE id=?', [
    merged.title,
    merged.starts_at,
    merged.ends_at,
    merged.status,
    merged.notes,
    appt.id,
  ]);
  if (req.body.status && req.body.status !== appt.status && appt.contact_id) {
    const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [appt.contact_id]);
    await automation.logActivity(req.location.id, appt.contact_id, 'appointment', `Appointment marked ${req.body.status}`);
    await automation.trigger(req.location.id, 'appointment_status_changed', contact, {
      status: req.body.status,
      calendar_id: appt.calendar_id,
    });
  }
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
