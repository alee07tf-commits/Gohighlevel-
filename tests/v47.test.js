// v3.18: Reputation parity — bulk review requests (by tag, DND-aware).
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Rep', name: 'A', email: 'rep@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  const a = await request(app).post('/api/contacts').set(H).send({ first_name: 'A', phone: '+34600', email: 'a@x.com' });
  const b = await request(app).post('/api/contacts').set(H).send({ first_name: 'B', phone: '+34601', email: 'b@x.com' });
  await request(app).post('/api/contacts/bulk/tags').set(H).send({ ids: [a.body.id, b.body.id], tag: 'client', op: 'add' });
  await request(app).put(`/api/contacts/${b.body.id}`).set(H).send({ dnd_sms: true }); // B blocks SMS
});

test('bulk review request targets the tag and skips DND on the channel', async () => {
  const r = await request(app).post('/api/reputation/request-bulk').set(H).send({ tag: 'client', channel: 'sms' });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 2);
  assert.equal(r.body.sent, 1); // B (dnd_sms) skipped
});

test('empty tag targets everyone', async () => {
  const r = await request(app).post('/api/reputation/request-bulk').set(H).send({ channel: 'email' });
  assert.equal(r.body.total, 2); // both, and email not DND for either
  assert.equal(r.body.sent, 2);
});
