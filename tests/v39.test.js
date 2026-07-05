// v3.10: Contacts to 100% vs GHL — Companies object, additional emails/phones,
// per-channel DND.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Co', name: 'A', email: 'co@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
});

test('companies CRUD and contact linkage with counts', async () => {
  const created = await request(app).post('/api/companies').set(H).send({ name: 'Acme SL', website: 'acme.com', industry: 'Retail' });
  assert.equal(created.status, 201);
  const companyId = created.body.id;

  // Link a contact to the company at creation.
  const c = await request(app).post('/api/contacts').set(H).send({ first_name: 'Ana', email: 'ana@acme.com', company_id: companyId });
  assert.equal(c.status, 201);

  const list = await request(app).get('/api/companies').set(H);
  const co = list.body.find((x) => x.id === companyId);
  assert.equal(Number(co.contact_count), 1);

  const detail = await request(app).get(`/api/companies/${companyId}`).set(H);
  assert.equal(detail.body.contacts.length, 1);
  assert.equal(detail.body.contacts[0].email, 'ana@acme.com');

  // The contact detail surfaces its company.
  const cd = await request(app).get(`/api/contacts/${c.body.id}`).set(H);
  assert.equal(cd.body.company.name, 'Acme SL');
});

test('additional emails/phones are stored and searchable', async () => {
  const c = await request(app).post('/api/contacts').set(H).send({ first_name: 'Beto', email: 'beto@x.com' });
  await request(app).put(`/api/contacts/${c.body.id}`).set(H).send({
    additional_emails: ['beto.work@corp.com'], additional_phones: ['+34999888'],
  });
  const got = await request(app).get(`/api/contacts/${c.body.id}`).set(H);
  assert.deepEqual(got.body.additional_emails, ['beto.work@corp.com']);
  assert.deepEqual(got.body.additional_phones, ['+34999888']);

  // Search matches an additional email.
  const search = await request(app).get('/api/contacts?q=beto.work@corp.com').set(H);
  assert.ok(search.body.some((x) => x.id === c.body.id));
});

test('per-channel DND blocks only that channel', async () => {
  const c = await request(app).post('/api/contacts').set(H).send({ first_name: 'Cira', email: 'cira@x.com', phone: '+34600' });
  await request(app).put(`/api/contacts/${c.body.id}`).set(H).send({ dnd_email: true }); // email blocked, sms allowed

  const email = await request(app).post(`/api/contacts/${c.body.id}/message`).set(H).send({ channel: 'email', subject: 'x', body: 'y' });
  assert.equal(email.status, 400);
  const sms = await request(app).post(`/api/contacts/${c.body.id}/message`).set(H).send({ channel: 'sms', body: 'y' });
  assert.equal(sms.status, 201);
});
