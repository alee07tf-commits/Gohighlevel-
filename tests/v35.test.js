// v3.6: Calendly deep integration. A connected Calendly account's webhooks
// (per-connection tokenized URL, signature-verified) create CRM contacts and
// appointments, and cancellations mark the appointment cancelled.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H, token;
const START = '2026-08-01T10:00:00Z';
const END = '2026-08-01T10:30:00Z';

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Cal', name: 'A', email: 'cal@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  await request(app).post('/api/apps/calendly/manual').set(H).send({ access_token: 'tok' });
  const apps = await request(app).get('/api/apps').set(H);
  token = apps.body.connected.calendly.webhook_token;
  assert.ok(token, 'connection minted a webhook token');
});

test('unknown webhook token is rejected', async () => {
  const res = await request(app).post('/api/public/calendly/nope').send({ event: 'invitee.created', payload: {} });
  assert.equal(res.status, 404);
});

test('invitee.created creates a contact and an appointment', async () => {
  const res = await request(app).post(`/api/public/calendly/${token}`).send({
    event: 'invitee.created',
    payload: {
      email: 'marta@cal.com', name: 'Marta Ríos', text_reminder_number: '+34655',
      scheduled_event: { name: 'Demo 30 min', start_time: START, end_time: END },
    },
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.contact_id);
  assert.ok(res.body.appointment_id, 'appointment created');

  const c = await request(app).get(`/api/contacts/${res.body.contact_id}`).set(H);
  assert.equal(c.body.first_name, 'Marta');
  assert.equal(c.body.source, 'calendly');
  assert.ok(c.body.tags.includes('calendly'));
});

test('invitee.canceled marks the appointment cancelled', async () => {
  const res = await request(app).post(`/api/public/calendly/${token}`).send({
    event: 'invitee.canceled',
    payload: { email: 'marta@cal.com', name: 'Marta Ríos', scheduled_event: { name: 'Demo 30 min', start_time: START, end_time: END } },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.cancelled, true);
});

test('a bad signature is rejected when the signing key is configured', async () => {
  process.env.CALENDLY_WEBHOOK_SIGNING_KEY = 'whsec_test';
  const res = await request(app).post(`/api/public/calendly/${token}`)
    .set('Calendly-Webhook-Signature', 't=123,v1=deadbeef')
    .send({ event: 'invitee.created', payload: { email: 'x@x.com' } });
  assert.equal(res.status, 401);
  delete process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
});
