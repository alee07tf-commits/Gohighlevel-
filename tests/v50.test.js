// v3.21: Training parity — lessons can belong to a module/section.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H, courseId;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Edu', name: 'A', email: 'edu@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  const c = await request(app).post('/api/training/courses').set(H).send({ title: 'Onboarding' });
  courseId = c.body.id;
});

test('lessons carry a module/section and it can be edited', async () => {
  const l = await request(app).post(`/api/training/courses/${courseId}/lessons`).set(H)
    .send({ title: 'Bienvenida', section: 'Introducción', youtube_url: 'https://youtu.be/abc123' });
  assert.equal(l.status, 201);
  assert.equal(l.body.section, 'Introducción');

  const upd = await request(app).put(`/api/training/lessons/${l.body.id}`).set(H).send({ section: 'Módulo 1' });
  assert.equal(upd.body.section, 'Módulo 1');

  const course = await request(app).get(`/api/training/courses/${courseId}`).set(H);
  const lesson = course.body.lessons.find((x) => x.id === l.body.id);
  assert.equal(lesson.section, 'Módulo 1');
});
