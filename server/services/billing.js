// SaaS rebilling: meter usage of paid channels against a sub-account's wallet
// with the agency's markup. No-op unless the sub-account is on a SaaS plan
// whose rebilling is enabled for that category (so non-SaaS use is unaffected).
const db = require('../db');

// Approximate agency base costs per unit (EUR). The client is charged
// base × multiplier (the agency markup from the plan).
const BASE_COSTS = { sms: 0.08, whatsapp: 0.05, email: 0.001, ai: 0.02 };

async function activeSubscription(locationId) {
  return db.get(
    `SELECT s.*, p.rebilling FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.location_id = ? AND s.status = 'active' ORDER BY s.id DESC LIMIT 1`,
    [locationId]
  );
}

// Records one metered event and debits the wallet. Returns the billed amount
// (0 when rebilling doesn't apply). Safe to call on every send.
async function recordUsage(locationId, category, qty = 1) {
  const base = BASE_COSTS[category];
  if (!base) return 0;
  const sub = await activeSubscription(locationId);
  if (!sub) return 0;
  let rebilling = {};
  try {
    rebilling = JSON.parse(sub.rebilling || '{}');
  } catch {
    rebilling = {};
  }
  // rebilling[category] is the multiplier; falsy/absent → not rebilled.
  const multiplier = Number(rebilling[category]);
  if (!multiplier || multiplier <= 0) return 0;

  const baseCost = base * qty;
  const billed = Math.round(baseCost * multiplier * 10000) / 10000;
  await db.tx(async (t) => {
    await t.run('INSERT INTO usage_events (location_id, category, qty, base_cost, billed_cost) VALUES (?, ?, ?, ?, ?)', [
      locationId, category, qty, baseCost, billed,
    ]);
    await t.run('UPDATE wallets SET balance = balance - ? WHERE location_id = ?', [billed, locationId]);
    await t.run('INSERT INTO wallet_transactions (location_id, amount, kind, description) VALUES (?, ?, ?, ?)', [
      locationId, -billed, 'usage', `${qty} ${category}`,
    ]);
  });
  return billed;
}

async function getWallet(locationId) {
  let w = await db.get('SELECT * FROM wallets WHERE location_id = ?', [locationId]);
  if (!w) {
    await db.run('INSERT INTO wallets (location_id) VALUES (?) ON CONFLICT (location_id) DO NOTHING', [locationId]);
    w = await db.get('SELECT * FROM wallets WHERE location_id = ?', [locationId]);
  }
  return w;
}

// Adds funds to the wallet (used by manual top-up and, with real Stripe, by
// auto-recharge). `method` is recorded on the transaction.
async function topUp(locationId, amount, method = 'topup', description = 'Recarga') {
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!(amt > 0)) throw new Error('El importe debe ser mayor que 0');
  await db.tx(async (t) => {
    await t.run('UPDATE wallets SET balance = balance + ? WHERE location_id = ?', [amt, locationId]);
    await t.run('INSERT INTO wallet_transactions (location_id, amount, kind, description) VALUES (?, ?, ?, ?)', [
      locationId, amt, method, description,
    ]);
  });
  return getWallet(locationId);
}

// Usage totals for the current calendar month, grouped by category.
async function monthlyUsage(locationId) {
  const rows = await db.all(
    `SELECT category, COALESCE(SUM(qty),0)::float AS qty, COALESCE(SUM(billed_cost),0)::float AS billed
     FROM usage_events WHERE location_id = ? AND created_at >= date_trunc('month', now())
     GROUP BY category`,
    [locationId]
  );
  return rows;
}

module.exports = { recordUsage, getWallet, topUp, monthlyUsage, activeSubscription, BASE_COSTS };
