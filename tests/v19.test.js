// v1.9: per-scope integration credentials (Phase 2) — encryption at rest and
// the location → agency → env resolution cascade.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');
const secretbox = require('../server/services/secretbox');
const integrations = require('../server/services/integrations');

let headers, locId, agencyId, adminToken;

before(async () => {
  const res = await request(app).post('/api/auth/register').send({
    agency_name: 'V19', name: 'Admin', email: 'v19@test.com', password: 'secret1', location_name: 'Loc',
  });
  adminToken = res.body.token;
  agencyId = res.body.user.agency_id;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
  locId = me.body.locations[0].id;
  headers = { Authorization: `Bearer ${adminToken}`, 'X-Location-Id': String(locId) };
});

test('secretbox: encrypts and decrypts round-trip, tolerates garbage', () => {
  const enc = secretbox.encrypt({ secret_key: 'sk_live_abc123' });
  assert.ok(enc.startsWith('v1:'));
  assert.ok(!enc.includes('sk_live_abc123'), 'ciphertext does not contain the secret');
  assert.deepEqual(secretbox.decrypt(enc), { secret_key: 'sk_live_abc123' });
  assert.deepEqual(secretbox.decrypt('not-encrypted'), {});
  assert.equal(secretbox.mask('sk_live_abcd1234'), '••••1234');
});

test('resolution cascade: location overrides agency overrides env', async () => {
  // env fallback (none configured in DB): stripe resolves to none.
  let r = await integrations.resolve('stripe', { locationId: locId, agencyId });
  assert.equal(r.source, 'none');

  // Agency-level key → source becomes agencia.
  await request(app).put('/api/integrations/agency/stripe').set(headers).send({ secret_key: 'sk_agency_1' });
  r = await integrations.resolve('stripe', { locationId: locId, agencyId });
  assert.equal(r.config.secret_key, 'sk_agency_1');
  assert.equal(r.source, 'agencia');

  // Location override wins.
  await request(app).put('/api/integrations/stripe').set(headers).send({ secret_key: 'sk_location_9' });
  r = await integrations.resolve('stripe', { locationId: locId, agencyId });
  assert.equal(r.config.secret_key, 'sk_location_9');
  assert.equal(r.source, 'estancia');
});

test('GET /integrations masks secrets and reports source', async () => {
  const res = await request(app).get('/api/integrations').set(headers);
  assert.equal(res.status, 200);
  assert.equal(res.body.stripe.source, 'estancia');
  const secret = res.body.stripe.fields.find((f) => f.key === 'secret_key');
  assert.ok(secret.set, 'secret marked as set');
  assert.match(secret.value, /^••••/, 'secret is masked, never returned in clear');
  assert.doesNotMatch(secret.value, /sk_location_9/);
});

test('inherit: removing the location override falls back to agency', async () => {
  await request(app).put('/api/integrations/stripe').set(headers).send({ use_agency: true });
  const r = await integrations.resolve('stripe', { locationId: locId, agencyId });
  assert.equal(r.config.secret_key, 'sk_agency_1');
  assert.equal(r.source, 'agencia');
});

test('providers.status reflects per-location integrations', async () => {
  const providers = require('../server/services/providers');
  // Configure this location's own Twilio → sms should read as twilio for it.
  await request(app).put('/api/integrations/twilio').set(headers).send({
    account_sid: 'ACxxx', auth_token: 'tok', from_number: '+34600000000',
  });
  const st = await providers.status({ locationId: locId, agencyId });
  assert.equal(st.sms, 'twilio');
  assert.equal(st.sources.sms, 'estancia');
  assert.equal(st.payments, 'stripe'); // inherited from agency
});
