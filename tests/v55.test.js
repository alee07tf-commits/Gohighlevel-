// v55: Discount coupons — reusable codes that apply a discount to invoices,
// with expiry, usage limits, and validation. Parity with GHL coupons.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let H, contactId;

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Coup', name: 'A', email: 'coup@test.com', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  H = { Authorization: `Bearer ${r.body.token}`, 'X-Location-Id': String(me.body.locations[0].id) };
  const c = await request(app).post('/api/contacts').set(H).send({ first_name: 'Cli', email: 'cli@x.com' });
  contactId = c.body.id;
});

test('creates a percent coupon and rejects duplicates', async () => {
  const res = await request(app).post('/api/coupons').set(H).send({ code: 'VERANO20', type: 'percent', value: 20, max_uses: 2 });
  assert.equal(res.status, 201);
  assert.equal(res.body.code, 'VERANO20');
  const dup = await request(app).post('/api/coupons').set(H).send({ code: 'verano20', type: 'percent', value: 10 });
  assert.equal(dup.status, 409, 'code is unique per location (case-insensitive)');
});

test('rejects an invalid percent (>100)', async () => {
  const res = await request(app).post('/api/coupons').set(H).send({ code: 'BAD', type: 'percent', value: 150 });
  assert.equal(res.status, 400);
});

test('validate computes the discount for a subtotal', async () => {
  const res = await request(app).post('/api/coupons/validate').set(H).send({ code: 'VERANO20', subtotal: 100 });
  assert.equal(res.body.valid, true);
  assert.equal(res.body.discount, 20);
});

test('applying a coupon to an invoice reduces the total and redeems a use', async () => {
  const inv = await request(app).post('/api/payments').set(H).send({
    contact_id: contactId, title: 'Servicio', items: [{ name: 'Plan', qty: 1, price: 100 }], coupon_code: 'VERANO20',
  });
  assert.equal(inv.status, 201);
  assert.equal(Number(inv.body.total), 80, '20% off 100 = 80');
  // Usage incremented.
  const list = await request(app).get('/api/coupons').set(H);
  assert.equal(list.body.find((c) => c.code === 'VERANO20').uses, 1);
});

test('an unknown coupon code is rejected at invoice creation', async () => {
  const inv = await request(app).post('/api/payments').set(H).send({
    contact_id: contactId, title: 'X', items: [{ name: 'Plan', qty: 1, price: 50 }], coupon_code: 'NOPE',
  });
  assert.equal(inv.status, 400);
});

test('a coupon exhausts after hitting max_uses', async () => {
  // VERANO20 max_uses=2, already used once → one more should work, then be exhausted.
  await request(app).post('/api/payments').set(H).send({
    contact_id: contactId, title: 'Y', items: [{ name: 'Plan', qty: 1, price: 50 }], coupon_code: 'VERANO20',
  });
  const res = await request(app).post('/api/coupons/validate').set(H).send({ code: 'VERANO20', subtotal: 50 });
  assert.equal(res.body.valid, false);
  assert.match(res.body.reason, /usos/i);
});
