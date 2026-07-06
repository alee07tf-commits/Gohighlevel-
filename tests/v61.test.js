// v61: Community — an agency-level feed with posts and comments, scoped per
// agency, author/admin moderation. Parity with GHL communities/groups.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let adminH, memberToken, otherH, postId;

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Comm', name: 'Admin', email: 'comm@test.com', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  adminH = { Authorization: `Bearer ${r.body.token}`, 'X-Location-Id': String(me.body.locations[0].id) };
  await request(app).post('/api/locations/team/users').set(adminH).send({ name: 'Miembro', email: 'm@comm.com', password: 'secret1', role: 'member' });
  const login = await request(app).post('/api/auth/login').send({ email: 'm@comm.com', password: 'secret1' });
  memberToken = login.body.token;
  // A separate agency (should never see the first agency's posts).
  const r2 = await request(app).post('/api/auth/register').send({
    agency_name: 'Other', name: 'B', email: 'other@test.com', password: 'secret1', location_name: 'X',
  });
  otherH = { Authorization: `Bearer ${r2.body.token}` };
});

test('a member can post and it appears in the feed', async () => {
  const res = await request(app).post('/api/community').set({ Authorization: `Bearer ${memberToken}` })
    .send({ title: 'Hola equipo', body: 'Primer post de la comunidad' });
  assert.equal(res.status, 201);
  postId = res.body.id;
  const feed = await request(app).get('/api/community').set(adminH);
  assert.ok(feed.body.some((p) => p.id === postId), 'post visible to the agency');
  assert.equal(feed.body.find((p) => p.id === postId).author, 'Miembro');
});

test('posts are isolated per agency', async () => {
  const feed = await request(app).get('/api/community').set(otherH);
  assert.ok(!feed.body.some((p) => p.id === postId), 'other agency cannot see the post');
});

test('comments thread onto a post', async () => {
  await request(app).post(`/api/community/${postId}/comments`).set(adminH).send({ body: '¡Bienvenido!' });
  const thread = await request(app).get(`/api/community/${postId}`).set(adminH);
  assert.equal(thread.body.comments.length, 1);
  assert.equal(thread.body.comments[0].author, 'Admin');
});

test('an admin can moderate (delete) another user post', async () => {
  const del = await request(app).delete(`/api/community/${postId}`).set(adminH);
  assert.equal(del.status, 200);
  const feed = await request(app).get('/api/community').set(adminH);
  assert.ok(!feed.body.some((p) => p.id === postId));
});

test('a member cannot delete a post they do not own', async () => {
  const p = await request(app).post('/api/community').set(adminH).send({ body: 'Post del admin' });
  const del = await request(app).delete(`/api/community/${p.body.id}`).set({ Authorization: `Bearer ${memberToken}` });
  assert.equal(del.status, 403);
});
