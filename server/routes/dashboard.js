const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const scoring = require('../services/scoring');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/', async (req, res) => {
  const loc = req.location.id;
  const g = (sql) => db.get(sql, [loc]);
  // All independent reads issued together (one round-trip batch on a pool).
  const [
    contacts, contactsWeek, openOpps, pipelineVal, wonVal, upcomingCount, unread, formsWeek,
    recentContacts, recentActivity, upcoming, hotLeads,
  ] = await Promise.all([
    g('SELECT COUNT(*)::int AS n FROM contacts WHERE location_id = ?'),
    g(`SELECT COUNT(*)::int AS n FROM contacts WHERE location_id = ? AND created_at >= now() - interval '7 days'`),
    g(`SELECT COUNT(*)::int AS n FROM opportunities WHERE location_id = ? AND status = 'open'`),
    g(`SELECT COALESCE(SUM(value),0)::float AS v FROM opportunities WHERE location_id = ? AND status = 'open'`),
    g(`SELECT COALESCE(SUM(value),0)::float AS v FROM opportunities WHERE location_id = ? AND status = 'won'`),
    g(`SELECT COUNT(*)::int AS n FROM appointments WHERE location_id = ? AND starts_at >= now() AND status = 'confirmed'`),
    g('SELECT COUNT(*)::int AS n FROM conversations WHERE location_id = ? AND unread > 0'),
    g(`SELECT COUNT(*)::int AS n FROM form_submissions WHERE location_id = ? AND created_at >= now() - interval '7 days'`),
    db.all('SELECT * FROM contacts WHERE location_id = ? ORDER BY created_at DESC LIMIT 6', [loc]),
    db.all(
      `SELECT a.*, c.first_name, c.last_name FROM activities a
       LEFT JOIN contacts c ON c.id = a.contact_id
       WHERE a.location_id = ? ORDER BY a.created_at DESC LIMIT 12`,
      [loc]
    ),
    db.all(
      `SELECT a.*, c.first_name, c.last_name FROM appointments a
       LEFT JOIN contacts c ON c.id = a.contact_id
       WHERE a.location_id = ? AND a.starts_at >= now() AND a.status = 'confirmed'
       ORDER BY a.starts_at LIMIT 6`,
      [loc]
    ),
    scoring.hotLeads(loc, 5),
  ]);

  const stats = {
    contacts: contacts.n,
    contacts_this_week: contactsWeek.n,
    open_opportunities: openOpps.n,
    pipeline_value: pipelineVal.v,
    won_value: wonVal.v,
    upcoming_appointments: upcomingCount.n,
    unread_conversations: unread.n,
    form_submissions_week: formsWeek.n,
  };

  res.json({ stats, recentContacts, recentActivity, upcoming, hotLeads });
});

module.exports = router;
