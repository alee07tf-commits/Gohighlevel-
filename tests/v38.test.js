// v3.9: Contacts power features — bulk actions, advanced filtered search, and
// per-contact quick actions (send message / enroll in workflow).
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H, ids = [];
async function mkContact(first, extra = {}) {
  const r = await request(app).post('/api/contacts').set(H).send({ first_name: first, email: `${first.toLowerCase()}@t.com`, ...extra });
  return r.body.id;
}

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Bulk', name: 'A', email: 'bulk@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  ids = [await mkContact('Ana', { source: 'web' }), await mkContact('Beto', { source: 'web' }), await mkContact('Cira', { source: 'ads' })];
  // Give the third contact DND.
  await request(app).put(`/api/contacts/${ids[2]}`).set(H).send({ dnd: true });
});

test('bulk tag add/remove affects only the selected owned contacts', async () => {
  const add = await request(app).post('/api/contacts/bulk/tags').set(H).send({ ids, tag: 'vip', op: 'add' });
  assert.equal(add.body.affected, 3);
  const c = await request(app).get(`/api/contacts/${ids[0]}`).set(H);
  assert.ok(c.body.tags.includes('vip'));

  const rem = await request(app).post('/api/contacts/bulk/tags').set(H).send({ ids: [ids[0]], tag: 'vip', op: 'remove' });
  assert.equal(rem.body.affected, 1);
  const c2 = await request(app).get(`/api/contacts/${ids[0]}`).set(H);
  assert.ok(!c2.body.tags.includes('vip'));
});

test('bulk message skips DND contacts', async () => {
  const r = await request(app).post('/api/contacts/bulk/message').set(H).send({ ids, channel: 'sms', body: 'Hola {{first_name}}' });
  assert.equal(r.body.sent, 2);
  assert.equal(r.body.skipped, 1); // the DND contact
});

test('bulk actions never touch contacts outside the location', async () => {
  const del = await request(app).post('/api/contacts/bulk/delete').set(H).send({ ids: [999999] });
  assert.equal(del.body.affected, 0);
});

test('advanced search filters by tag, dnd, source and match mode', async () => {
  await request(app).post('/api/contacts/bulk/tags').set(H).send({ ids: [ids[0], ids[1]], tag: 'lead', op: 'add' });

  const byTag = await request(app).post('/api/contacts/search').set(H).send({ filters: [{ field: 'tag', value: 'lead' }] });
  assert.equal(byTag.body.length, 2);

  const byDnd = await request(app).post('/api/contacts/search').set(H).send({ filters: [{ field: 'dnd', value: true }] });
  assert.equal(byDnd.body.length, 1);

  const bySource = await request(app).post('/api/contacts/search').set(H).send({ filters: [{ field: 'source', value: 'ads' }] });
  assert.equal(bySource.body.length, 1);

  // match 'any': lead tag OR source ads → all three.
  const any = await request(app).post('/api/contacts/search').set(H)
    .send({ match: 'any', filters: [{ field: 'tag', value: 'lead' }, { field: 'source', value: 'ads' }] });
  assert.equal(any.body.length, 3);
});

test('quick actions: send message (respects DND) and enroll validation', async () => {
  const ok = await request(app).post(`/api/contacts/${ids[0]}/message`).set(H).send({ channel: 'email', subject: 'Hi', body: 'Hello' });
  assert.equal(ok.status, 201);

  const dnd = await request(app).post(`/api/contacts/${ids[2]}/message`).set(H).send({ channel: 'sms', body: 'x' });
  assert.equal(dnd.status, 400);

  const badWf = await request(app).post(`/api/contacts/${ids[0]}/workflow`).set(H).send({ workflow_id: 999999 });
  assert.equal(badWf.status, 404);
});
