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
  const { name, subject, body, design } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = await db.insert('INSERT INTO email_templates (location_id, name, subject, body, design) VALUES (?, ?, ?, ?, ?)', [
    req.location.id,
    name,
    subject || '',
    body || '',
    typeof design === 'string' ? design : (design ? JSON.stringify(design) : ''),
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
  const design = req.body?.design !== undefined
    ? (typeof req.body.design === 'string' ? req.body.design : JSON.stringify(req.body.design))
    : tpl.design;
  await db.run('UPDATE email_templates SET name=?, subject=?, body=?, design=? WHERE id=?', [
    merged.name,
    merged.subject,
    merged.body,
    design,
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
    `SELECT campaign_id, COUNT(*)::int AS n,
       COUNT(opened_at)::int AS opened, COUNT(clicked_at)::int AS clicked
     FROM campaign_recipients WHERE campaign_id IN (${ph}) GROUP BY campaign_id`,
    ids
  );
  const byId = Object.fromEntries(counts.map((r) => [r.campaign_id, r]));
  res.json(campaigns.map((c) => ({
    ...c,
    recipient_count: byId[c.id]?.n || 0,
    opened_count: byId[c.id]?.opened || 0,
    clicked_count: byId[c.id]?.clicked || 0,
  })));
});

router.post('/campaigns', async (req, res) => {
  const { name, channel, subject, body, tag_filter, send_at, subject_b, body_b, ab_test } = req.body || {};
  if (!name || !body) return res.status(400).json({ error: 'name and body are required' });
  const scheduled = send_at && new Date(send_at).getTime() > Date.now();
  // A/B only for email and only when a variant B is actually provided.
  const isEmail = !['sms', 'whatsapp'].includes(channel);
  const ab = isEmail && ab_test && (subject_b || body_b) ? 1 : 0;
  const id = await db.insert(
    `INSERT INTO campaigns (location_id, name, channel, subject, body, tag_filter, send_at, status, subject_b, body_b, ab_test)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.location.id, name, ['sms', 'whatsapp'].includes(channel) ? channel : 'email', subject || '', body,
      tag_filter || '', scheduled ? new Date(send_at).toISOString() : null, scheduled ? 'scheduled' : 'draft',
      ab ? (subject_b || subject || '') : '', ab ? (body_b || body) : '', ab,
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
  const crypto = require('crypto');
  const base = (process.env.PUBLIC_URL || process.env.APP_URL || '').replace(/\/$/, '');
  const isEmail = campaign.channel === 'email';
  let i = 0;
  for (const contact of contacts) {
    // Respect DND (global and per-channel) — campaigns never bypass opt-out.
    if (contact.dnd || (isEmail && contact.dnd_email) || (!isEmail && contact.dnd_sms)) continue;

    // A/B split (email only): alternate recipients between variant A and B.
    const variant = campaign.ab_test && isEmail ? (i % 2 === 0 ? 'A' : 'B') : '';
    i++;
    const subject = variant === 'B' ? campaign.subject_b : campaign.subject;
    const token = crypto.randomBytes(12).toString('hex');
    let body = variant === 'B' ? campaign.body_b : campaign.body;
    // Email: append an open-tracking pixel and an unsubscribe link.
    if (isEmail) {
      body += `\n\n<a href="${base}/api/public/unsub/${token}">Cancelar suscripción</a>`;
      body += `\n<img src="${base}/api/public/e/o/${token}" width="1" height="1" alt="" style="display:none">`;
    }
    const message = await messaging.sendByChannel(
      campaign.channel, campaign.location_id, contact, { subject, body }, ctx
    );
    if (message) {
      await db.run('INSERT INTO campaign_recipients (campaign_id, contact_id, token, variant) VALUES (?, ?, ?, ?)', [campaign.id, contact.id, token, variant]);
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

// A/B (and general) stats: sent / opened / clicked per variant, with a winner.
router.get('/campaigns/:id/stats', async (req, res) => {
  const campaign = await db.get('SELECT * FROM campaigns WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  const rows = await db.all(
    `SELECT COALESCE(NULLIF(variant, ''), '-') AS variant,
       COUNT(*)::int AS sent,
       COUNT(opened_at)::int AS opened,
       COUNT(clicked_at)::int AS clicked
     FROM campaign_recipients WHERE campaign_id = ? GROUP BY variant`,
    [campaign.id]
  );
  const byV = Object.fromEntries(rows.map((r) => [r.variant, r]));
  const rate = (v) => (v && v.sent ? Math.round((v.opened / v.sent) * 100) : 0);
  let winner = null;
  if (campaign.ab_test) {
    const a = rate(byV.A), b = rate(byV.B);
    winner = a === b ? 'tie' : a > b ? 'A' : 'B';
  }
  res.json({ ab_test: !!campaign.ab_test, variants: rows, open_rate: { A: rate(byV.A), B: rate(byV.B) }, winner });
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