// v3.12: Opportunities parity — owner assignment, lost reason, source, and
// owner/search filters.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H, myId, pipeId;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Deals', name: 'Rep', email: 'deals@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  myId = (await request(app).get('/api/locations/team/users').set(H)).body[0].id;
  pipeId = (await request(app).post('/api/pipelines').set(H).send({ name: 'Ventas' })).body.id;
});

test('opportunity carries an owner and source', async () => {
  const o = await request(app).post(`/api/pipelines/${pipeId}/opportunities`).set(H)
    .send({ title: 'Deal A', value: 500, owner_user_id: myId, source: 'web' });
  assert.equal(o.status, 201);
  const list = await request(app).get(`/api/pipelines/${pipeId}/opportunities`).set(H);
  const found = list.body.find((x) => x.id === o.body.id);
  assert.equal(found.owner_name, 'Rep');
  assert.equal(found.source, 'web');
});

test('marking lost stores the reason; won clears it', async () => {
  const o = await request(app).post(`/api/pipelines/${pipeId}/opportunities`).set(H).send({ title: 'Deal B', value: 100 });
  const lost = await request(app).put(`/api/pipelines/opportunities/${o.body.id}`).set(H)
    .send({ status: 'lost', lost_reason: 'price' });
  assert.equal(lost.body.status, 'lost');
  assert.equal(lost.body.lost_reason, 'price');
  const won = await request(app).put(`/api/pipelines/opportunities/${o.body.id}`).set(H).send({ status: 'won' });
  assert.equal(won.body.lost_reason, ''); // cleared when not lost
});

test('owner and search filters', async () => {
  await request(app).post(`/api/pipelines/${pipeId}/opportunities`).set(H).send({ title: 'Unowned', value: 10 });
  const byOwner = await request(app).get(`/api/pipelines/${pipeId}/opportunities?owner=${myId}`).set(H);
  assert.ok(byOwner.body.every((o) => o.owner_user_id === myId));
  assert.ok(byOwner.body.some((o) => o.title === 'Deal A'));

  const byQ = await request(app).get(`/api/pipelines/${pipeId}/opportunities?q=Unowned`).set(H);
  assert.ok(byQ.body.some((o) => o.title === 'Unowned'));
  assert.ok(!byQ.body.some((o) => o.title === 'Deal A'));
});
