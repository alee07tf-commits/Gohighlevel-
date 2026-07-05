// Attribution & ROI analytics (per sub-account). Answers the question an agency
// must answer to keep clients: which lead source / funnel actually produced
// contacts, booked appointments, and won revenue — plus conversion rates.
// Each metric is a single grouped query keyed by contact.source; results are
// merged in JS to avoid the row-multiplication of joining appointments and
// opportunities together.
const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/attribution', async (req, res) => {
  const loc = req.location.id;
  const days = Math.min(3650, Math.max(1, Number(req.query.days) || 90));
  const since = `AND c.created_at >= now() - interval '${days} days'`;

  const [contacts, appts, opps] = await Promise.all([
    db.all(`SELECT c.source, COUNT(*)::int AS contacts FROM contacts c WHERE c.location_id = ? ${since} GROUP BY c.source`, [loc]),
    db.all(
      `SELECT c.source, COUNT(*)::int AS appointments
       FROM appointments a JOIN contacts c ON c.id = a.contact_id
       WHERE a.location_id = ? ${since} GROUP BY c.source`,
      [loc]
    ),
    db.all(
      `SELECT c.source,
        COUNT(*) FILTER (WHERE o.status = 'won')::int AS won,
        COUNT(*) FILTER (WHERE o.status = 'open')::int AS open,
        COALESCE(SUM(o.value) FILTER (WHERE o.status = 'won'), 0)::float AS won_value,
        COALESCE(SUM(o.value) FILTER (WHERE o.status = 'open'), 0)::float AS pipeline_value
       FROM opportunities o JOIN contacts c ON c.id = o.contact_id
       WHERE o.location_id = ? ${since} GROUP BY c.source`,
      [loc]
    ),
  ]);

  const map = (arr) => Object.fromEntries(arr.map((r) => [r.source || 'manual', r]));
  const cMap = map(contacts), aMap = map(appts), oMap = map(opps);
  const sources = [...new Set([...contacts, ...appts, ...opps].map((r) => r.source || 'manual'))];

  const rows = sources
    .map((source) => {
      const c = cMap[source]?.contacts || 0;
      const a = aMap[source]?.appointments || 0;
      const o = oMap[source] || {};
      const won = o.won || 0;
      return {
        source,
        contacts: c,
        appointments: a,
        won,
        open: o.open || 0,
        won_value: o.won_value || 0,
        pipeline_value: o.pipeline_value || 0,
        // Conversion rates (guarded against divide-by-zero).
        booking_rate: c ? Math.round((a / c) * 100) : 0,
        close_rate: c ? Math.round((won / c) * 100) : 0,
      };
    })
    .sort((x, y) => y.won_value - x.won_value || y.contacts - x.contacts);

  const totals = rows.reduce(
    (t, r) => ({
      contacts: t.contacts + r.contacts,
      appointments: t.appointments + r.appointments,
      won: t.won + r.won,
      won_value: t.won_value + r.won_value,
      pipeline_value: t.pipeline_value + r.pipeline_value,
    }),
    { contacts: 0, appointments: 0, won: 0, won_value: 0, pipeline_value: 0 }
  );

  res.json({ days, rows, totals });
});

module.exports = router;
