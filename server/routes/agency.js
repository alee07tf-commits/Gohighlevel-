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
// Metrics are fetched with one grouped query each (keyed by location) instead of
// ~6 queries per sub-account, so the panel stays fast as the agency grows.
router.get('/overview', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const locations = await db.all('SELECT * FROM locations WHERE agency_id = ? ORDER BY id', [req.user.agency_id]);
  if (!locations.length) return res.json({ locations: [], totals: { sub_accounts: 0, mrr: 0, revenue: 0 } });

  const ids = locations.map((l) => l.id);
  const ph = ids.map(() => '?').join(',');
  const byId = (arr) => Object.fromEntries(arr.map((r) => [r.location_id, r]));

  const [contacts, pipelines, revenues, wallets, usage, subs] = await Promise.all([
    db.all(`SELECT location_id, COUNT(*)::int AS c FROM contacts WHERE location_id IN (${ph}) GROUP BY location_id`, ids),
    db.all(`SELECT location_id, COALESCE(SUM(value),0)::float AS pipeline FROM opportunities WHERE location_id IN (${ph}) AND status = 'open' GROUP BY location_id`, ids),
    db.all(`SELECT location_id, COALESCE(SUM(total),0)::float AS revenue FROM invoices WHERE location_id IN (${ph}) AND status = 'paid' GROUP BY location_id`, ids),
    db.all(`SELECT location_id, balance FROM wallets WHERE location_id IN (${ph})`, ids),
    db.all(`SELECT location_id, COALESCE(SUM(billed_cost),0)::float AS billed FROM usage_events WHERE location_id IN (${ph}) AND created_at >= date_trunc('month', now()) GROUP BY location_id`, ids),
    db.all(
      `SELECT DISTINCT ON (s.location_id) s.location_id, s.status, s.current_period_end, p.name AS plan_name, p.price, p.currency
       FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.location_id IN (${ph}) ORDER BY s.location_id, s.id DESC`,
      ids
    ),
  ]);
  const cMap = byId(contacts), pMap = byId(pipelines), rMap = byId(revenues), wMap = byId(wallets), uMap = byId(usage), sMap = byId(subs);

  const rows = locations.map((loc) => {
    const s = sMap[loc.id];
    return {
      id: loc.id, name: loc.name, company: loc.company,
      contacts: cMap[loc.id] ? cMap[loc.id].c : 0,
      pipeline_value: pMap[loc.id] ? pMap[loc.id].pipeline : 0,
      revenue: rMap[loc.id] ? rMap[loc.id].revenue : 0,
      subscription: s ? { status: s.status, current_period_end: s.current_period_end, plan_name: s.plan_name, price: s.price, currency: s.currency } : null,
      wallet_balance: wMap[loc.id] ? wMap[loc.id].balance : 0,
      usage_this_month: uMap[loc.id] ? uMap[loc.id].billed : 0,
    };
  });
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
