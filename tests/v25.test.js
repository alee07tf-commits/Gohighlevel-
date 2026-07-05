// v2.5: security + correctness hardening from the audit. Cross-tenant contact
// references are rejected, enums/JSON validated (400 not 500), config reads are
// ownership-checked, and X-Agency-Id drill-down is admin-only.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let A, B; // { tok, loc }
async function agency(name, email) {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: name, name: 'Admin', email, password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  return { tok: r.body.token, loc: me.body.locations[0].id, agencyId: r.body.user.agency_id };
}
const H = (a, extra = {}) => ({ Authorization: `Bearer ${a.tok}`, 'X-Location-Id': String(a.loc), ...extra });

before(async () => {
  A = await agency('Sec A', 'seca@test.com');
  B = await agency('Sec B', 'secb@test.com');
});

test('opportunities: reject a contact_id from another tenant', async () => {
  const bc = await request(app).post('/api/contacts').set(H(B)).send({ first_name: 'Bob', email: 'bob@b.test' });
  const pipe = await request(app).post('/api/pipelines').set(H(A)).send({ name: 'Ventas' });
  const r = await request(app).post(`/api/pipelines/${pipe.body.id}/opportunities`).set(H(A))
    .send({ title: 'Robo', contact_id: bc.body.id });
  assert.equal(r.status, 400);
});

test('opportunities: reject an invalid status on update', async () => {
  const pipe = await request(app).post('/api/pipelines').set(H(A)).send({ name: 'P2' });
  const opp = await request(app).post(`/api/pipelines/${pipe.body.id}/opportunities`).set(H(A)).send({ title: 'Deal' });
  const r = await request(app).put(`/api/pipelines/opportunities/${opp.body.id}`).set(H(A)).send({ status: 'hacked' });
  assert.equal(r.status, 400);
});

test('appointments: reject a contact_id from another tenant', async () => {
  const bc = await request(app).post('/api/contacts').set(H(B)).send({ first_name: 'Eve', email: 'eve@b.test' });
  const cal = await request(app).post('/api/calendars').set(H(A)).send({ name: 'Citas' });
  const r = await request(app).post(`/api/calendars/${cal.body.id}/appointments`).set(H(A))
    .send({ title: 'X', starts_at: '2030-01-01T10:00', contact_id: bc.body.id });
  assert.equal(r.status, 400);
});

test('contacts: invalid custom_fields JSON returns 400, not 500', async () => {
  const c = await request(app).post('/api/contacts').set(H(A)).send({ first_name: 'Ana' });
  const r = await request(app).put(`/api/contacts/${c.body.id}`).set(H(A)).send({ custom_fields: '{not json' });
  assert.equal(r.status, 400);
});

test('contacts: merge rejects same id even across types (no self-delete)', async () => {
  const c = await request(app).post('/api/contacts').set(H(A)).send({ first_name: 'Dup' });
  const r = await request(app).post('/api/contacts/merge').set(H(A)).send({ keep_id: c.body.id, merge_id: String(c.body.id) });
  assert.equal(r.status, 400);
});

test('system/integrations: a foreign location id is rejected', async () => {
  const r = await request(app).get('/api/system/integrations').set({ Authorization: `Bearer ${A.tok}`, 'X-Location-Id': String(B.loc) });
  assert.equal(r.status, 404);
});

test('tasks: reject a contact_id from another tenant', async () => {
  const bc = await request(app).post('/api/contacts').set(H(B)).send({ first_name: 'Foreign' });
  const r = await request(app).post('/api/tasks').set(H(A)).send({ title: 'T', contact_id: bc.body.id });
  assert.equal(r.status, 400);
});

test('X-Agency-Id drill-down is admin-only', async () => {
  // A creates a client (child agency) and a member user.
  const child = await request(app).post('/api/clients').set({ Authorization: `Bearer ${A.tok}` })
    .send({ agency_name: 'Hijo', admin_email: 'hijo@test.com', admin_password: 'secret1', snapshot_id: 0 });
  await request(app).post('/api/locations/team/users').set(H(A))
    .send({ name: 'Miembro', email: 'miembro@seca.com', password: 'secret1', role: 'member' });
  const login = await request(app).post('/api/auth/login').send({ email: 'miembro@seca.com', password: 'secret1' });

  // Member tries to drill into the child agency → 403.
  const denied = await request(app).get('/api/auth/me')
    .set({ Authorization: `Bearer ${login.body.token}`, 'X-Agency-Id': String(child.body.id) });
  assert.equal(denied.status, 403);

  // Admin can.
  const ok = await request(app).get('/api/auth/me')
    .set({ Authorization: `Bearer ${A.tok}`, 'X-Agency-Id': String(child.body.id) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.agency.id, child.body.id);
});
