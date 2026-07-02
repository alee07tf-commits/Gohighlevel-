const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/', (req, res) => {
  const loc = req.location.id;
  const one = (sql, ...p) => db.prepare(sql).get(...p);

  const stats = {
    contacts: one('SELECT COUNT(*) AS n FROM contacts WHERE location_id = ?', loc).n,
    contacts_this_week: one(
      `SELECT COUNT(*) AS n FROM contacts WHERE location_id = ? AND created_at >= datetime('now','-7 days')`,
      loc
    ).n,
    open_opportunities: one(
      `SELECT COUNT(*) AS n FROM opportunities WHERE location_id = ? AND status = 'open'`,
      loc
    ).n,
    pipeline_value: one(
      `SELECT COALESCE(SUM(value),0) AS v FROM opportunities WHERE location_id = ? AND status = 'open'`,
      loc
    ).v,
    won_value: one(
      `SELECT COALESCE(SUM(value),0) AS v FROM opportunities WHERE location_id = ? AND status = 'won'`,
      loc
    ).v,
    upcoming_appointments: one(
      `SELECT COUNT(*) AS n FROM appointments WHERE location_id = ? AND starts_at >= datetime('now') AND status = 'confirmed'`,
      loc
    ).n,
    unread_conversations: one(
      'SELECT COUNT(*) AS n FROM conversations WHERE location_id = ? AND unread > 0',
      loc
    ).n,
    form_submissions_week: one(
      `SELECT COUNT(*) AS n FROM form_submissions WHERE location_id = ? AND created_at >= datetime('now','-7 days')`,
      loc
    ).n,
  };

  const recentContacts = db
    .prepare('SELECT * FROM contacts WHERE location_id = ? ORDER BY created_at DESC LIMIT 6')
    .all(loc);
  const recentActivity = db
    .prepare(
      `SELECT a.*, c.first_name, c.last_name FROM activities a
       LEFT JOIN contacts c ON c.id = a.contact_id
       WHERE a.location_id = ? ORDER BY a.created_at DESC LIMIT 12`
    )
    .all(loc);
  const upcoming = db
    .prepare(
      `SELECT a.*, c.first_name, c.last_name FROM appointments a
       LEFT JOIN contacts c ON c.id = a.contact_id
       WHERE a.location_id = ? AND a.starts_at >= datetime('now') AND a.status = 'confirmed'
       ORDER BY a.starts_at LIMIT 6`
    )
    .all(loc);

  res.json({ stats, recentContacts, recentActivity, upcoming });
});

module.exports = router;
