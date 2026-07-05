// v54: In-app notification center (bell). Notifications are created on key
// events (task assigned, owner assigned, new lead) and scoped to the user.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let adminH, adminId, memberId, loc;

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Notif', name: 'Admin', email: 'notif@test.com', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  adminId = me.body.user.id;
  loc = me.body.locations[0].id;
  adminH = { Authorization: `Bearer ${r.body.token}`, 'X-Location-Id': String(loc) };
  // A second team member who will receive assignments.
  const member = await request(app).post('/api/locations/team/users').set(adminH).send({
    name: 'Miembro', email: 'miembro@notif.com', password: 'secret1', role: 'member',
  });
  memberId = member.body.id;
});

test('starts with no notifications', async () => {
  const res = await request(app).get('/api/notifications').set(adminH);
  assert.equal(res.status, 200);
  assert.equal(res.body.unread, 0);
  assert.deepEqual(res.body.notifications, []);
});

test('assigning a task to a member notifies them', async () => {
  await request(app).post('/api/tasks').set(adminH).send({ title: 'Llamar al lead', user_id: memberId });
  // Log in as the member and check their bell.
  const login = await request(app).post('/api/auth/login').send({ email: 'miembro@notif.com', password: 'secret1' });
  const memberH = { Authorization: `Bearer ${login.body.token}` };
  const res = await request(app).get('/api/notifications').set(memberH);
  assert.equal(res.body.unread, 1);
  assert.equal(res.body.notifications[0].type, 'task');
  assert.match(res.body.notifications[0].title, /tarea/i);
});

test('a public form submission notifies the team', async () => {
  const form = await request(app).post('/api/forms').set(adminH).send({ name: 'Contacto', fields: ['first_name', 'email'] });
  await request(app).post(`/form/${form.body.slug}/submit`).send({ first_name: 'Lucía', email: 'lucia@x.com' });
  const res = await request(app).get('/api/notifications').set(adminH);
  assert.ok(res.body.notifications.some((n) => n.type === 'lead'), 'lead notification created for the team');
});

test('mark-all-read clears the unread count', async () => {
  await request(app).post('/api/notifications/read-all').set(adminH);
  const res = await request(app).get('/api/notifications/unread-count').set(adminH);
  assert.equal(res.body.unread, 0);
});
