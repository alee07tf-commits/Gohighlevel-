// Reusable discount codes. Validation is shared between the authenticated
// manager and the public checkout so the rules can't drift apart.
const db = require('../db');

// Look up an active, non-expired, non-exhausted coupon by code for a location.
// Returns { ok, coupon } or { ok:false, reason }.
async function lookup(locationId, code) {
  if (!code) return { ok: false, reason: 'Introduce un código' };
  const c = await db.get(
    'SELECT * FROM coupons WHERE location_id = ? AND lower(code) = lower(?)',
    [locationId, String(code).trim()]
  );
  if (!c) return { ok: false, reason: 'Código no válido' };
  if (!c.active) return { ok: false, reason: 'Este código está desactivado' };
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return { ok: false, reason: 'Este código ha caducado' };
  if (c.max_uses > 0 && c.uses >= c.max_uses) return { ok: false, reason: 'Este código ya no tiene usos disponibles' };
  return { ok: true, coupon: c };
}

// Money discount a coupon applies to a subtotal (never below 0).
function discountFor(coupon, subtotal) {
  const s = Number(subtotal) || 0;
  const amount = coupon.type === 'fixed' ? Number(coupon.value) : (s * Number(coupon.value)) / 100;
  return Math.max(0, Math.min(s, Math.round(amount * 100) / 100));
}

async function redeem(couponId) {
  await db.run('UPDATE coupons SET uses = uses + 1 WHERE id = ?', [couponId]);
}

module.exports = { lookup, discountFor, redeem };
