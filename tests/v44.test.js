// v3.15: Marketing parity — email open tracking, one-click unsubscribe, DND
// respect, and campaign stats.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');
const db = require('../server/db');

let jwt, loc, H, campId, keepId;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Mkt', name: 'A', email: 'mkt@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  const keep = await request(app).post('/api/contacts').set(H).send({ first_name: 'Ana', email: 'ana@x.com' });
  keepId = keep.body.id;
  const skip = await request(app).post('/api/contacts').set(H).send({ first_name: 'Beto', email: 'beto@x.com' });
  await request(app).put(`/api/contacts/${skip.body.id}`).set(H).send({ dnd_email: true });
  const camp = await request(app).post('/api/marketing/campaigns').set(H).send({ name: 'News', channel: 'email', subject: 'Hi', body: 'Hello' });
  campId = camp.body.id;
  await request(app).post(`/api/marketing/campaigns/${campId}/send`).set(H);
});

test('campaign skips DND-email contacts and tokenizes recipients', async () => {
  const recs = await db.all('SELECT * FROM campaign_recipients WHERE campaign_id = ?', [campId]);
  assert.equal(recs.length, 1); // Beto (dnd_email) was skipped
  assert.equal(recs[0].contact_id, keepId);
  assert.ok(recs[0].token && recs[0].token.length >= 20);
});

test('open pixel marks the recipient opened and shows in stats', async () => {
  const rec = await db.get('SELECT token FROM campaign_recipients WHERE campaign_id = ?', [campId]);
  const px = await request(app).get(`/api/public/e/o/${rec.token}`);
  assert.equal(px.status, 200);
  assert.match(px.headers['content-type'], /image\/gif/);

  const camps = await request(app).get('/api/marketing/campaigns').set(H);
  const c = camps.body.find((x) => x.id === campId);
  assert.equal(c.recipient_count, 1);
  assert.equal(c.opened_count, 1);
});

test('unsubscribe sets email DND on the contact', async () => {
  const rec = await db.get('SELECT token FROM campaign_recipients WHERE campaign_id = ?', [campId]);
  const u = await request(app).get(`/api/public/unsub/${rec.token}`);
  assert.equal(u.status, 200);
  const c = await request(app).get(`/api/contacts/${keepId}`).set(H);
  assert.equal(c.body.dnd_email, 1);
});
