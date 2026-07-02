// Lead scoring: simple behavior-based points so "hot" leads surface on the
// dashboard. Tuning lives here in one place.
const db = require('../db');

const POINTS = {
  form_submitted: 10,
  inbound_message: 5,
  appointment_booked: 15,
  opportunity_created: 10,
  tag_added: 2,
};

const HOT_THRESHOLD = 20;

async function addScore(contactId, eventType) {
  const points = POINTS[eventType] || 0;
  if (!points || !contactId) return;
  await db.run('UPDATE contacts SET score = score + ?, updated_at = now() WHERE id = ?', [points, contactId]);
}

async function hotLeads(locationId, limit = 5) {
  return db.all(
    `SELECT id, first_name, last_name, email, phone, score, source FROM contacts
     WHERE location_id = ? AND score >= ? ORDER BY score DESC, updated_at DESC LIMIT ?`,
    [locationId, HOT_THRESHOLD, limit]
  );
}

module.exports = { addScore, hotLeads, HOT_THRESHOLD };
