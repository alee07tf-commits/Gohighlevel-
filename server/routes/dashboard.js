const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/', async (req, res) => {
  const loc = req.location.id;
  const one = async (sql, ...p) => db.get(sql, p);

  const stats = {
    contacts: (await one('SELECT COUNT(*)::int AS n FROM contacts WHERE location_id = ?', loc)).n,
    contacts_this_week: (
      await one(
        `SELECT COUNT(*)::int AS n FROM contacts WHERE location_id = ? AND created_at >= now() - interval '7 days'`,
        loc
      )
    ).n,
    open_opportunities: (
      await one(`SELECT COUNT(*)::int AS n FROM opportunities WHERE location_id = ? AND status = 'open'`, loc)
    ).n,
    pipeline_value: (
      await one(
        `SELECT COALESCE(SUM(value),0)::float AS v FROM opportunities WHERE location_id = ? AND status = 'open'`,
        loc
      )
    ).v,
    won_value: (
      await one(
        `SELECT COALESCE(SUM(value),0)::float AS v FROM opportunities WHERE location_id = ? AND status = 'won'`,
        loc
      )
    ).v,
    upcoming_appointments: (
      await one(
        `SELECT COUNT(*)::int AS n FROM appointments WHERE location_id = ? AND starts_at >= now() AND status = 'confirmed'`,
        loc
      )
    ).n,
    unread_conversations: (
      await one('SELECT COUNT(*)::int AS n FROM conversations WHERE location_id = ? AND unread > 0', loc)
    ).n,
    form_submissions_week: (
      await one(
        `SELECT COUNT(*)::int AS n FROM form_submissions WHERE location_id = ? AND created_at >= now() - interval '7 days'`,
        loc
      )
    ).n,
  };

  const recentContacts = await db.all(
    'SELECT * FROM contacts WHERE location_id = ? ORDER BY created_at DESC LIMIT 6',
    [loc]
  );
  const recentActivity = await db.all(
    `SELECT a.*, c.first_name, c.last_name FROM activities a
     LEFT JOIN contacts c ON c.id = a.contact_id
     WHERE a.location_id = ? ORDER BY a.created_at DESC LIMIT 12`,
    [loc]
  );
  const upcoming = await db.all(
    `SELECT a.*, c.first_name, c.last_name FROM appointments a
     LEFT JOIN contacts c ON c.id = a.contact_id
     WHERE a.location_id = ? AND a.starts_at >= now() AND a.status = 'confirmed'
     ORDER BY a.starts_at LIMIT 6`,
    [loc]
  );

  res.json({ stats, recentContacts, recentActivity, upcoming });
});

module.exports = router;
