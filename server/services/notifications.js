// In-app notification center. Creates bell notifications for users. Best-effort:
// a failure here must never break the action that triggered it.
const db = require('../db');

// Create one notification for a specific user.
async function notify(userId, { type = 'info', title, body = '', link = '', locationId = null } = {}) {
  if (!userId || !title) return null;
  try {
    return await db.insert(
      'INSERT INTO notifications (user_id, location_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, locationId, type, String(title).slice(0, 160), String(body).slice(0, 500), String(link).slice(0, 300)]
    );
  } catch {
    return null;
  }
}

// Notify every user who can access a location (its agency's team), optionally
// excluding one user (e.g. the person who caused the event).
async function notifyLocationTeam(locationId, payload = {}, exceptUserId = null) {
  try {
    const loc = await db.get('SELECT agency_id FROM locations WHERE id = ?', [locationId]);
    if (!loc) return;
    // Team = users of the agency. Users restricted via user_locations only get it
    // if this location is in their allowed set (or they have no restriction).
    const users = await db.all(
      `SELECT u.id FROM users u
       WHERE u.agency_id = ?
       AND (NOT EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = u.id)
            OR EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = u.id AND ul.location_id = ?))`,
      [loc.agency_id, locationId]
    );
    for (const u of users) {
      if (exceptUserId && u.id === exceptUserId) continue;
      await notify(u.id, { ...payload, locationId });
    }
  } catch {
    /* best-effort */
  }
}

module.exports = { notify, notifyLocationTeam };
