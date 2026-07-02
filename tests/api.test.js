const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Isolated test database.
process.env.DB_PATH = path.join(__dirname, 'test.db');
for (const f of ['test.db', 'test.db-wal', 'test.db-shm']) {
  try { fs.unlinkSync(path.join(__dirname, f)); } catch {}
}

const request = require('supertest');
const app = require('../server/index');

let token, locationId, headers;

before(async () => {
  const res = await request(app).post('/api/auth/register').send({
    agency_name: 'Test Agency',
    name: 'Tester',
    email: 'tester@test.com',
    password: 'secret1',
    location_name: 'Test Location',
  });
  assert.equal(res.status, 201);
  token = res.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  locationId = me.body.locations[0].id;
  headers = { Authorization: `Bearer ${token}`, 'X-Location-Id': String(locationId) };
});

test('auth: rejects bad login and missing token', async () => {
  const bad = await request(app).post('/api/auth/login').send({ email: 'tester@test.com', password: 'wrong' });
  assert.equal(bad.status, 401);
  const noToken = await request(app).get('/api/contacts').set('X-Location-Id', '1');
  assert.equal(noToken.status, 401);
});

test('auth: login works', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'tester@test.com', password: 'secret1' });
  assert.equal(res.status, 200);
  assert.ok(res.body.token);
});

test('locations: create and list', async () => {
  const res = await request(app).post('/api/locations').set(headers).send({ name: 'Second Location' });
  assert.equal(res.status, 201);
  const list = await request(app).get('/api/locations').set(headers);
  assert.equal(list.body.length, 2);
});

test('tenant isolation: another agency cannot access my location', async () => {
  const other = await request(app).post('/api/auth/register').send({
    agency_name: 'Other Agency', name: 'Other', email: 'other@test.com', password: 'secret1',
  });
  const res = await request(app)
    .get('/api/contacts')
    .set({ Authorization: `Bearer ${other.body.token}`, 'X-Location-Id': String(locationId) });
  assert.equal(res.status, 404);
});

test('contacts: full CRUD + tags + notes', async () => {
  const created = await request(app).post('/api/contacts').set(headers).send({
    first_name: 'Alice', last_name: 'Doe', email: 'alice@test.com', phone: '+1555', tags: ['vip'],
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.tags, ['vip']);
  const id = created.body.id;

  const tagged = await request(app).post(`/api/contacts/${id}/tags`).set(headers).send({ tag: 'hot' });
  assert.ok(tagged.body.tags.includes('hot'));

  await request(app).post(`/api/contacts/${id}/notes`).set(headers).send({ body: 'Called her today' });
  const detail = await request(app).get(`/api/contacts/${id}`).set(headers);
  assert.equal(detail.body.notes.length, 1);
  assert.ok(detail.body.activities.length >= 1);

  const search = await request(app).get('/api/contacts?q=alice').set(headers);
  assert.equal(search.body.length, 1);

  const updated = await request(app).put(`/api/contacts/${id}`).set(headers).send({ first_name: 'Alicia' });
  assert.equal(updated.body.first_name, 'Alicia');

  const del = await request(app).delete(`/api/contacts/${id}`).set(headers);
  assert.equal(del.status, 200);
  const gone = await request(app).get(`/api/contacts/${id}`).set(headers);
  assert.equal(gone.status, 404);
});

test('pipelines: stages, opportunities, kanban move fires trigger', async () => {
  // Workflow that reacts to stage change.
  const wf = await request(app).post('/api/workflows').set(headers).send({
    name: 'Stage change tagger',
    trigger_type: 'opportunity_stage_changed',
    actions: [{ type: 'add_tag', config: { tag: 'moved' } }],
  });
  assert.equal(wf.status, 201);

  const contact = await request(app).post('/api/contacts').set(headers).send({ first_name: 'Bob', email: 'bob@test.com' });
  const pipe = await request(app).post('/api/pipelines').set(headers).send({ name: 'Sales', stages: ['A', 'B'] });
  assert.equal(pipe.status, 201);
  assert.equal(pipe.body.stages.length, 2);

  const opp = await request(app)
    .post(`/api/pipelines/${pipe.body.id}/opportunities`)
    .set(headers)
    .send({ title: 'Big deal', value: 1000, contact_id: contact.body.id });
  assert.equal(opp.status, 201);
  assert.equal(opp.body.stage_id, pipe.body.stages[0].id);

  const moved = await request(app)
    .put(`/api/pipelines/opportunities/${opp.body.id}`)
    .set(headers)
    .send({ stage_id: pipe.body.stages[1].id });
  assert.equal(moved.body.stage_id, pipe.body.stages[1].id);

  const c = await request(app).get(`/api/contacts/${contact.body.id}`).set(headers);
  assert.ok(c.body.tags.includes('moved'), 'stage-change workflow should add tag');
});

test('workflows: contact_created runs actions in order', async () => {
  const wf = await request(app).post('/api/workflows').set(headers).send({
    name: 'Welcome flow',
    trigger_type: 'contact_created',
    actions: [
      { type: 'add_tag', config: { tag: 'nurture' } },
      { type: 'send_email', config: { subject: 'Hi {{first_name}}', body: 'Welcome {{first_name}}!' } },
      { type: 'send_sms', config: { body: 'Hey {{first_name}}' } },
    ],
  });
  assert.equal(wf.status, 201);

  const contact = await request(app).post('/api/contacts').set(headers).send({ first_name: 'Carol', email: 'carol@test.com' });
  const detail = await request(app).get(`/api/contacts/${contact.body.id}`).set(headers);
  assert.ok(detail.body.tags.includes('nurture'));

  const runs = await request(app).get(`/api/workflows/${wf.body.id}/runs`).set(headers);
  assert.ok(runs.body.length >= 1);
  assert.equal(runs.body[0].status, 'success');

  // Email + SMS should be in the unified inbox with merged fields.
  const convs = await request(app).get('/api/conversations').set(headers);
  const conv = convs.body.find((c) => c.contact_id === contact.body.id);
  assert.ok(conv, 'conversation created by workflow sends');
  const msgs = await request(app).get(`/api/conversations/${conv.id}/messages`).set(headers);
  assert.equal(msgs.body.length, 2);
  assert.equal(msgs.body[0].subject, 'Hi Carol');
});

test('conversations: send and simulate inbound', async () => {
  const contact = await request(app).post('/api/contacts').set(headers).send({ first_name: 'Dave', email: 'dave@test.com' });
  const conv = await request(app).post(`/api/conversations/start/${contact.body.id}`).set(headers);
  assert.ok(conv.body.id);

  const sent = await request(app)
    .post(`/api/conversations/${conv.body.id}/messages`)
    .set(headers)
    .send({ channel: 'sms', body: 'Hello Dave' });
  assert.equal(sent.status, 201);

  const inbound = await request(app)
    .post(`/api/conversations/${conv.body.id}/simulate-inbound`)
    .set(headers)
    .send({ body: 'Hi back!' });
  assert.equal(inbound.status, 201);

  const list = await request(app).get('/api/conversations').set(headers);
  const mine = list.body.find((c) => c.id === conv.body.id);
  assert.equal(mine.unread, 1);
  assert.equal(mine.last_body, 'Hi back!');
});

test('marketing: campaign sends to tag segment with merge fields', async () => {
  await request(app).post('/api/contacts').set(headers).send({ first_name: 'Eve', email: 'eve@test.com', tags: ['promo'] });
  await request(app).post('/api/contacts').set(headers).send({ first_name: 'Frank', email: 'frank@test.com' });

  const camp = await request(app).post('/api/marketing/campaigns').set(headers).send({
    name: 'Promo blast', channel: 'email', subject: 'Deal for {{first_name}}', body: 'Hi {{first_name}}', tag_filter: 'promo',
  });
  const sent = await request(app).post(`/api/marketing/campaigns/${camp.body.id}/send`).set(headers);
  assert.equal(sent.status, 200);
  assert.equal(sent.body.status, 'sent');
  assert.equal(sent.body.recipient_count, 1, 'only tagged contact should receive');

  const again = await request(app).post(`/api/marketing/campaigns/${camp.body.id}/send`).set(headers);
  assert.equal(again.status, 400, 'cannot send twice');
});

test('funnels: page render + public form submission creates contact and fires workflow', async () => {
  await request(app).post('/api/workflows').set(headers).send({
    name: 'Form follow-up',
    trigger_type: 'form_submitted',
    actions: [{ type: 'add_tag', config: { tag: 'from-funnel' } }],
  });

  const funnel = await request(app).post('/api/funnels').set(headers).send({ name: 'Launch Offer' });
  assert.equal(funnel.status, 201);
  assert.equal(funnel.body.pages.length, 1);
  const page = funnel.body.pages[0];

  const rendered = await request(app).get(`/f/${funnel.body.slug}/home`);
  assert.equal(rendered.status, 200);
  assert.match(rendered.text, /Launch Offer/);

  const submit = await request(app)
    .post(`/api/public/pages/${page.id}/submit`)
    .send({ first_name: 'Grace', email: 'grace@test.com', phone: '+1999' });
  assert.equal(submit.status, 201);

  const contacts = await request(app).get('/api/contacts?q=grace').set(headers);
  assert.equal(contacts.body.length, 1);
  assert.ok(contacts.body[0].tags.includes('from-funnel'));
  assert.match(contacts.body[0].source, /^funnel:/);

  // Duplicate submit should NOT create a second contact.
  await request(app).post(`/api/public/pages/${page.id}/submit`).send({ first_name: 'Grace', email: 'grace@test.com' });
  const after = await request(app).get('/api/contacts?q=grace').set(headers);
  assert.equal(after.body.length, 1);

  const subs = await request(app).get(`/api/funnels/${funnel.body.id}/submissions`).set(headers);
  assert.equal(subs.body.length, 2);
});

test('calendars: public booking creates contact + appointment, rejects double-booking', async () => {
  const cal = await request(app).post('/api/calendars').set(headers).send({ name: 'Demo Call', duration_minutes: 30 });
  assert.equal(cal.status, 201);

  const widget = await request(app).get(`/book/${cal.body.slug}`);
  assert.equal(widget.status, 200);
  assert.match(widget.text, /Demo Call/);

  const booking = await request(app).post(`/api/public/book/${cal.body.slug}`).send({
    name: 'Henry Ford', email: 'henry@test.com', date: '2030-01-15', time: '10:00',
  });
  assert.equal(booking.status, 201);

  const clash = await request(app).post(`/api/public/book/${cal.body.slug}`).send({
    name: 'Ivy Lee', email: 'ivy@test.com', date: '2030-01-15', time: '10:00',
  });
  assert.equal(clash.status, 409);

  const appts = await request(app).get('/api/calendars/appointments/all').set(headers);
  const mine = appts.body.find((a) => a.email === 'henry@test.com');
  assert.ok(mine, 'appointment linked to auto-created contact');
});

test('dashboard: returns aggregate stats', async () => {
  const res = await request(app).get('/api/dashboard').set(headers);
  assert.equal(res.status, 200);
  assert.ok(res.body.stats.contacts > 0);
  assert.ok(Array.isArray(res.body.recentActivity));
});
