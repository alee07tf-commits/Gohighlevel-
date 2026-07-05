// v2.7: standalone forms (public capture into the CRM) and round-robin booking
// (distribute appointments across a calendar's team members).
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let H, agencyTok, u1, u2;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'FR', name: 'Admin', email: 'fr@test.com', password: 'secret1', location_name: 'Sede',
  });
  agencyTok = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${agencyTok}`);
  H = { Authorization: `Bearer ${agencyTok}`, 'X-Location-Id': String(me.body.locations[0].id) };
  const a = await request(app).post('/api/locations/team/users').set(H).send({ name: 'Ana', email: 'ana@fr.com', password: 'secret1', role: 'member' });
  const b = await request(app).post('/api/locations/team/users').set(H).send({ name: 'Beto', email: 'beto@fr.com', password: 'secret1', role: 'member' });
  u1 = a.body.id; u2 = b.body.id;
});

test('standalone form captures a lead into the CRM and records the submission', async () => {
  const form = await request(app).post('/api/forms').set(H).send({ name: 'Contacto', fields: ['first_name', 'email', 'phone'], tag: 'web-lead' });
  assert.equal(form.status, 201);
  const slug = form.body.slug;

  const pub = await request(app).post(`/api/public/form/${slug}/submit`).send({ first_name: 'Nora', email: 'nora@lead.com', phone: '+34600' });
  assert.equal(pub.status, 201);

  // Contact created with the form source + tag.
  const contacts = await request(app).get('/api/contacts?q=nora@lead.com').set(H);
  const c = contacts.body.find((x) => x.email === 'nora@lead.com');
  assert.ok(c, 'contact created from the form');
  assert.equal(c.source, `form:${slug}`);

  // Submission shows under the form.
  const subs = await request(app).get(`/api/forms/${form.body.id}/submissions`).set(H);
  assert.equal(subs.body.length, 1);
  assert.equal(subs.body[0].email, 'nora@lead.com');
});

test('round-robin booking rotates appointments across assignees', async () => {
  const cal = await request(app).post('/api/calendars').set(H).send({ name: 'Consulta', assignees: [u1, u2] });
  const slug = cal.body.slug;
  assert.deepEqual(JSON.parse(cal.body.assignees), [u1, u2]);

  await request(app).post(`/api/public/book/${slug}`).send({ name: 'Cli Uno', email: 'c1@rr.com', date: '2031-03-01', time: '10:00' });
  await request(app).post(`/api/public/book/${slug}`).send({ name: 'Cli Dos', email: 'c2@rr.com', date: '2031-03-01', time: '11:00' });

  const appts = await request(app).get('/api/calendars/appointments/all').set(H);
  const mine = appts.body.filter((a) => a.calendar_id === cal.body.id).sort((x, y) => x.id - y.id);
  assert.equal(mine.length, 2);
  assert.equal(mine[0].assigned_user_id, u1, 'first booking → first assignee');
  assert.equal(mine[1].assigned_user_id, u2, 'second booking → second assignee (rotated)');
});

test('calendar rejects assignees from outside the agency', async () => {
  // Another agency's user id must not stick.
  const other = await request(app).post('/api/auth/register').send({ agency_name: 'Other', name: 'O', email: 'o@rr.com', password: 'secret1' });
  const otherMe = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${other.body.token}`);
  const foreignUserId = otherMe.body.user.id;
  const cal = await request(app).post('/api/calendars').set(H).send({ name: 'X', assignees: [foreignUserId] });
  assert.deepEqual(JSON.parse(cal.body.assignees), [], 'foreign user filtered out');
});
