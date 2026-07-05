// v3.3: agency configures a managed service ONCE and it cascades to every
// sub-account (GHL LC Phone model). Verified end-to-end through the same
// /api/apps managed tier the client sees.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Central', name: 'A', email: 'central@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
});

test('SMS/WhatsApp are inactive until the agency configures Twilio', async () => {
  const r = await request(app).get('/api/apps').set(H);
  const m = Object.fromEntries(r.body.managed.map((x) => [x.key, x]));
  assert.equal(m.sms.active, false);
  assert.equal(m.whatsapp.active, false);
});

test('agency configures Twilio once → it cascades to the sub-account', async () => {
  const put = await request(app).put('/api/integrations/agency/twilio').set('Authorization', `Bearer ${jwt}`)
    .send({ account_sid: 'ACtest', auth_token: 'secrettoken', from_number: '+34600', whatsapp_from: 'whatsapp:+34600' });
  assert.equal(put.status, 200);

  // The agency-scope read masks the secret and marks it configured.
  const cfg = await request(app).get('/api/integrations/agency/twilio').set('Authorization', `Bearer ${jwt}`);
  const authField = cfg.body.fields.find((f) => f.key === 'auth_token');
  assert.equal(authField.set, true);
  assert.ok(authField.value.startsWith('••••'));
  assert.ok(!JSON.stringify(cfg.body).includes('secrettoken'));

  // The client-facing managed tier now shows SMS + WhatsApp active, sourced
  // from the agency — with zero setup on the sub-account.
  const apps = await request(app).get('/api/apps').set(H);
  const m = Object.fromEntries(apps.body.managed.map((x) => [x.key, x]));
  assert.equal(m.sms.active, true);
  assert.equal(m.sms.source, 'agencia');
  assert.equal(m.whatsapp.active, true);
});

test('clearing the agency service turns it off for all sub-accounts', async () => {
  const clr = await request(app).put('/api/integrations/agency/twilio').set('Authorization', `Bearer ${jwt}`).send({ clear: true });
  assert.equal(clr.status, 200);
  const apps = await request(app).get('/api/apps').set(H);
  const m = Object.fromEntries(apps.body.managed.map((x) => [x.key, x]));
  assert.equal(m.sms.active, false);
});
