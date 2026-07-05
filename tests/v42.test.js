// v3.13: Automations parity — new actions (update_field, assign_owner, set_dnd,
// enroll_workflow, notify_user) and triggers (note_added, task_completed).
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H, myId;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Auto', name: 'Op', email: 'auto@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  myId = (await request(app).get('/api/locations/team/users').set(H)).body[0].id;
});

test('new actions run on contact_created', async () => {
  await request(app).post('/api/workflows').set(H).send({
    name: 'Onboard', trigger_type: 'contact_created', active: true,
    actions: [
      { type: 'update_field', config: { field: 'source', value: 'wf-set' } },
      { type: 'assign_owner', config: { user_id: myId } },
      { type: 'set_dnd', config: { scope: 'email', value: '1' } },
      { type: 'add_tag', config: { tag: 'processed' } },
    ],
  });
  const c = await request(app).post('/api/contacts').set(H).send({ first_name: 'Zoe', email: 'zoe@x.com' });
  const got = await request(app).get(`/api/contacts/${c.body.id}`).set(H);
  assert.equal(got.body.source, 'wf-set');
  assert.equal(got.body.owner_user_id, myId);
  assert.equal(got.body.dnd_email, 1);
  assert.ok(got.body.tags.includes('processed'));
});

test('task_completed trigger fires a workflow', async () => {
  await request(app).post('/api/workflows').set(H).send({
    name: 'On task done', trigger_type: 'task_completed', active: true,
    actions: [{ type: 'add_tag', config: { tag: 'task-done' } }],
  });
  const c = await request(app).post('/api/contacts').set(H).send({ first_name: 'Nil', email: 'nil@x.com' });
  const task = await request(app).post('/api/tasks').set(H).send({ title: 'Call', contact_id: c.body.id });
  await request(app).put(`/api/tasks/${task.body.id}`).set(H).send({ status: 'done' });
  const got = await request(app).get(`/api/contacts/${c.body.id}`).set(H);
  assert.ok(got.body.tags.includes('task-done'));
});

test('note_added trigger fires a workflow', async () => {
  await request(app).post('/api/workflows').set(H).send({
    name: 'On note', trigger_type: 'note_added', active: true,
    actions: [{ type: 'add_tag', config: { tag: 'noted' } }],
  });
  const c = await request(app).post('/api/contacts').set(H).send({ first_name: 'Ivy', email: 'ivy@x.com' });
  await request(app).post(`/api/contacts/${c.body.id}/notes`).set(H).send({ body: 'called them' });
  const got = await request(app).get(`/api/contacts/${c.body.id}`).set(H);
  assert.ok(got.body.tags.includes('noted'));
});
