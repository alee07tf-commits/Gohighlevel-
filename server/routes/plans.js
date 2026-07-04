// SaaS plans — the products an agency sells to clients. Each plan maps to a
// snapshot (loaded on signup) and carries rebilling multipliers per channel.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

function parse(p) {
  if (!p) return p;
  return {
    ...p,
    features: (() => { try { return JSON.parse(p.features || '{}'); } catch { return {}; } })(),
    rebilling: (() => { try { return JSON.parse(p.rebilling || '{}'); } catch { return {}; } })(),
    is_public: !!p.is_public,
  };
}

router.get('/', async (req, res) => {
  const rows = await db.all('SELECT * FROM plans WHERE agency_id = ? ORDER BY price', [req.user.agency_id]);
  res.json(rows.map(parse));
});

router.post('/', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { name, description, price, currency, interval, snapshot_id, features, rebilling, is_public } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = await db.insert(
    `INSERT INTO plans (agency_id, name, description, price, currency, interval, snapshot_id, features, rebilling, is_public)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.agency_id, name, description || '', Number(price) || 0, currency || 'EUR',
      interval === 'yearly' ? 'yearly' : 'monthly', snapshot_id || null,
      JSON.stringify(features || {}), JSON.stringify(rebilling || {}), is_public === false ? 0 : 1,
    ]
  );
  res.status(201).json(parse(await db.get('SELECT * FROM plans WHERE id = ?', [id])));
});

router.put('/:id', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const plan = await db.get('SELECT * FROM plans WHERE id = ? AND agency_id = ?', [req.params.id, req.user.agency_id]);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const b = req.body || {};
  await db.run(
    `UPDATE plans SET name=?, description=?, price=?, currency=?, interval=?, snapshot_id=?, features=?, rebilling=?, is_public=? WHERE id=?`,
    [
      b.name ?? plan.name, b.description ?? plan.description, b.price != null ? Number(b.price) : plan.price,
      b.currency ?? plan.currency, b.interval === 'yearly' ? 'yearly' : b.interval === 'monthly' ? 'monthly' : plan.interval,
      b.snapshot_id !== undefined ? b.snapshot_id || null : plan.snapshot_id,
      b.features ? JSON.stringify(b.features) : plan.features,
      b.rebilling ? JSON.stringify(b.rebilling) : plan.rebilling,
      b.is_public != null ? (b.is_public ? 1 : 0) : plan.is_public, plan.id,
    ]
  );
  res.json(parse(await db.get('SELECT * FROM plans WHERE id = ?', [plan.id])));
});

router.delete('/:id', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const info = await db.run('DELETE FROM plans WHERE id = ? AND agency_id = ?', [req.params.id, req.user.agency_id]);
  if (!info.changes) return res.status(404).json({ error: 'Plan not found' });
  res.json({ ok: true });
});

module.exports = router;
