const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const messaging = require('../services/messaging');

const router = express.Router();
router.use(requireAuth, requireLocation);

// ---- Email templates ----
router.get('/templates', async (req, res) => {
  res.json(await db.all('SELECT * FROM email_templates WHERE location_id = ? ORDER BY id DESC', [req.location.id]));
});

router.post('/templates', async (req, res) => {
  const { name, subject, body } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = await db.insert('INSERT INTO email_templates (location_id, name, subject, body) VALUES (?, ?, ?, ?)', [
    req.location.id,
    name,
    subject || '',
    body || '',
  ]);
  res.status(201).json(await db.get('SELECT * FROM email_templates WHERE id = ?', [id]));
});

router.put('/templates/:id', async (req, res) => {
  const tpl = await db.get('SELECT * FROM email_templates WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  const merged = { ...tpl, ...req.body };
  await db.run('UPDATE email_templates SET name=?, subject=?, body=? WHERE id=?', [
    merged.name,
    merged.subject,
    merged.body,
    tpl.id,
  ]);
  res.json(await db.get('SELECT * FROM email_templates WHERE id = ?', [tpl.id]));
});

router.delete('/templates/:id', async (req, res) => {
  const info = await db.run('DELETE FROM email_templates WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!info.changes) return res.status(404).json({ error: 'Template not found' });
  res.json({ ok: true });
});

// ---- Campaigns ----
router.get('/campaigns', async (req, res) => {
  const campaigns = await db.all('SELECT * FROM campaigns WHERE location_id = ? ORDER BY id DESC', [req.location.id]);
  res.json(
    await Promise.all(
      campaigns.map(async (c) => ({
        ...c,
        recipient_count: (
          await db.get('SELECT COUNT(*)::int AS n FROM campaign_recipients WHERE campaign_id = ?', [c.id])
        ).n,
      }))
    )
  );
});

router.post('/campaigns', async (req, res) => {
  const { name, channel, subject, body, tag_filter } = req.body || {};
  if (!name || !body) return res.status(400).json({ error: 'name and body are required' });
  const id = await db.insert(
    `INSERT INTO campaigns (location_id, name, channel, subject, body, tag_filter)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.location.id, name, ['sms', 'whatsapp'].includes(channel) ? channel : 'email', subject || '', body, tag_filter || '']
  );
  res.status(201).json(await db.get('SELECT * FROM campaigns WHERE id = ?', [id]));
});

// Send the campaign to all matching contacts (skips DND contacts).
router.post('/campaigns/:id/send', async (req, res) => {
  const campaign = await db.get('SELECT * FROM campaigns WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status === 'sent') return res.status(400).json({ error: 'Campaign already sent' });

  let contacts;
  if (campaign.tag_filter) {
    contacts = await db.all(
      `SELECT c.* FROM contacts c JOIN contact_tags ct ON ct.contact_id = c.id
       WHERE c.location_id = ? AND ct.tag = ?`,
      [req.location.id, campaign.tag_filter]
    );
  } else {
    contacts = await db.all('SELECT * FROM contacts WHERE location_id = ?', [req.location.id]);
  }

  let sent = 0;
  for (const contact of contacts) {
    const message = await messaging.sendByChannel(campaign.channel, req.location.id, contact, {
      subject: campaign.subject,
      body: campaign.body,
    });
    if (message) {
      await db.run('INSERT INTO campaign_recipients (campaign_id, contact_id) VALUES (?, ?)', [
        campaign.id,
        contact.id,
      ]);
      sent++;
    }
  }
  await db.run(`UPDATE campaigns SET status = 'sent', sent_at = now() WHERE id = ?`, [campaign.id]);
  res.json({ ...(await db.get('SELECT * FROM campaigns WHERE id = ?', [campaign.id])), recipient_count: sent });
});

router.delete('/campaigns/:id', async (req, res) => {
  const info = await db.run('DELETE FROM campaigns WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!info.changes) return res.status(404).json({ error: 'Campaign not found' });
  res.json({ ok: true });
});

module.exports = router;
