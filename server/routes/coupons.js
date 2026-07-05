// Discount codes manager (per sub-account).
const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const coupons = require('../services/coupons');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/', async (req, res) => {
  res.json(await db.all('SELECT * FROM coupons WHERE location_id = ? ORDER BY id DESC', [req.location.id]));
});

router.post('/', async (req, res) => {
  const { code, type = 'percent', value, max_uses, expires_at, active } = req.body || {};
  if (!code || !String(code).trim()) return res.status(400).json({ error: 'El código es obligatorio' });
  if (!['percent', 'fixed'].includes(type)) return res.status(400).json({ error: 'Tipo inválido' });
  const val = Number(value);
  if (!(val > 0)) return res.status(400).json({ error: 'El valor debe ser mayor que 0' });
  if (type === 'percent' && val > 100) return res.status(400).json({ error: 'Un porcentaje no puede superar 100' });
  const exists = await db.get('SELECT id FROM coupons WHERE location_id = ? AND lower(code) = lower(?)', [req.location.id, String(code).trim()]);
  if (exists) return res.status(409).json({ error: 'Ya existe un código con ese nombre' });
  const id = await db.insert(
    'INSERT INTO coupons (location_id, code, type, value, max_uses, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.location.id, String(code).trim(), type, val, Number(max_uses) || 0, expires_at || null, active === false ? 0 : 1]
  );
  res.status(201).json(await db.get('SELECT * FROM coupons WHERE id = ?', [id]));
});

router.put('/:id', async (req, res) => {
  const c = await db.get('SELECT * FROM coupons WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  const b = req.body || {};
  await db.run('UPDATE coupons SET active = ?, max_uses = ?, expires_at = ? WHERE id = ?', [
    b.active !== undefined ? (b.active ? 1 : 0) : c.active,
    b.max_uses !== undefined ? Number(b.max_uses) || 0 : c.max_uses,
    b.expires_at !== undefined ? (b.expires_at || null) : c.expires_at,
    c.id,
  ]);
  res.json(await db.get('SELECT * FROM coupons WHERE id = ?', [c.id]));
});

router.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM coupons WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!info.changes) return res.status(404).json({ error: 'No encontrado' });
  res.json({ ok: true });
});

// Validate a code against a subtotal (used by the manager preview).
router.post('/validate', async (req, res) => {
  const { code, subtotal } = req.body || {};
  const r = await coupons.lookup(req.location.id, code);
  if (!r.ok) return res.status(200).json({ valid: false, reason: r.reason });
  res.json({ valid: true, type: r.coupon.type, value: r.coupon.value, discount: coupons.discountFor(r.coupon, subtotal) });
});

module.exports = router;
