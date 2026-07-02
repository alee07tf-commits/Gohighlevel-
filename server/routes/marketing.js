const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const messaging = require('../services/messaging');

const router = express.Router();
router.use(requireAuth, requireLocation);

// ---- Email templates ----
router.get('/templates', (req, res) => {
  res.json(db.prepare('SELECT * FROM email_templates WHERE location_id = ? ORDER BY id DESC').all(req.location.id));
});

router.post('/templates', (req, res) => {
  const { name, subject, body } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare('INSERT INTO email_templates (location_id, name, subject, body) VALUES (?, ?, ?, ?)')
    .run(req.location.id, name, subject || '', body || '');
  res.status(201).json(db.prepare('SELECT * FROM email_templates WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/templates/:id', (req, res) => {
  const tpl = db
    .prepare('SELECT * FROM email_templates WHERE id = ? AND location_id = ?')
    .get(req.params.id, req.location.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  const merged = { ...tpl, ...req.body };
  db.prepare('UPDATE email_templates SET name=?, subject=?, body=? WHERE id=?').run(
    merged.name, merged.subject, merged.body, tpl.id
  );
  res.json(db.prepare('SELECT * FROM email_templates WHERE id = ?').get(tpl.id));
});

router.delete('/templates/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM email_templates WHERE id = ? AND location_id = ?')
    .run(req.params.id, req.location.id);
  if (!info.changes) return res.status(404).json({ error: 'Template not found' });
  res.json({ ok: true });
});

// ---- Campaigns ----
router.get('/campaigns', (req, res) => {
  const campaigns = db
    .prepare('SELECT * FROM campaigns WHERE location_id = ? ORDER BY id DESC')
    .all(req.location.id);
  res.json(
    campaigns.map((c) => ({
      ...c,
      recipient_count: db.prepare('SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ?').get(c.id).n,
    }))
  );
});

router.post('/campaigns', (req, res) => {
  const { name, channel, subject, body, tag_filter } = req.body || {};
  if (!name || !body) return res.status(400).json({ error: 'name and body are required' });
  const info = db
    .prepare(
      `INSERT INTO campaigns (location_id, name, channel, subject, body, tag_filter)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.location.id, name, channel === 'sms' ? 'sms' : 'email', subject || '', body, tag_filter || '');
  res.status(201).json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(info.lastInsertRowid));
});

// Send the campaign to all matching contacts (skips DND contacts).
router.post('/campaigns/:id/send', (req, res) => {
  const campaign = db
    .prepare('SELECT * FROM campaigns WHERE id = ? AND location_id = ?')
    .get(req.params.id, req.location.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status === 'sent') return res.status(400).json({ error: 'Campaign already sent' });

  let contacts;
  if (campaign.tag_filter) {
    contacts = db
      .prepare(
        `SELECT c.* FROM contacts c JOIN contact_tags ct ON ct.contact_id = c.id
         WHERE c.location_id = ? AND ct.tag = ?`
      )
      .all(req.location.id, campaign.tag_filter);
  } else {
    contacts = db.prepare('SELECT * FROM contacts WHERE location_id = ?').all(req.location.id);
  }

  let sent = 0;
  for (const contact of contacts) {
    const message =
      campaign.channel === 'email'
        ? messaging.sendEmail(req.location.id, contact, campaign.subject, campaign.body)
        : messaging.sendSms(req.location.id, contact, campaign.body);
    if (message) {
      db.prepare('INSERT INTO campaign_recipients (campaign_id, contact_id) VALUES (?, ?)').run(
        campaign.id, contact.id
      );
      sent++;
    }
  }
  db.prepare(`UPDATE campaigns SET status = 'sent', sent_at = datetime('now') WHERE id = ?`).run(campaign.id);
  res.json({ ...db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign.id), recipient_count: sent });
});

router.delete('/campaigns/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM campaigns WHERE id = ? AND location_id = ?')
    .run(req.params.id, req.location.id);
  if (!info.changes) return res.status(404).json({ error: 'Campaign not found' });
  res.json({ ok: true });
});

module.exports = router;
