// v3.17: Tasks parity — assignee + overdue filters, assignment on create.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H, myId;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Tsk', name: 'Me', email: 'tsk@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  myId = (await request(app).get('/api/locations/team/users').set(H)).body[0].id;
});

test('assignee filter scopes tasks by user', async () => {
  await request(app).post('/api/tasks').set(H).send({ title: 'Mine', user_id: myId });
  // "mine" returns my tasks; a different user id returns none of mine.
  const mine = await request(app).get('/api/tasks?assignee=mine').set(H);
  assert.ok(mine.body.some((t) => t.title === 'Mine'));
  const other = await request(app).get('/api/tasks?assignee=999999').set(H);
  assert.ok(!other.body.some((t) => t.title === 'Mine'));
});

test('overdue filter returns only past-due open tasks', async () => {
  await request(app).post('/api/tasks').set(H).send({ title: 'Late', due_at: '2020-01-01T09:00:00' });
  await request(app).post('/api/tasks').set(H).send({ title: 'Future', due_at: '2099-01-01T09:00:00' });
  const overdue = await request(app).get('/api/tasks?overdue=1').set(H);
  assert.ok(overdue.body.some((t) => t.title === 'Late'));
  assert.ok(!overdue.body.some((t) => t.title === 'Future'));
  assert.ok(overdue.body.every((t) => t.status === 'open'));
});
