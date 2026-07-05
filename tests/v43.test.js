// v3.14: Calendar parity — minimum notice, blocked dates, and buffer enforced
// on the public booking widget.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H, slug;
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Cal2', name: 'A', email: 'cal2@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  const cal = await request(app).post('/api/calendars').set(H).send({
    name: 'Consulta', duration_minutes: 30, start_hour: 9, end_hour: 17,
    days: [0, 1, 2, 3, 4, 5, 6], buffer_minutes: 30, min_notice_hours: 24, blocked_dates: [ymd(3)],
  });
  slug = cal.body.slug;
  assert.equal(cal.body.buffer_minutes, 30);
  assert.equal(cal.body.min_notice_hours, 24);
});

test('booking within the minimum notice window is rejected', async () => {
  // 1h from now, but min notice is 24h.
  const soon = new Date(Date.now() + 3600000);
  const res = await request(app).post(`/api/public/book/${slug}`).send({
    name: 'Ana', email: 'ana@x.com', date: soon.toISOString().slice(0, 10), time: '10:00',
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /at least/i);
});

test('booking on a blocked date is rejected', async () => {
  const res = await request(app).post(`/api/public/book/${slug}`).send({
    name: 'Ana', email: 'ana@x.com', date: ymd(3), time: '11:00',
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /not available/i);
});

test('buffer blocks a booking too close to an existing appointment', async () => {
  const day = ymd(5); // far enough for min notice, not blocked
  const first = await request(app).post(`/api/public/book/${slug}`).send({ name: 'Uno', email: 'uno@x.com', date: day, time: '10:00' });
  assert.equal(first.status, 201);
  // 10:30 would be back-to-back; with a 30-min buffer it must be rejected.
  const tooClose = await request(app).post(`/api/public/book/${slug}`).send({ name: 'Dos', email: 'dos@x.com', date: day, time: '10:30' });
  assert.equal(tooClose.status, 409);
  // 11:30 is outside the buffer window → allowed.
  const ok = await request(app).post(`/api/public/book/${slug}`).send({ name: 'Tres', email: 'tres@x.com', date: day, time: '11:30' });
  assert.equal(ok.status, 201);
});
