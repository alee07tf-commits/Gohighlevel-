// v58: Surveys — multi-question surveys with conditional logic, a public fill
// page, response capture, and lead capture from mapped email/phone answers.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let H, survey;

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Surv', name: 'A', email: 'surv@test.com', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  H = { Authorization: `Bearer ${r.body.token}`, 'X-Location-Id': String(me.body.locations[0].id) };
});

test('creates a survey with questions and a slug', async () => {
  const res = await request(app).post('/api/surveys').set(H).send({
    name: 'Satisfacción', tag: 'encuesta',
    questions: [
      { id: 'q1', label: '¿Recomendarías el servicio?', type: 'yesno', required: true },
      { id: 'q2', label: '¿Por qué no?', type: 'textarea', condition: { q: 'q1', equals: 'No' } },
      { id: 'q3', label: 'Tu email', type: 'email', map: 'email' },
    ],
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.slug);
  survey = res.body;
});

test('the public fill page renders the questions', async () => {
  const res = await request(app).get(`/s/${survey.slug}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /Recomendar/);
  assert.match(res.text, /condition/); // conditional-logic engine present
});

test('a submission stores a response and captures the lead', async () => {
  const res = await request(app).post(`/s/${survey.slug}`).send({
    answers: { '¿Recomendarías el servicio?': 'Sí', 'Tu email': 'nuevo@lead.com', __email: 'nuevo@lead.com' },
  });
  assert.equal(res.status, 200);
  // Response recorded.
  const detail = await request(app).get(`/api/surveys/${survey.id}`).set(H);
  assert.equal(detail.body.responses.length, 1);
  // Lead captured into the CRM with the survey tag.
  const contacts = await request(app).post('/api/contacts/search').set(H).send({ query: 'nuevo@lead.com' }).catch(() => null);
  const list = await request(app).get('/api/contacts').set(H);
  const arr = Array.isArray(list.body) ? list.body : (list.body.contacts || list.body.items || []);
  assert.ok(arr.some((c) => c.email === 'nuevo@lead.com'), 'lead captured from mapped email');
});

test('deleting a survey removes it', async () => {
  const del = await request(app).delete(`/api/surveys/${survey.id}`).set(H);
  assert.equal(del.status, 200);
  const list = await request(app).get('/api/surveys').set(H);
  assert.ok(!list.body.some((s) => s.id === survey.id));
});
