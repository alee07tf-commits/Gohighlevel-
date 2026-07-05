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
  if (!campaigns.length) return res.json([]);
  // One grouped count instead of a query per campaign.
  const ids = campaigns.map((c) => c.id);
  const ph = ids.map(() => '?').join(',');
  const counts = await db.all(
    `SELECT campaign_id, COUNT(*)::int AS n FROM campaign_recipients WHERE campaign_id IN (${ph}) GROUP BY campaign_id`,
    ids
  );
  const byId = Object.fromEntries(counts.map((r) => [r.campaign_id, r.n]));
  res.json(campaigns.map((c) => ({ ...c, recipient_count: byId[c.id] || 0 })));
});

router.post('/campaigns', async (req, res) => {
  const { name, channel, subject, body, tag_filter, send_at } = req.body || {};
  if (!name || !body) return res.status(400).json({ error: 'name and body are required' });
  const scheduled = send_at && new Date(send_at).getTime() > Date.now();
  const id = await db.insert(
    `INSERT INTO campaigns (location_id, name, channel, subject, body, tag_filter, send_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.location.id, name, ['sms', 'whatsapp'].includes(channel) ? channel : 'email', subject || '', body,
      tag_filter || '', scheduled ? new Date(send_at).toISOString() : null, scheduled ? 'scheduled' : 'draft',
    ]
  );
  if (scheduled) {
    const scheduler = require('../services/scheduler');
    await scheduler.schedule(req.location.id, new Date(send_at).toISOString(), 'campaign_send', { campaign_id: id });
  }
  res.status(201).json(await db.get('SELECT * FROM campaigns WHERE id = ?', [id]));
});

// Shared campaign delivery used by the manual send and the scheduler.
async function deliverCampaign(campaign) {
  let contacts;
  if (campaign.tag_filter) {
    contacts = await db.all(
      `SELECT c.* FROM contacts c JOIN contact_tags ct ON ct.contact_id = c.id
       WHERE c.location_id = ? AND ct.tag = ?`,
      [campaign.location_id, campaign.tag_filter]
    );
  } else {
    contacts = await db.all('SELECT * FROM contacts WHERE location_id = ?', [campaign.location_id]);
  }
  let sent = 0;
  // Fetch custom values + brand once for the whole campaign, not per recipient.
  const ctx = await messaging.buildSendContext(campaign.location_id);
  for (const contact of contacts) {
    const message = await messaging.sendByChannel(
      campaign.channel,
      campaign.location_id,
      contact,
      { subject: campaign.subject, body: campaign.body },
      ctx
    );
    if (message) {
      await db.run('INSERT INTO campaign_recipients (campaign_id, contact_id) VALUES (?, ?)', [
        campaign.id,
        contact.id,
      ]);
      sent++;
    }
  }
  await db.run(`UPDATE campaigns SET status = 'sent', sent_at = now() WHERE id = ?`, [campaign.id]);
  return sent;
}

// Send the campaign to all matching contacts (skips DND contacts).
router.post('/campaigns/:id/send', async (req, res) => {
  const campaign = await db.get('SELECT * FROM campaigns WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status === 'sent') return res.status(400).json({ error: 'Campaign already sent' });
  const sent = await deliverCampaign(campaign);
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

// ---- Trigger links ----
router.get('/links', async (req, res) => {
  res.json(await db.all('SELECT * FROM trigger_links WHERE location_id = ? ORDER BY id DESC', [req.location.id]));
});

router.post('/links', async (req, res) => {
  const { name, target_url, tag } = req.body || {};
  if (!name || !target_url) return res.status(400).json({ error: 'name and target_url are required' });
  let base = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'link';
  let slug = base;
  let i = 1;
  while (await db.get('SELECT id FROM trigger_links WHERE slug = ?', [slug])) slug = `${base}-${i++}`;
  const id = await db.insert(
    'INSERT INTO trigger_links (location_id, name, slug, target_url, tag) VALUES (?, ?, ?, ?, ?)',
    [req.location.id, name, slug, target_url, tag || '']
  );
  res.status(201).json(await db.get('SELECT * FROM trigger_links WHERE id = ?', [id]));
});

router.delete('/links/:id', async (req, res) => {
  const info = await db.run('DELETE FROM trigger_links WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!info.changes) return res.status(404).json({ error: 'Link not found' });
  res.json({ ok: true });
});

module.exports = router;
module.exports.deliverCampaign = deliverCampaign;