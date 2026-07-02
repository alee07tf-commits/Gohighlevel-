// Job scheduler powering workflow waits, appointment reminders and any
// future timed work. Jobs live in scheduled_jobs and are processed by tick():
//  - locally: a 30s interval (started in server/index.js)
//  - on Vercel: GET /api/cron/tick (Vercel Cron or any external pinger)
//  - lazily: any API request runs tick() at most once a minute (see index.js),
//    so waits/reminders also fire on serverless without a cron configured.
const db = require('../db');

async function schedule(locationId, runAtIso, type, payload) {
  return db.insert('INSERT INTO scheduled_jobs (location_id, run_at, type, payload) VALUES (?, ?, ?, ?)', [
    locationId,
    runAtIso,
    type,
    JSON.stringify(payload || {}),
  ]);
}

async function processJob(job) {
  const payload = JSON.parse(job.payload || '{}');
  // Lazy requires to avoid circular dependencies (automation ↔ scheduler).
  switch (job.type) {
    case 'workflow_resume': {
      const automation = require('./automation');
      const wf = await db.get('SELECT * FROM workflows WHERE id = ?', [payload.workflow_id]);
      const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [payload.contact_id]);
      if (!wf || !wf.active || !contact) return 'skipped (workflow inactive or contact gone)';
      await automation.resumeWorkflow(wf, contact, payload.start_index);
      return 'resumed';
    }
    case 'appointment_reminder': {
      const messaging = require('./messaging');
      const appt = await db.get('SELECT * FROM appointments WHERE id = ?', [payload.appointment_id]);
      if (!appt || appt.status !== 'confirmed' || !appt.contact_id) return 'skipped (appointment gone or not confirmed)';
      const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [appt.contact_id]);
      if (!contact) return 'skipped (contact gone)';
      const when = new Date(appt.starts_at).toLocaleString('es-ES', {
        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      });
      const body = `Hola {{first_name}}, te recordamos tu cita "${appt.title}" el ${when}. ¡Te esperamos!`;
      if (contact.email) await messaging.sendEmail(job.location_id, contact, `Recordatorio: ${appt.title}`, body);
      if (contact.phone) await messaging.sendSms(job.location_id, contact, body);
      return 'reminder sent';
    }
    default:
      return `unknown job type "${job.type}"`;
  }
}

// Process due jobs; returns how many were handled.
async function tick(limit = 50) {
  const due = await db.all(
    `SELECT * FROM scheduled_jobs WHERE status = 'pending' AND run_at <= now() ORDER BY run_at LIMIT ?`,
    [limit]
  );
  for (const job of due) {
    // Claim first so concurrent ticks (serverless) don't double-process.
    const claimed = await db.run(`UPDATE scheduled_jobs SET status = 'done' WHERE id = ? AND status = 'pending'`, [
      job.id,
    ]);
    if (!claimed.changes) continue;
    try {
      const result = await processJob(job);
      await db.run('UPDATE scheduled_jobs SET result = ? WHERE id = ?', [result, job.id]);
    } catch (err) {
      await db.run(`UPDATE scheduled_jobs SET status = 'error', result = ? WHERE id = ?`, [err.message, job.id]);
    }
  }
  return due.length;
}

// Queue an appointment reminder `calendar.reminder_hours` before start.
// Skips if the reminder time is already in the past.
async function scheduleAppointmentReminder(calendar, appointmentId, startsAt) {
  const hours = Number(calendar.reminder_hours);
  if (!hours || hours <= 0) return null;
  const runAt = new Date(new Date(startsAt).getTime() - hours * 3_600_000);
  if (runAt.getTime() <= Date.now()) return null;
  return schedule(calendar.location_id, runAt.toISOString(), 'appointment_reminder', {
    appointment_id: appointmentId,
  });
}

// Throttled tick for the lazy middleware.
let lastLazyTick = 0;
function lazyTick() {
  if (Date.now() - lastLazyTick < 60_000) return;
  lastLazyTick = Date.now();
  tick().catch((err) => console.error('lazy tick failed:', err.message));
}

module.exports = { schedule, tick, lazyTick, scheduleAppointmentReminder };
