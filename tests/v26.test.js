// v2.6: attribution / ROI analytics. Groups contacts, appointments and won
// revenue by lead source without double-counting across the two joins.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let H;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Attr', name: 'A', email: 'attr@test.com', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  H = { Authorization: `Bearer ${r.body.token}`, 'X-Location-Id': String(me.body.locations[0].id) };
});

test('attribution rolls up contacts, appointments and won revenue by source', async () => {
  // Two funnel leads + one manual.
  const c1 = await request(app).post('/api/contacts').set(H).send({ first_name: 'L1', email: 'l1@t.com', source: 'funnel:promo' });
  await request(app).post('/api/contacts').set(H).send({ first_name: 'L2', email: 'l2@t.com', source: 'funnel:promo' });
  await request(app).post('/api/contacts').set(H).send({ first_name: 'M1', email: 'm1@t.com', source: 'manual' });

  // An appointment for the first funnel lead.
  const cal = await request(app).post('/api/calendars').set(H).send({ name: 'Citas' });
  await request(app).post(`/api/calendars/${cal.body.id}/appointments`).set(H)
    .send({ title: 'Consulta', starts_at: '2030-02-01T10:00', contact_id: c1.body.id });

  // A won opportunity worth 500 for the first funnel lead.
  const pipe = await request(app).post('/api/pipelines').set(H).send({ name: 'Ventas' });
  const opp = await request(app).post(`/api/pipelines/${pipe.body.id}/opportunities`).set(H)
    .send({ title: 'Deal', value: 500, contact_id: c1.body.id });
  await request(app).put(`/api/pipelines/opportunities/${opp.body.id}`).set(H).send({ status: 'won' });

  const r = await request(app).get('/api/analytics/attribution?days=3650').set(H);
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.contacts, 3);
  assert.equal(r.body.totals.appointments, 1);
  assert.equal(r.body.totals.won, 1);
  assert.equal(r.body.totals.won_value, 500);

  const funnel = r.body.rows.find((x) => x.source === 'funnel:promo');
  assert.ok(funnel, 'funnel source row present');
  assert.equal(funnel.contacts, 2);
  assert.equal(funnel.appointments, 1);
  assert.equal(funnel.won, 1);
  assert.equal(funnel.won_value, 500); // not doubled by the appointment join
  assert.equal(funnel.booking_rate, 50); // 1 appt / 2 contacts
});
