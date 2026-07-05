// v3.1: native app marketplace — catalog, OAuth connect (config-gated), manual
// connect, disconnect, and the Meta Lead Ads webhook (verify + leadgen ingest).
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Apps', name: 'A', email: 'apps@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
});

test('marketplace lists the catalog with config state', async () => {
  const r = await request(app).get('/api/apps').set(H);
  assert.equal(r.status, 200);
  const meta = r.body.catalog.find((a) => a.key === 'meta');
  assert.ok(meta, 'meta app present');
  assert.equal(meta.category, 'ads');
  // No META_APP_ID set → not configured, lists what is missing.
  assert.equal(meta.configured, false);
  assert.ok(meta.missing_env.includes('META_APP_ID'));
  assert.deepEqual(r.body.connected, {});
});

test('connect is gated on operator config, then yields an authorize URL', async () => {
  delete process.env.META_APP_ID; delete process.env.META_APP_SECRET;
  const pending = await request(app).post('/api/apps/meta/connect').set(H).send({});
  assert.equal(pending.status, 200);
  assert.equal(pending.body.needs_config, true);

  // Operator supplies OAuth client credentials.
  process.env.META_APP_ID = 'appid123';
  process.env.META_APP_SECRET = 'secret456';
  const ready = await request(app).post('/api/apps/meta/connect').set(H).send({});
  assert.equal(ready.status, 200);
  assert.ok(ready.body.authorize_url.startsWith('https://www.facebook.com/'));
  assert.ok(ready.body.authorize_url.includes('client_id=appid123'));
  assert.ok(ready.body.authorize_url.includes('state='));
  delete process.env.META_APP_ID; delete process.env.META_APP_SECRET;
});

test('OAuth callback rejects a tampered state', async () => {
  const cb = await request(app).get('/api/apps/oauth/callback?code=x&state=forged.signature');
  assert.equal(cb.status, 302);
  assert.match(cb.headers.location, /integration_error=invalid_state/);
});

test('manual connect, then disconnect', async () => {
  const created = await request(app).post('/api/apps/zoom/manual').set(H)
    .send({ access_token: 'tok_abc', display_name: 'Mi Zoom' });
  assert.equal(created.status, 201);
  const list = await request(app).get('/api/apps').set(H);
  assert.ok(list.body.connected.zoom, 'zoom now connected');
  // Tokens are never leaked back to the client.
  assert.ok(!JSON.stringify(list.body).includes('tok_abc'));

  const del = await request(app).delete(`/api/apps/connected/${list.body.connected.zoom.id}`).set(H);
  assert.equal(del.status, 200);
  const after = await request(app).get('/api/apps').set(H);
  assert.ok(!after.body.connected.zoom, 'zoom disconnected');
});

test('Meta webhook verifies the subscription challenge', async () => {
  process.env.META_VERIFY_TOKEN = 'verify-me';
  const ok = await request(app).get('/api/public/meta/webhook')
    .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '42abc' });
  assert.equal(ok.status, 200);
  assert.equal(ok.text, '42abc');
  const bad = await request(app).get('/api/public/meta/webhook')
    .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '42abc' });
  assert.equal(bad.status, 403);
});

test('Meta leadgen webhook ingests a lead into the mapped sub-account', async () => {
  // A page is mapped to this sub-account via a manual meta connection.
  await request(app).post('/api/apps/meta/manual').set(H)
    .send({ access_token: 'pagetok', external_id: 'PAGE_777', display_name: 'Mi Página' });

  const hook = await request(app).post('/api/public/meta/webhook').send({
    entry: [{ id: 'PAGE_777', changes: [{ field: 'leadgen', value: {
      page_id: 'PAGE_777', form_id: 'FORM_9', field_data: [
        { name: 'email', values: ['ana@meta.com'] },
        { name: 'full_name', values: ['Ana Ruiz'] },
        { name: 'phone_number', values: ['+34600111'] },
        { name: 'ciudad', values: ['Madrid'] },
      ],
    } }] }],
  });
  assert.equal(hook.status, 200); // acknowledged immediately

  // Ingest runs after the ack; poll briefly for the contact.
  let c = null;
  for (let i = 0; i < 40 && !c; i++) {
    const contacts = await request(app).get('/api/contacts?q=ana@meta.com').set(H);
    c = (contacts.body || []).find((x) => x.email === 'ana@meta.com');
    if (!c) await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(c, 'contact ingested from Meta lead');
  assert.equal(c.first_name, 'Ana');
  assert.equal(c.source, 'meta:lead-ad');
  assert.ok(c.tags.includes('meta-lead'));
  assert.equal(c.custom_fields.ciudad, 'Madrid');
  assert.equal(c.custom_fields.meta_form_id, 'FORM_9');
});
