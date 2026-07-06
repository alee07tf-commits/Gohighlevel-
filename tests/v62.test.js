// v62: Granular per-module permissions for member users. An admin restricts a
// member to specific modules; the backend blocks the rest with 403. Empty list
// = full access (backward compatible).
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let adminH, memberId, loc;
const memberH = () => ({ Authorization: `Bearer ${memberToken}`, 'X-Location-Id': String(loc) });
let memberToken;

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Perm', name: 'Admin', email: 'perm@test.com', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  loc = me.body.locations[0].id;
  adminH = { Authorization: `Bearer ${r.body.token}`, 'X-Location-Id': String(loc) };
  const m = await request(app).post('/api/locations/team/users').set(adminH).send({ name: 'Miembro', email: 'pm@perm.com', password: 'secret1', role: 'member' });
  memberId = m.body.id;
  const login = await request(app).post('/api/auth/login').send({ email: 'pm@perm.com', password: 'secret1' });
  memberToken = login.body.token;
});

test('by default (no permissions) a member accesses everything', async () => {
  const contacts = await request(app).get('/api/contacts').set(memberH());
  assert.equal(contacts.status, 200);
  const tasks = await request(app).get('/api/tasks').set(memberH());
  assert.equal(tasks.status, 200);
});

test('admin restricts the member to a subset of modules', async () => {
  const res = await request(app).put(`/api/locations/team/users/${memberId}/permissions`).set(adminH)
    .send({ allowed: ['contacts', 'tasks'] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.allowed.sort(), ['contacts', 'tasks']);
});

test('allowed modules work, disallowed ones return 403', async () => {
  const contacts = await request(app).get('/api/contacts').set(memberH());
  assert.equal(contacts.status, 200, 'contacts allowed');
  const payments = await request(app).get('/api/payments').set(memberH());
  assert.equal(payments.status, 403, 'payments blocked');
  const funnels = await request(app).get('/api/funnels').set(memberH());
  assert.equal(funnels.status, 403, 'funnels blocked');
});

test('admins are never restricted by permissions', async () => {
  const payments = await request(app).get('/api/payments').set(adminH);
  assert.equal(payments.status, 200);
});

test('clearing permissions restores full access', async () => {
  await request(app).put(`/api/locations/team/users/${memberId}/permissions`).set(adminH).send({ allowed: [] });
  const payments = await request(app).get('/api/payments').set(memberH());
  assert.equal(payments.status, 200);
});

test('a member cannot change permissions', async () => {
  const res = await request(app).put(`/api/locations/team/users/${memberId}/permissions`).set(memberH()).send({ allowed: ['contacts'] });
  assert.equal(res.status, 403);
});
