// v3.0: universal integration layer — public API keys and generic inbound
// webhooks. External apps authenticate with an API key; any app can POST a lead.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Integ', name: 'A', email: 'integ@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
});

test('API key authenticates the REST API and can be revoked', async () => {
  const created = await request(app).post('/api/api-keys').set('Authorization', `Bearer ${jwt}`).send({ name: 'Zapier' });
  assert.equal(created.status, 201);
  assert.match(created.body.key, /^lf_[0-9a-f]{48}$/);
  const key = created.body.key;

  // The key is never returned again (list is masked).
  const list = await request(app).get('/api/api-keys').set('Authorization', `Bearer ${jwt}`);
  assert.equal(list.body.length, 1);
  assert.ok(!JSON.stringify(list.body).includes(key));

  // Use the key (X-Api-Key) to hit a protected endpoint.
  const viaKey = await request(app).get('/api/contacts').set({ 'X-Api-Key': key, 'X-Location-Id': String(loc) });
  assert.equal(viaKey.status, 200);

  // Also works as a Bearer token.
  const viaBearer = await request(app).get('/api/contacts').set({ Authorization: `Bearer ${key}`, 'X-Location-Id': String(loc) });
  assert.equal(viaBearer.status, 200);

  // Managing keys with an API key is forbidden.
  const mgmt = await request(app).get('/api/api-keys').set({ 'X-Api-Key': key });
  assert.equal(mgmt.status, 403);

  // Revoke → key stops working.
  await request(app).delete(`/api/api-keys/${created.body.id}`).set('Authorization', `Bearer ${jwt}`);
  const after = await request(app).get('/api/contacts').set({ 'X-Api-Key': key, 'X-Location-Id': String(loc) });
  assert.equal(after.status, 401);
});

test('inbound webhook creates a contact from arbitrary posted JSON', async () => {
  const hook = await request(app).post('/api/inbound-webhooks')
    .set({ Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) })
    .send({ name: 'Landing externa', tag: 'inbound' });
  assert.equal(hook.status, 201);
  const token = hook.body.token;

  const post = await request(app).post(`/api/public/inbound/${token}`).send({
    name: 'Lucía Pérez', email: 'lucia@ext.com', phone: '+34611', empresa: 'Acme SL',
  });
  assert.equal(post.status, 201);
  assert.equal(post.body.created, true);

  const contacts = await request(app).get('/api/contacts?q=lucia@ext.com').set({ Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) });
  const c = contacts.body.find((x) => x.email === 'lucia@ext.com');
  assert.ok(c, 'contact created from webhook');
  assert.equal(c.first_name, 'Lucía');
  assert.equal(c.source, 'webhook:Landing externa');
  assert.ok(c.tags.includes('inbound'));
  assert.equal(c.custom_fields.empresa, 'Acme SL'); // extra field stored as custom

  // Unknown token → 404.
  const bad = await request(app).post('/api/public/inbound/nope').send({ email: 'x@x.com' });
  assert.equal(bad.status, 404);
});
