// v3.2: full GoHighLevel-style catalog + API-key ("apikey") and builtin app
// connection flows alongside OAuth.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Cat', name: 'A', email: 'cat@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
});

test('catalog matches the GHL native set across categories', async () => {
  const r = await request(app).get('/api/apps').set(H);
  const keys = r.body.catalog.map((a) => a.key);
  for (const k of ['calendly', 'microsoft', 'google_ads', 'tiktok_ads', 'linkedin', 'twitter', 'youtube',
                   'pinterest', 'messenger', 'instagram_dm', 'mailgun', 'sendgrid', 'smtp',
                   'square', 'authorize_net', 'nmi', 'razorpay', 'google_analytics', 'wordpress',
                   'hubspot', 'zapier', 'make', 'n8n']) {
    assert.ok(keys.includes(k), `catalog includes ${k}`);
  }
  // Categories present and each app tags an auth style.
  assert.ok(r.body.categories.scheduling && r.body.categories.social && r.body.categories.email);
  const calendly = r.body.catalog.find((a) => a.key === 'calendly');
  assert.equal(calendly.auth, 'oauth');
  const mailgun = r.body.catalog.find((a) => a.key === 'mailgun');
  assert.equal(mailgun.auth, 'apikey');
  assert.ok(mailgun.fields.some((f) => f.key === 'api_key' && f.secret));
  const zapier = r.body.catalog.find((a) => a.key === 'zapier');
  assert.equal(zapier.auth, 'builtin');
  // API-key apps are "configured" without any operator env.
  assert.equal(mailgun.configured, true);
});

test('managed tier: SMS/WhatsApp are agency-provided, not connect-your-own', async () => {
  const r = await request(app).get('/api/apps').set(H);
  // The managed services exist and default to inactive (no provider configured).
  const managed = Object.fromEntries(r.body.managed.map((m) => [m.key, m]));
  for (const k of ['sms', 'whatsapp', 'email', 'ai']) assert.ok(managed[k], `managed includes ${k}`);
  assert.equal(managed.sms.active, false);
  // They are NOT in the connect-your-own marketplace catalog.
  const keys = r.body.catalog.map((a) => a.key);
  assert.ok(!keys.includes('twilio'));
  assert.ok(!keys.includes('whatsapp'));

  // The operator provides Twilio once (platform env) → every sub-account's SMS
  // and WhatsApp light up automatically, with zero client setup.
  process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
  process.env.TWILIO_AUTH_TOKEN = 'tok';
  process.env.TWILIO_FROM_NUMBER = '+34600';
  process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+34600';
  const r2 = await request(app).get('/api/apps').set(H);
  const m2 = Object.fromEntries(r2.body.managed.map((m) => [m.key, m]));
  assert.equal(m2.sms.active, true);
  assert.equal(m2.sms.source, 'plataforma');
  assert.equal(m2.whatsapp.active, true);
  delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM_NUMBER; delete process.env.TWILIO_WHATSAPP_FROM;
});

test('API-key app connects via fields, masks secrets, disconnects', async () => {
  const created = await request(app).post('/api/apps/mailgun/manual').set(H)
    .send({ fields: { api_key: 'key-supersecret-123', domain: 'mg.example.com' } });
  assert.equal(created.status, 201);

  const list = await request(app).get('/api/apps').set(H);
  const conn = list.body.connected.mailgun;
  assert.ok(conn, 'mailgun connected');
  assert.equal(conn.data.display.domain, 'mg.example.com'); // non-secret kept
  assert.ok(conn.data.masked.api_key.endsWith('123')); // secret shown masked
  // The raw secret never leaves the server.
  assert.ok(!JSON.stringify(list.body).includes('key-supersecret-123'));

  const del = await request(app).delete(`/api/apps/connected/${conn.id}`).set(H);
  assert.equal(del.status, 200);
});

test('API-key app rejects missing required fields', async () => {
  const bad = await request(app).post('/api/apps/mailgun/manual').set(H)
    .send({ fields: { api_key: 'only-key' } }); // domain missing
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /domain/);
});

test('connect endpoint is OAuth-only; builtin/apikey are rejected', async () => {
  const viaOauth = await request(app).post('/api/apps/mailgun/connect').set(H).send({});
  assert.equal(viaOauth.status, 400); // apikey app, not OAuth

  const builtin = await request(app).post('/api/apps/zapier/connect').set(H).send({});
  assert.equal(builtin.status, 400);

  // builtin apps have no field spec, so manual-by-fields is refused too.
  const builtinManual = await request(app).post('/api/apps/zapier/manual').set(H).send({ fields: { x: 1 } });
  assert.equal(builtinManual.status, 400);
});

test('Calendly OAuth lights up once its client credentials are set', async () => {
  const pending = await request(app).post('/api/apps/calendly/connect').set(H).send({});
  assert.equal(pending.body.needs_config, true);
  assert.ok(pending.body.missing.includes('CALENDLY_CLIENT_ID'));

  process.env.CALENDLY_CLIENT_ID = 'cal_id';
  process.env.CALENDLY_CLIENT_SECRET = 'cal_secret';
  const ready = await request(app).post('/api/apps/calendly/connect').set(H).send({});
  assert.ok(ready.body.authorize_url.startsWith('https://auth.calendly.com/'));
  assert.ok(ready.body.authorize_url.includes('client_id=cal_id'));
  delete process.env.CALENDLY_CLIENT_ID; delete process.env.CALENDLY_CLIENT_SECRET;
});
