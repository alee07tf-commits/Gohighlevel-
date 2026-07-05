// v3.8: outbound app sync. On a CRM event, connected push-apps (Google Calendar,
// Zoom, HubSpot) are called with their stored token. The HTTP layer is mocked
// here (no live keys); the builders and dispatch selection are verified for real.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');
const appsync = require('../server/services/appsync');

let jwt, loc, H;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Sync', name: 'A', email: 'sync@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
});

test('request builders map CRM data to provider payloads', () => {
  const g = appsync.googleEventBody({ title: 'Demo', start_time: '2026-08-01T10:00:00Z', end_time: '2026-08-01T10:30:00Z' },
    { first_name: 'Ana', last_name: 'Ruiz', email: 'ana@x.com' });
  assert.equal(g.summary, 'Demo');
  assert.equal(g.start.dateTime, '2026-08-01T10:00:00Z');
  assert.deepEqual(g.attendees, [{ email: 'ana@x.com' }]);

  const z = appsync.zoomMeetingBody({ title: 'Demo', start_time: '2026-08-01T10:00:00Z' });
  assert.equal(z.type, 2);
  assert.equal(z.topic, 'Demo');

  const h = appsync.hubspotContactBody({ email: 'ana@x.com', first_name: 'Ana', phone: '+34' });
  assert.equal(h.properties.email, 'ana@x.com');
  assert.equal(h.properties.firstname, 'Ana');
});

test('dispatch calls every connected handler for the event', async () => {
  // Connect Google + Zoom for this sub-account (tokens stored encrypted).
  await request(app).post('/api/apps/google/manual').set(H).send({ access_token: 'g_tok' });
  await request(app).post('/api/apps/zoom/manual').set(H).send({ access_token: 'z_tok' });

  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url, auth: opts.headers.Authorization }); return { ok: true, status: 200 }; };
  try {
    const res = await appsync.dispatch(loc, 'appointment_booked',
      { first_name: 'Ana', email: 'ana@x.com' },
      { title: 'Demo', start_time: '2026-08-01T10:00:00Z', end_time: '2026-08-01T10:30:00Z' });
    assert.equal(res.length, 2);
    const urls = calls.map((c) => c.url);
    assert.ok(urls.some((u) => u.includes('googleapis.com/calendar')), 'Google Calendar called');
    assert.ok(urls.some((u) => u.includes('api.zoom.us')), 'Zoom called');
    // Token from the stored connection is used.
    assert.ok(calls.some((c) => c.auth === 'Bearer g_tok'));
  } finally {
    global.fetch = orig;
  }
});

test('dispatch is a no-op for events with no connected handler', async () => {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url) => { calls.push(url); return { ok: true, status: 200 }; };
  try {
    // No HubSpot connected → contact_created reaches no handler here.
    const res = await appsync.dispatch(loc, 'contact_created', { email: 'x@x.com' }, {});
    assert.equal(res.length, 0);
    assert.equal(calls.length, 0);
  } finally {
    global.fetch = orig;
  }
});
