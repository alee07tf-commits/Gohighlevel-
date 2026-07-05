// v3.11: Inbox parity — saved replies (snippets), conversation filters,
// assignment, and AI reply suggestion.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H, myId, convId;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Inbox', name: 'Agent', email: 'inbox@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  const team = await request(app).get('/api/locations/team/users').set(H);
  myId = team.body[0].id;
  const c = await request(app).post('/api/contacts').set(H).send({ first_name: 'Lola', phone: '+34600' });
  const conv = await request(app).post(`/api/conversations/start/${c.body.id}`).set(H);
  convId = conv.body.id;
});

test('snippets CRUD', async () => {
  const created = await request(app).post('/api/snippets').set(H).send({ title: 'Saludo', body: 'Hola {{first_name}}' });
  assert.equal(created.status, 201);
  const list = await request(app).get('/api/snippets').set(H);
  assert.ok(list.body.some((s) => s.title === 'Saludo'));
  const upd = await request(app).put(`/api/snippets/${created.body.id}`).set(H).send({ title: 'Bienvenida' });
  assert.equal(upd.body.title, 'Bienvenida');
  const del = await request(app).delete(`/api/snippets/${created.body.id}`).set(H);
  assert.equal(del.status, 200);
});

test('unanswered filter surfaces conversations whose last message is inbound', async () => {
  await request(app).post(`/api/conversations/${convId}/simulate-inbound`).set(H).send({ channel: 'sms', body: 'hola' });
  const unanswered = await request(app).get('/api/conversations?filter=unanswered').set(H);
  assert.ok(unanswered.body.some((cv) => cv.id === convId));
  assert.equal(unanswered.body.find((cv) => cv.id === convId).last_direction, 'inbound');
});

test('assignment + the "mine" filter', async () => {
  const asg = await request(app).put(`/api/conversations/${convId}/assign`).set(H).send({ user_id: myId });
  assert.equal(asg.body.assigned_user_id, myId);
  const mine = await request(app).get('/api/conversations?filter=mine').set(H);
  assert.ok(mine.body.some((cv) => cv.id === convId));
  assert.equal(mine.body.find((cv) => cv.id === convId).assigned_name, 'Agent');
});

test('AI suggest returns a draft reply (template offline)', async () => {
  const s = await request(app).post(`/api/conversations/${convId}/ai-suggest`).set(H).send({});
  assert.equal(s.status, 200);
  assert.ok(s.body.reply && s.body.reply.length > 0);
});
