// v51: Shopify order lifecycle — ONE opportunity per order that moves through
// the pipeline by order status (open → won → lost), matching GoHighLevel.
// A real store fires orders/create, then orders/paid, then maybe
// orders/cancelled for the SAME order; each must update the same opportunity,
// never spawn duplicates.
const { test, before } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.SHOPIFY_API_SECRET = 'shpss_test_secret';

const request = require('supertest');
const app = require('../server/index');
const shopify = require('../server/services/shopify');

const SHOP = 'lifecycle-store.myshopify.com';
let jwt, loc, H;

function sign(bodyString) {
  return crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(bodyString).digest('base64');
}
function postWebhook(topic, obj, { shop = SHOP } = {}) {
  const body = JSON.stringify(obj);
  return request(app).post('/api/public/shopify/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Shopify-Topic', topic)
    .set('X-Shopify-Shop-Domain', shop)
    .set('X-Shopify-Hmac-Sha256', sign(body))
    .send(body);
}

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Life', name: 'A', email: 'life@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  await request(app).post('/api/pipelines').set(H).send({ name: 'Ventas' });
  await request(app).post('/api/apps/shopify/manual').set(H).send({ access_token: 'tok', external_id: SHOP });
});

// ---- Unit: the status mapper (pure, no DB) ----
test('orderStatus maps financial/cancel state like GHL', () => {
  assert.equal(shopify.orderStatus({ financial_status: 'pending' }).status, 'open');
  assert.equal(shopify.orderStatus({ financial_status: 'paid' }).status, 'won');
  assert.equal(shopify.orderStatus({ financial_status: 'partially_refunded' }).status, 'won');
  assert.equal(shopify.orderStatus({ financial_status: 'refunded' }).status, 'lost');
  assert.equal(shopify.orderStatus({ financial_status: 'voided' }).status, 'lost');
  // Cancellation is terminal regardless of what was paid.
  assert.equal(shopify.orderStatus({ financial_status: 'paid' }, 'orders/cancelled').status, 'lost');
  assert.equal(shopify.orderStatus({ financial_status: 'paid', cancelled_at: '2026-01-01' }).status, 'lost');
  assert.match(shopify.orderStatus({}, 'orders/cancelled').lost_reason, /cancelad/i);
});

// ---- Integration: full order lifecycle on a single opportunity ----
test('one order → one opportunity that transitions open → won → lost', async () => {
  const base = {
    name: '#5001', order_number: 5001, currency: 'EUR',
    email: 'client@life.com',
    customer: { first_name: 'Nora', last_name: 'Vega', phone: '+34699', email: 'client@life.com' },
  };

  // 1) orders/create, still pending → OPEN opportunity.
  let res = await postWebhook('orders/create', { ...base, total_price: '80.00', financial_status: 'pending' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'open');
  const contactId = res.body.contact_id;
  const oppId = res.body.opportunity_id;
  assert.ok(oppId);

  // 2) orders/paid for the SAME order → same opportunity moves to WON.
  res = await postWebhook('orders/paid', { ...base, total_price: '80.00', financial_status: 'paid' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'won');
  assert.equal(res.body.opportunity_id, oppId, 'same opportunity, not a duplicate');

  // 3) orders/cancelled → same opportunity moves to LOST with a reason.
  res = await postWebhook('orders/cancelled', { ...base, total_price: '80.00', financial_status: 'paid', cancelled_at: '2026-02-01' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'lost');
  assert.equal(res.body.opportunity_id, oppId);

  // Exactly ONE opportunity exists for this order across all three webhooks.
  const c = await request(app).get(`/api/contacts/${contactId}`).set(H);
  const forOrder = (c.body.opportunities || []).filter((o) => o.title === 'Shopify #5001');
  assert.equal(forOrder.length, 1, 'no duplicate opportunities for the same order');
  assert.equal(forOrder[0].status, 'lost');
  assert.match(forOrder[0].lost_reason || '', /cancelad/i);
});
