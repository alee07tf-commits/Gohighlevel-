// v1.8: agency snapshot library + auto-provisioning of sub-accounts + account
// -level custom values with {{custom_values.KEY}} token resolution.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let headers, sourceLoc, adminToken;

before(async () => {
  const res = await request(app).post('/api/auth/register').send({
    agency_name: 'V18', name: 'Admin', email: 'v18@test.com', password: 'secret1', location_name: 'Plantilla Base',
  });
  adminToken = res.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
  sourceLoc = me.body.locations[0].id;
  headers = { Authorization: `Bearer ${adminToken}`, 'X-Location-Id': String(sourceLoc) };

  // Seed representative structural config into the source sub-account.
  await request(app).post('/api/pipelines').set(headers).send({ name: 'Ventas' });
  await request(app).post('/api/marketing/templates').set(headers).send({
    name: 'Bienvenida', subject: 'Hola de {{custom_values.business_name}}', body: 'Gracias por contactar.',
  });
  await request(app).post('/api/custom-fields').set(headers).send({ name: 'Cumpleaños', type: 'date' });
  await request(app).post('/api/custom-values').set(headers).send({ label: 'Horario', value: 'L-V 9-18' });
  await request(app).post('/api/funnels').set(headers).send({ name: 'Captación' });
});

test('snapshot library: create from a sub-account captures the structural config', async () => {
  const created = await request(app).post('/api/snapshots').set(headers).send({
    name: 'Base Clínica', description: 'Plantilla de arranque', from_location_id: sourceLoc, is_default: true,
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.counts.pipelines >= 1, 'pipelines captured');
  assert.ok(created.body.counts.email_templates >= 1, 'templates captured');
  assert.ok(created.body.counts.custom_fields >= 1, 'custom fields captured');
  assert.ok(created.body.counts.custom_values >= 1, 'custom values captured');
  assert.ok(created.body.counts.funnels >= 1, 'funnels captured');

  const list = await request(app).get('/api/snapshots').set(headers);
  const snap = list.body.find((s) => s.id === created.body.id);
  assert.ok(snap, 'snapshot appears in the agency library');
  assert.equal(snap.is_default, true, 'marked as default');
});

test('auto-provision: creating a sub-account loads the default snapshot + seeds custom values', async () => {
  const res = await request(app).post('/api/locations').set(headers).send({
    name: 'Cliente Uno', phone: '+34600111222', email: 'cliente1@test.com',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.snapshot, 'Base Clínica', 'default snapshot auto-selected');
  assert.ok(res.body.provisioned.pipelines >= 1, 'pipeline provisioned');
  assert.ok(res.body.provisioned.email_templates >= 1, 'template provisioned');
  assert.ok(res.body.provisioned.custom_values >= 1, 'custom values provisioned');

  const newHeaders = { Authorization: `Bearer ${adminToken}`, 'X-Location-Id': String(res.body.id) };
  const pipelines = await request(app).get('/api/pipelines').set(newHeaders);
  assert.ok(pipelines.body.some((p) => p.name === 'Ventas'), 'pipeline copied into new sub-account');

  const cvs = await request(app).get('/api/custom-values').set(newHeaders);
  const businessName = cvs.body.find((v) => v.key === 'business_name');
  assert.ok(businessName, 'business_name seeded');
  assert.equal(businessName.value, 'Cliente Uno', 'business_name seeded from the profile');
  assert.ok(cvs.body.some((v) => v.key === 'horario' && v.value === 'L-V 9-18'), 'template custom value carried over');
});

test('empty provisioning: snapshot_id=0 creates a blank sub-account', async () => {
  const res = await request(app).post('/api/locations').set(headers).send({ name: 'Cliente Vacío', snapshot_id: 0 });
  assert.equal(res.status, 201);
  assert.equal(res.body.snapshot, null, 'no snapshot loaded');
  assert.equal(res.body.provisioned.pipelines || 0, 0, 'no pipelines');
  // Default custom values are still seeded from the profile.
  const h = { Authorization: `Bearer ${adminToken}`, 'X-Location-Id': String(res.body.id) };
  const cvs = await request(app).get('/api/custom-values').set(h);
  assert.ok(cvs.body.some((v) => v.key === 'business_name' && v.value === 'Cliente Vacío'));
});

test('custom values resolve in mergeFields and in a rendered funnel page', async () => {
  const { mergeFields } = require('../server/services/messaging');
  const customValues = require('../server/services/customValues');
  assert.equal(mergeFields('Hola {{custom_values.business_name}}', {}, { business_name: 'ACME' }), 'Hola ACME');
  assert.equal(customValues.apply('{{cv.x}}-{{custom_values.y}}', { x: '1', y: '2' }), '1-2');
  assert.equal(customValues.apply('faltante {{custom_values.nope}}', {}), 'faltante ', 'unknown token collapses to empty');

  // Provision a client, publish a funnel page that uses a custom value token.
  const loc = await request(app).post('/api/locations').set(headers).send({ name: 'Render SL', snapshot_id: 0 });
  const h = { Authorization: `Bearer ${adminToken}`, 'X-Location-Id': String(loc.body.id) };
  const funnel = await request(app).post('/api/funnels').set(h).send({ name: 'Home Render' });
  const page = funnel.body.pages[0];
  await request(app).put(`/api/funnels/${funnel.body.id}/pages/${page.id}`).set(h).send({
    published: true,
    content: [{ type: 'hero', headline: 'Bienvenido a {{custom_values.business_name}}', subheadline: '', cta: 'Ir' }],
  });
  const rendered = await request(app).get(`/f/${funnel.body.slug}`);
  assert.equal(rendered.status, 200);
  assert.match(rendered.text, /Bienvenido a Render SL/, 'custom value resolved in public funnel HTML');
  assert.doesNotMatch(rendered.text, /custom_values\.business_name/, 'no raw token leaks');
});
