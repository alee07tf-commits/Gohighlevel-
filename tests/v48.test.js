// v3.19: Payments parity — product catalog and invoice discount + tax.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Pay', name: 'A', email: 'pay@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
});

test('product catalog CRUD', async () => {
  const p = await request(app).post('/api/payments/products').set(H).send({ name: 'Limpieza', price: 45, recurring: 'monthly' });
  assert.equal(p.status, 201);
  const list = await request(app).get('/api/payments/products').set(H);
  assert.ok(list.body.some((x) => x.name === 'Limpieza' && x.recurring === 'monthly'));
  await request(app).delete(`/api/payments/products/${p.body.id}`).set(H);
  const after = await request(app).get('/api/payments/products').set(H);
  assert.ok(!after.body.some((x) => x.id === p.body.id));
});

test('invoice total applies discount then tax', async () => {
  // Subtotal 100, -10 discount = 90, +21% tax = 108.90
  const inv = await request(app).post('/api/payments').set(H).send({
    title: 'T', items: [{ name: 'Item', qty: 2, price: 50 }], discount: 10, tax_rate: 21,
  });
  assert.equal(inv.status, 201);
  assert.equal(inv.body.total, 108.9);
  assert.equal(inv.body.discount, 10);
  assert.equal(inv.body.tax_rate, 21);
});
