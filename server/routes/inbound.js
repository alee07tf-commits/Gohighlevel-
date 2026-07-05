// Generic inbound webhooks (v3.0): each sub-account can mint tokenized URLs that
// ANY external app posts a lead to (/api/public/inbound/<token>), creating or
// updating a contact and firing automations. The universal "connect anything in".
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/', async (req, res) => {
  res.json(await db.all('SELECT * FROM inbound_webhooks WHERE location_id = ? ORDER BY id DESC', [req.location.id]));
});

router.post('/', async (req, res) => {
  const { name, tag } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const token = crypto.randomBytes(12).toString('hex');
  const id = await db.insert('INSERT INTO inbound_webhooks (location_id, name, token, tag) VALUES (?, ?, ?, ?)', [
    req.location.id, name, token, tag || '',
  ]);
  res.status(201).json(await db.get('SELECT * FROM inbound_webhooks WHERE id = ?', [id]));
});

router.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM inbound_webhooks WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!info.changes) return res.status(404).json({ error: 'Webhook not found' });
  res.json({ ok: true });
});

module.exports = router;
