// v56: Documents & Contracts with e-signature. Draft → send → public sign page
// → signed, with an activity logged on the contact. Parity with GHL.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let H, contactId, doc;

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Docs', name: 'A', email: 'docs@test.com', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  H = { Authorization: `Bearer ${r.body.token}`, 'X-Location-Id': String(me.body.locations[0].id) };
  const c = await request(app).post('/api/contacts').set(H).send({ first_name: 'Ana', email: 'ana@x.com' });
  contactId = c.body.id;
});

test('creates a draft document with a token', async () => {
  const res = await request(app).post('/api/documents').set(H).send({
    title: 'Contrato de servicios', body: 'Términos del acuerdo...', contact_id: contactId,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'draft');
  assert.ok(res.body.token);
  doc = res.body;
});

test('send marks it sent and returns the public sign link', async () => {
  const res = await request(app).post(`/api/documents/${doc.id}/send`).set(H);
  assert.equal(res.status, 200);
  assert.match(res.body.url, /\/sign\//);
});

test('the public sign page renders the document and a signature pad', async () => {
  const res = await request(app).get(`/sign/${doc.token}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /Contrato de servicios/);
  assert.match(res.text, /canvas/);
});

test('the client can sign it and it becomes signed', async () => {
  const res = await request(app).post(`/sign/${doc.token}`).send({
    signer_name: 'Ana Pérez', signature: 'data:image/png;base64,iVBORw0KGgo=',
  });
  assert.equal(res.status, 200);
  const list = await request(app).get('/api/documents').set(H);
  const signed = list.body.find((d) => d.id === doc.id);
  assert.equal(signed.status, 'signed');
  assert.equal(signed.signer_name, 'Ana Pérez');
  assert.ok(signed.signed_at);
});

test('a signed document cannot be signed again or edited', async () => {
  const resign = await request(app).post(`/sign/${doc.token}`).send({ signer_name: 'X', signature: 'data:image/png;base64,AA==' });
  assert.equal(resign.status, 400);
  const edit = await request(app).put(`/api/documents/${doc.id}`).set(H).send({ title: 'Cambiado' });
  assert.equal(edit.status, 400);
});

test('the signed sign page shows the confirmation instead of the pad', async () => {
  const res = await request(app).get(`/sign/${doc.token}`);
  assert.match(res.text, /firmado por Ana Pérez/i);
  assert.doesNotMatch(res.text, /<canvas/);
});
