// v2.0: SaaS Mode — plans, branded self-serve signup that auto-provisions a
// sub-account from the plan's snapshot, subscription + wallet, rebilling
// metering, and the agency cross-account overview.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');
const billing = require('../server/services/billing');

let headers, sourceLoc, adminToken, snapshotId, planId;

before(async () => {
  const res = await request(app).post('/api/auth/register').send({
    agency_name: 'V20', name: 'Admin', email: 'v20@test.com', password: 'secret1', location_name: 'Origen',
  });
  adminToken = res.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
  sourceLoc = me.body.locations[0].id;
  headers = { Authorization: `Bearer ${adminToken}`, 'X-Location-Id': String(sourceLoc) };
  await request(app).post('/api/pipelines').set(headers).send({ name: 'Ventas' });
  const snap = await request(app).post('/api/snapshots').set(headers).send({ name: 'Base SaaS', from_location_id: sourceLoc });
  snapshotId = snap.body.id;
});

test('plans: admin can create a SaaS plan with snapshot + rebilling', async () => {
  const r = await request(app).post('/api/plans').set(headers).send({
    name: 'Pro', price: 97, interval: 'monthly', snapshot_id: snapshotId, rebilling: { sms: 2, email: 3 },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.rebilling.sms, 2);
  planId = r.body.id;
  const list = await request(app).get('/api/plans').set(headers);
  assert.ok(list.body.some((p) => p.id === planId));
});

test('agency settings: setting a slug enables the signup page', async () => {
  const r = await request(app).put('/api/agency/settings').set(headers).send({ slug: 'V20 Agency!', signup_headline: 'Únete' });
  assert.equal(r.status, 200);
  assert.equal(r.body.slug, 'v20-agency');
  const page = await request(app).get('/signup/v20-agency');
  assert.equal(page.status, 200);
  assert.match(page.text, /Pro/); // the plan appears on the branded page
});

test('SaaS signup (simulated): auto-provisions a sub-account from the plan', async () => {
  const r = await request(app).post('/api/public/saas/v20-agency/signup').send({
    plan_id: planId, name: 'Cliente', email: 'cliente@v20.com', business_name: 'Cliente V20',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.mode, 'simulated');
  assert.ok(r.body.temp_password, 'temp password issued');

  // The client can log in and is scoped to the new sub-account.
  const login = await request(app).post('/api/auth/login').send({ email: 'cliente@v20.com', password: r.body.temp_password });
  assert.equal(login.status, 200);

  // The new sub-account carries the plan's snapshot content.
  const h = { Authorization: `Bearer ${adminToken}`, 'X-Location-Id': String(r.body.location_id) };
  const pipelines = await request(app).get('/api/pipelines').set(h);
  assert.ok(pipelines.body.some((p) => p.name === 'Ventas'), 'plan snapshot loaded into the new sub-account');
});

test('agency overview: the new sub-account shows with its active subscription', async () => {
  const ov = await request(app).get('/api/agency/overview').set(headers);
  assert.equal(ov.status, 200);
  const row = ov.body.locations.find((l) => l.name === 'Cliente V20');
  assert.ok(row, 'new sub-account listed');
  assert.equal(row.subscription.plan_name, 'Pro');
  assert.equal(row.subscription.status, 'active');
  assert.ok(ov.body.totals.mrr >= 97, 'MRR includes the active plan');
});

test('rebilling: usage debits the wallet at the plan multiplier', async () => {
  const ov = await request(app).get('/api/agency/overview').set(headers);
  const locId = ov.body.locations.find((l) => l.name === 'Cliente V20').id;
  const before = (await billing.getWallet(locId)).balance;
  const billed = await billing.recordUsage(locId, 'sms', 1); // base 0.08 × 2
  assert.ok(Math.abs(billed - 0.16) < 1e-6, 'billed at base × multiplier');
  const after = (await billing.getWallet(locId)).balance;
  assert.ok(Math.abs((before - after) - 0.16) < 1e-6, 'wallet debited');
  const usage = await billing.monthlyUsage(locId);
  assert.ok(usage.some((u) => u.category === 'sms'), 'usage event recorded');
});

test('rebilling is a no-op without an active rebilled subscription', async () => {
  // The source sub-account has no subscription → nothing billed.
  const billed = await billing.recordUsage(sourceLoc, 'sms', 1);
  assert.equal(billed, 0);
});
