// v3.5: Shopify deep integration. A connected store's webhooks (HMAC-verified)
// create/update CRM contacts and open an opportunity per order.
const { test, before } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.SHOPIFY_API_SECRET = 'shpss_test_secret';

const request = require('supertest');
const app = require('../server/index');

const SHOP = 'test-store.myshopify.com';
let jwt, loc, H;

function sign(bodyString) {
  return crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(bodyString).digest('base64');
}
function postWebhook(topic, obj, { shop = SHOP, hmac } = {}) {
  const body = JSON.stringify(obj);
  return request(app).post('/api/public/shopify/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Shopify-Topic', topic)
    .set('X-Shopify-Shop-Domain', shop)
    .set('X-Shopify-Hmac-Sha256', hmac !== undefined ? hmac : sign(body))
    .send(body);
}

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Shop', name: 'A', email: 'shop@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  // A pipeline so orders can open opportunities.
  await request(app).post('/api/pipelines').set(H).send({ name: 'Ventas' });
  // Connect the store (maps shop domain → this sub-account).
  await request(app).post('/api/apps/shopify/manual').set(H).send({ access_token: 'tok', external_id: SHOP });
});

test('rejects a webhook with a bad HMAC signature', async () => {
  const res = await postWebhook('orders/create', { email: 'x@x.com' }, { hmac: 'wrong' });
  assert.equal(res.status, 401);
});

test('rejects a webhook from an unconnected store', async () => {
  const res = await postWebhook('orders/create', { email: 'x@x.com' }, { shop: 'other.myshopify.com' });
  assert.equal(res.status, 404);
});

test('orders/create ingests the customer and opens an opportunity', async () => {
  const order = {
    name: '#1001', order_number: 1001, total_price: '149.90', currency: 'EUR', financial_status: 'paid',
    email: 'buyer@shop.com',
    customer: { first_name: 'Marta', last_name: 'Ríos', phone: '+34655', email: 'buyer@shop.com' },
  };
  const res = await postWebhook('orders/create', order);
  assert.equal(res.status, 200);
  assert.ok(res.body.contact_id);

  const c = await request(app).get(`/api/contacts/${res.body.contact_id}`).set(H);
  assert.equal(c.body.first_name, 'Marta');
  assert.equal(c.body.source, 'shopify:order');
  assert.ok(c.body.tags.includes('shopify'));
  assert.equal(c.body.custom_fields.shopify_order, '#1001');
  // Opportunity opened for the order, valued at the order total and marked won.
  const opp = (c.body.opportunities || []).find((o) => Number(o.value) === 149.9);
  assert.ok(opp, 'opportunity created for the order');
  assert.equal(opp.status, 'won');
});

test('customers/create ingests a customer without an order', async () => {
  const res = await postWebhook('customers/create', {
    email: 'lead@shop.com', first_name: 'Iván', last_name: 'Soto', phone: '+34644',
  });
  assert.equal(res.status, 200);
  const c = await request(app).get(`/api/contacts/${res.body.contact_id}`).set(H);
  assert.equal(c.body.email, 'lead@shop.com');
  assert.equal(c.body.source, 'shopify:customer');
  assert.ok(c.body.tags.includes('shopify'));
});
