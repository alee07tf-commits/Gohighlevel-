// v3.4: plan-based entitlements. A plan grants managed features (Email/SMS/
// WhatsApp/AI). When a client is created on a plan, its template installs and
// the managed tier reflects exactly what the plan includes — while the backend
// API stays wired centrally by the agency (like email).
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H, planId;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Feat', name: 'A', email: 'feat@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
});

test('a plan grants a specific set of managed features', async () => {
  const r = await request(app).post('/api/plans').set('Authorization', `Bearer ${jwt}`).send({
    name: 'Pro', price: 97, interval: 'monthly',
    features: { email: true, ai: true, sms: false, whatsapp: false },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.features.email, true);
  assert.equal(r.body.features.sms, false);
  planId = r.body.id;
});

test('creating a client on the plan opens a subscription and gates its features', async () => {
  const c = await request(app).post('/api/clients').set('Authorization', `Bearer ${jwt}`).send({
    agency_name: 'ClientCo', admin_name: 'Cli', admin_email: 'cli@feat.com', admin_password: 'secret1', plan_id: planId,
  });
  assert.equal(c.status, 201);
  assert.equal(c.body.plan.id, planId);

  // Log in as the freshly-provisioned client admin.
  const login = await request(app).post('/api/auth/login').send({ email: 'cli@feat.com', password: 'secret1' });
  const cjwt = login.body.token;
  const cme = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${cjwt}`);
  const cloc = cme.body.locations[0].id;

  const apps = await request(app).get('/api/apps').set({ Authorization: `Bearer ${cjwt}`, 'X-Location-Id': String(cloc) });
  assert.equal(apps.body.plan_gated, true);
  const m = Object.fromEntries(apps.body.managed.map((x) => [x.key, x]));
  // Included exactly matches the plan.
  assert.equal(m.email.included, true);
  assert.equal(m.ai.included, true);
  assert.equal(m.sms.included, false);
  assert.equal(m.whatsapp.included, false);
  // Nothing is active yet because the agency hasn't wired the backend, but the
  // entitlement (included) is independent of that.
  assert.equal(m.email.active, false);
  assert.equal(m.sms.active, false);
});

test('accounts without a plan are not gated (everything included)', async () => {
  const apps = await request(app).get('/api/apps').set(H);
  assert.equal(apps.body.plan_gated, false);
  const m = Object.fromEntries(apps.body.managed.map((x) => [x.key, x]));
  assert.equal(m.email.included, true);
  assert.equal(m.sms.included, true);
  assert.equal(m.whatsapp.included, true);
  assert.equal(m.ai.included, true);
});
