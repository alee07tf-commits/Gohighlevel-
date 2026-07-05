// v2.2 (Phase 4b): white-label client handoff. Each client agency gets a unique
// slug on creation and a public branding endpoint that powers its branded login
// page (`#/login/<slug>`), so a handed-off account looks like the client's own.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let rootTok;
const H = (tok) => ({ Authorization: `Bearer ${tok}` });

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'WL Agency', name: 'Owner', email: 'wl@test.com', password: 'secret1', location_name: 'HQ',
  });
  rootTok = r.body.token;
});

test('clients: a new client gets a unique slug automatically', async () => {
  const a = await request(app).post('/api/clients').set(H(rootTok)).send({
    agency_name: 'Clínica Sonrisa', admin_email: 'a@sonrisa.io', admin_password: 'secret1', snapshot_id: 0,
  });
  assert.equal(a.status, 201);
  assert.equal(a.body.slug, 'clinica-sonrisa');

  // A second client with the same name gets a de-duplicated slug.
  const b = await request(app).post('/api/clients').set(H(rootTok)).send({
    agency_name: 'Clínica Sonrisa', admin_email: 'b@sonrisa.io', admin_password: 'secret1', snapshot_id: 0,
  });
  assert.equal(b.status, 201);
  assert.equal(b.body.slug, 'clinica-sonrisa-2');
});

test('public brand endpoint returns the client branding for its slug', async () => {
  // Set branding on the first client.
  const list = await request(app).get('/api/clients').set(H(rootTok));
  const client = list.body.find((c) => c.slug === 'clinica-sonrisa');
  await request(app).put(`/api/clients/${client.id}`).set(H(rootTok)).send({
    brand_color: '#ff8800', logo_url: 'https://cdn.example/logo.png', signup_headline: 'Accede a tu panel',
  });

  const brand = await request(app).get('/api/public/brand/clinica-sonrisa');
  assert.equal(brand.status, 200);
  assert.equal(brand.body.name, 'Clínica Sonrisa');
  assert.equal(brand.body.brand_color, '#ff8800');
  assert.equal(brand.body.logo_url, 'https://cdn.example/logo.png');
  assert.equal(brand.body.headline, 'Accede a tu panel');
});

test('public brand endpoint 404s for an unknown slug and needs no auth', async () => {
  const r = await request(app).get('/api/public/brand/does-not-exist');
  assert.equal(r.status, 404);
});

test('editing a client slug keeps it unique', async () => {
  const list = await request(app).get('/api/clients').set(H(rootTok));
  const second = list.body.find((c) => c.slug === 'clinica-sonrisa-2');
  // Try to collide with the first client's slug → server de-duplicates.
  const r = await request(app).put(`/api/clients/${second.id}`).set(H(rootTok)).send({ slug: 'clinica-sonrisa' });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.slug, 'clinica-sonrisa');
  assert.match(r.body.slug, /^clinica-sonrisa-\d+$/);
});
