// Client-facing reports: the agency generates a white-label summary of the
// last N days for a sub-account, gets a public share link (/r/<token>) and
// can email it to the client. Narrative is AI-written when configured.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const ai = require('../services/ai');
const providers = require('../services/providers');

const router = express.Router();
router.use(requireAuth, requireLocation);

async function computeStats(locationId, days) {
  const one = (sql, ...p) => db.get(sql, p);
  const interval = `${Number(days)} days`;
  const [nc, fs, appts, msgs, opps, pipeline, won] = await Promise.all([
    one(`SELECT COUNT(*)::int AS n FROM contacts WHERE location_id = ? AND created_at >= now() - ?::interval`, locationId, interval),
    one(`SELECT COUNT(*)::int AS n FROM form_submissions WHERE location_id = ? AND created_at >= now() - ?::interval`, locationId, interval),
    one(`SELECT COUNT(*)::int AS n FROM appointments WHERE location_id = ? AND created_at >= now() - ?::interval`, locationId, interval),
    one(
      `SELECT COUNT(*)::int AS n FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
       WHERE cv.location_id = ? AND m.direction = 'outbound' AND m.created_at >= now() - ?::interval`,
      locationId, interval
    ),
    one(`SELECT COUNT(*)::int AS n FROM opportunities WHERE location_id = ? AND created_at >= now() - ?::interval`, locationId, interval),
    one(`SELECT COALESCE(SUM(value),0)::float AS v FROM opportunities WHERE location_id = ? AND status = 'open'`, locationId),
    one(`SELECT COALESCE(SUM(value),0)::float AS v FROM opportunities WHERE location_id = ? AND status = 'won' AND updated_at >= now() - ?::interval`, locationId, interval),
  ]);
  return {
    new_contacts: nc.n,
    form_submissions: fs.n,
    appointments: appts.n,
    messages_sent: msgs.n,
    opportunities_created: opps.n,
    pipeline_value: pipeline.v,
    won_value: won.v,
  };
}

router.get('/', async (req, res) => {
  res.json(
    await db.all('SELECT id, token, period_days, created_at FROM reports WHERE location_id = ? ORDER BY id DESC LIMIT 20', [
      req.location.id,
    ])
  );
});

router.post('/generate', async (req, res) => {
  const days = Math.min(Math.max(Number(req.body?.period_days) || 30, 1), 365);
  const stats = await computeStats(req.location.id, days);
  const narrative = await ai.reportNarrative(req.location.name, stats, days, { locationId: req.location.id, agencyId: req.user.agency_id });
  const token = crypto.randomBytes(12).toString('hex');
  const id = await db.insert(
    'INSERT INTO reports (location_id, token, period_days, narrative, data) VALUES (?, ?, ?, ?, ?)',
    [req.location.id, token, days, narrative, JSON.stringify(stats)]
  );
  res.status(201).json({ id, token, period_days: days, narrative, stats, url: `/r/${token}` });
});

// Email the report link to the sub-account's contact email.
router.post('/:id/send', async (req, res) => {
  const report = await db.get('SELECT * FROM reports WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  const to = req.body?.email || req.location.email;
  if (!to) return res.status(400).json({ error: 'No destination email: set the sub-account email in Settings' });
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const result = await providers.deliverEmail({
    to,
    subject: `Informe de resultados — ${req.location.name}`,
    text: `Hola,\n\nAquí tienes el informe de los últimos ${report.period_days} días de ${req.location.name}:\n${base}/r/${report.token}\n\n${report.narrative}\n\nUn saludo`,
    fromName: req.location.name,
  });
  res.json({ ok: true, delivery: result.provider === 'simulated' ? 'simulated (configura email real)' : 'sent', to });
});

module.exports = router;
