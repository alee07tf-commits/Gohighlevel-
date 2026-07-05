// v2.8: client-facing memberships — publish a training course to a public
// academy page (/course/<token>) for a business's end-customers.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let H, courseId;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Mem', name: 'A', email: 'mem@test.com', password: 'secret1', location_name: 'Sede',
  });
  H = { Authorization: `Bearer ${r.body.token}` };
  const c = await request(app).post('/api/training/courses').set(H).send({ title: 'Curso Cliente', description: 'Para clientes' });
  courseId = c.body.id;
  await request(app).post(`/api/training/courses/${courseId}/lessons`).set(H).send({ title: 'Lección Uno', youtube_url: 'https://youtu.be/dQw4w9WgXcQ' });
});

test('publish exposes a public course page; unpublish removes it', async () => {
  const pub = await request(app).post(`/api/training/courses/${courseId}/publish`).set(H);
  assert.equal(pub.status, 200);
  assert.ok(pub.body.public_token, 'token issued');
  const token = pub.body.public_token;

  const page = await request(app).get(`/course/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Curso Cliente/);
  assert.match(page.text, /Lección Uno/);
  assert.match(page.text, /youtube\.com\/embed\/dQw4w9WgXcQ/); // video embedded

  // Publishing again keeps the same token (idempotent).
  const pub2 = await request(app).post(`/api/training/courses/${courseId}/publish`).set(H);
  assert.equal(pub2.body.public_token, token);

  await request(app).post(`/api/training/courses/${courseId}/unpublish`).set(H);
  const gone = await request(app).get(`/course/${token}`);
  assert.equal(gone.status, 404);
});

test('publishing requires ownership (another agency cannot publish it)', async () => {
  const other = await request(app).post('/api/auth/register').send({ agency_name: 'Other', name: 'O', email: 'memo@test.com', password: 'secret1' });
  const r = await request(app).post(`/api/training/courses/${courseId}/publish`).set({ Authorization: `Bearer ${other.body.token}` });
  assert.equal(r.status, 404);
});
