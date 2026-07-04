// Agency console: a cross-sub-account roll-up plus SaaS/white-label settings.
// Admin-only — this is the layer above individual sub-accounts.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Cross-location overview: one row per sub-account with its key metrics.
router.get('/overview', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const locations = await db.all('SELECT * FROM locations WHERE agency_id = ? ORDER BY id', [req.user.agency_id]);
  const rows = [];
  for (const loc of locations) {
    const { c } = await db.get('SELECT COUNT(*)::int AS c FROM contacts WHERE location_id = ?', [loc.id]);
    const { pipeline } = await db.get(
      `SELECT COALESCE(SUM(value),0)::float AS pipeline FROM opportunities WHERE location_id = ? AND status = 'open'`,
      [loc.id]
    );
    const { revenue } = await db.get(
      `SELECT COALESCE(SUM(total),0)::float AS revenue FROM invoices WHERE location_id = ? AND status = 'paid'`,
      [loc.id]
    );
    const sub = await db.get(
      `SELECT s.status, s.current_period_end, p.name AS plan_name, p.price, p.currency
       FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.location_id = ? ORDER BY s.id DESC LIMIT 1`,
      [loc.id]
    );
    const wallet = await db.get('SELECT balance FROM wallets WHERE location_id = ?', [loc.id]);
    const { billed } = await db.get(
      `SELECT COALESCE(SUM(billed_cost),0)::float AS billed FROM usage_events
       WHERE location_id = ? AND created_at >= date_trunc('month', now())`,
      [loc.id]
    );
    rows.push({
      id: loc.id, name: loc.name, company: loc.company,
      contacts: c, pipeline_value: pipeline, revenue,
      subscription: sub || null,
      wallet_balance: wallet ? wallet.balance : 0,
      usage_this_month: billed,
    });
  }
  const totals = rows.reduce(
    (a, r) => ({
      sub_accounts: a.sub_accounts + 1,
      mrr: a.mrr + (r.subscription && r.subscription.status === 'active' ? Number(r.subscription.price) || 0 : 0),
      revenue: a.revenue + r.revenue,
    }),
    { sub_accounts: 0, mrr: 0, revenue: 0 }
  );
  res.json({ locations: rows, totals });
});

// Agency SaaS + white-label settings.
router.get('/settings', async (req, res) => {
  const a = await db.get('SELECT id, name, slug, brand_color, logo_url, signup_headline FROM agencies WHERE id = ?', [req.user.agency_id]);
  res.json(a);
});

router.put('/settings', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const cur = await db.get('SELECT * FROM agencies WHERE id = ?', [req.user.agency_id]);
  const b = req.body || {};
  let slug = b.slug !== undefined ? slugify(b.slug) : cur.slug;
  if (slug) {
    // Keep the signup slug unique across agencies.
    const clash = await db.get('SELECT id FROM agencies WHERE slug = ? AND id != ?', [slug, cur.id]);
    if (clash) return res.status(409).json({ error: 'Ese identificador de registro ya está en uso' });
  }
  await db.run(
    'UPDATE agencies SET slug = ?, brand_color = ?, logo_url = ?, signup_headline = ? WHERE id = ?',
    [slug || null, b.brand_color ?? cur.brand_color, b.logo_url ?? cur.logo_url, b.signup_headline ?? cur.signup_headline, cur.id]
  );
  res.json(await db.get('SELECT id, name, slug, brand_color, logo_url, signup_headline FROM agencies WHERE id = ?', [cur.id]));
});

module.exports = router;
