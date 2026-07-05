const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const messaging = require('../services/messaging');
const automation = require('../services/automation');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/', async (req, res) => {
  const requests = await db.all(
    `SELECT rr.*, c.first_name, c.last_name, c.email, c.phone FROM review_requests rr
     JOIN contacts c ON c.id = rr.contact_id
     WHERE rr.location_id = ? ORDER BY rr.id DESC LIMIT 200`,
    [req.location.id]
  );
  const stats = await db.get(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'reviewed')::int AS responded,
            COALESCE(AVG(rating) FILTER (WHERE rating IS NOT NULL), 0)::float AS avg_rating,
            COUNT(*) FILTER (WHERE rating >= 4)::int AS promoters,
            COUNT(*) FILTER (WHERE rating IS NOT NULL AND rating <= 3)::int AS detractors
     FROM review_requests WHERE location_id = ?`,
    [req.location.id]
  );
  res.json({
    requests,
    stats,
    links: { google: req.location.review_link_google || '', facebook: req.location.review_link_facebook || '' },
  });
});

// Send a review request to a contact by channel. Also used by the workflow
// action via sendReviewRequest below.
router.post('/request', async (req, res) => {
  const { contact_id, channel = 'sms' } = req.body || {};
  const contact = await db.get('SELECT * FROM contacts WHERE id = ? AND location_id = ?', [
    contact_id,
    req.location.id,
  ]);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  const base = `${req.protocol}://${req.get('host')}`;
  const rr = await module.exports.sendReviewRequest(req.location, contact, channel, base);
  res.status(201).json(rr);
});

// Bulk review requests: send to everyone with a tag (or all), skipping DND on
// the chosen channel. Returns how many were sent.
router.post('/request-bulk', async (req, res) => {
  const { tag, channel = 'sms' } = req.body || {};
  const contacts = tag
    ? await db.all(`SELECT c.* FROM contacts c JOIN contact_tags ct ON ct.contact_id = c.id WHERE c.location_id = ? AND ct.tag = ?`, [req.location.id, tag])
    : await db.all('SELECT * FROM contacts WHERE location_id = ?', [req.location.id]);
  const base = `${req.protocol}://${req.get('host')}`;
  const isEmail = channel === 'email';
  let sent = 0;
  for (const c of contacts) {
    if (c.dnd || (isEmail && c.dnd_email) || (!isEmail && c.dnd_sms)) continue;
    try { await module.exports.sendReviewRequest(req.location, c, channel, base); sent++; } catch { /* skip */ }
  }
  res.json({ ok: true, sent, total: contacts.length });
});

// Reviews AI: suggested response to a piece of feedback.
router.post('/:id/suggest-reply', async (req, res) => {
  const rr = await db.get(
    `SELECT rr.*, c.first_name FROM review_requests rr JOIN contacts c ON c.id = rr.contact_id
     WHERE rr.id = ? AND rr.location_id = ?`,
    [req.params.id, req.location.id]
  );
  if (!rr || !rr.rating) return res.status(404).json({ error: 'Review not found or not answered yet' });
  const ai = require('../services/ai');
  res.json(await ai.suggestReviewReply({
    business: req.location.name,
    rating: rr.rating,
    comment: rr.comment,
    contactName: rr.first_name,
    ctx: { locationId: req.location.id, agencyId: req.user.agency_id },
  }));
});

module.exports = router;

module.exports.sendReviewRequest = async function sendReviewRequest(location, contact, channel, baseUrl) {
  const token = crypto.randomBytes(12).toString('hex');
  const id = await db.insert(
    'INSERT INTO review_requests (location_id, contact_id, token) VALUES (?, ?, ?)',
    [location.id, contact.id, token]
  );
  const url = `${baseUrl || process.env.APP_URL || ''}/review/${token}`;
  const text = `Hola {{first_name}}, ¡gracias por confiar en ${location.name}! ¿Nos dejas tu opinión? Solo te llevará 30 segundos: ${url}`;
  if (channel === 'email') {
    await messaging.sendEmail(location.id, contact, `¿Qué tal tu experiencia con ${location.name}?`, text);
  } else if (channel === 'whatsapp') {
    await messaging.sendWhatsapp(location.id, contact, text);
  } else {
    await messaging.sendSms(location.id, contact, text);
  }
  await automation.logActivity(location.id, contact.id, 'note', `Review request sent (${channel})`);
  return db.get('SELECT * FROM review_requests WHERE id = ?', [id]);
};
