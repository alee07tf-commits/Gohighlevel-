// v2.1 (Phase 4): recursive tenancy — a root agency (Upcross) creates client
// agencies, drills into them via X-Agency-Id, and each client manages its own
// sub-accounts, team and integrations, scoped to its subtree. Plus the
// recursive training module (courses visible down the tree, YouTube embeds).
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let rootTok, rootAgency, clientTok, clientAgency, courseId;
const H = (tok, agencyId, locId) => {
  const h = { Authorization: `Bearer ${tok}` };
  if (agencyId) h['X-Agency-Id'] = String(agencyId);
  if (locId) h['X-Location-Id'] = String(locId);
  return h;
};

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Upcross', name: 'Owner', email: 'owner@upcross.io', password: 'secret1', location_name: 'Upcross HQ',
  });
  rootTok = r.body.token;
  rootAgency = r.body.user.agency_id;
});

test('clients: root creates a client agency with its admin + first sub-account', async () => {
  const r = await request(app).post('/api/clients').set(H(rootTok)).send({
    agency_name: 'Cliente Dental', admin_name: 'Dra. Ruiz', admin_email: 'dra@dental.io', admin_password: 'secret1',
    location_name: 'Clínica Centro',
  });
  assert.equal(r.status, 201);
  assert.ok(r.body.first_location_id, 'first sub-account provisioned');
  clientAgency = r.body.id;

  const list = await request(app).get('/api/clients').set(H(rootTok));
  const row = list.body.find((c) => c.id === clientAgency);
  assert.ok(row, 'client listed under root');
  assert.equal(row.subaccounts, 1);
  assert.equal(row.admin.email, 'dra@dental.io');
});

test('clients: admin role required to create a client', async () => {
  // A member of the root agency cannot create clients.
  await request(app).post('/api/locations').set(H(rootTok, rootAgency)); // no-op guard
  const memberEmail = 'member@upcross.io';
  await request(app).post('/api/locations/team/users').set(H(rootTok)).send({
    name: 'Miembro', email: memberEmail, password: 'secret1', role: 'member',
  });
  const login = await request(app).post('/api/auth/login').send({ email: memberEmail, password: 'secret1' });
  const r = await request(app).post('/api/clients').set(H(login.body.token)).send({
    agency_name: 'X', admin_email: 'x@x.io', admin_password: 'secret1',
  });
  assert.equal(r.status, 403);
});

test('tenancy: the client is scoped to its own agency and cannot reach the root', async () => {
  const login = await request(app).post('/api/auth/login').send({ email: 'dra@dental.io', password: 'secret1' });
  clientTok = login.body.token;
  assert.equal(login.body.user.agency_id, clientAgency, 'client user homed at its own agency');

  const me = await request(app).get('/api/auth/me').set(H(clientTok));
  assert.equal(me.body.agency.id, clientAgency);
  assert.equal(me.body.locations.length, 1, 'sees only its own sub-account');
  assert.equal(me.body.clientCount, 0);

  // Trying to act as the root (its parent) is forbidden.
  const forbidden = await request(app).get('/api/auth/me').set(H(clientTok, rootAgency));
  assert.equal(forbidden.status, 403);
});

test('tenancy: the client manages its own sub-accounts and team, isolated from siblings', async () => {
  // Create a sibling client to prove isolation.
  const sib = await request(app).post('/api/clients').set(H(rootTok)).send({
    agency_name: 'Cliente Gym', admin_email: 'gym@fit.io', admin_password: 'secret1', snapshot_id: 0,
  });
  const sibAgency = sib.body.id;

  // Client adds a second sub-account of its own.
  const clientMe = await request(app).get('/api/auth/me').set(H(clientTok));
  const clientLoc = clientMe.body.locations[0].id;
  const add = await request(app).post('/api/locations').set(H(clientTok, null, clientLoc)).send({ name: 'Clínica Norte', snapshot_id: 0 });
  assert.equal(add.status, 201);
  const locs = await request(app).get('/api/locations').set(H(clientTok));
  assert.equal(locs.body.length, 2, 'client now has two sub-accounts');

  // The client cannot drill into a sibling client.
  const cross = await request(app).get('/api/locations').set(H(clientTok, sibAgency));
  assert.equal(cross.status, 403);

  // Client invites its own team member.
  const invite = await request(app).post('/api/locations/team/users').set(H(clientTok)).send({
    name: 'Recepción', email: 'recepcion@dental.io', password: 'secret1', role: 'member',
  });
  assert.equal(invite.status, 201);
});

test('tenancy: root can drill into the client and operate its account', async () => {
  const me = await request(app).get('/api/auth/me').set(H(rootTok, clientAgency));
  assert.equal(me.body.agency.id, clientAgency);
  assert.equal(me.body.actingAsChild, true);
  assert.equal(me.body.parentAgency.id, rootAgency);
  // Root, acting inside the client, sees the client's sub-accounts.
  const locs = await request(app).get('/api/locations').set(H(rootTok, clientAgency));
  assert.ok(locs.body.some((l) => l.name === 'Clínica Centro'));
});

test('training: root authors a course; the client sees it (recursive visibility)', async () => {
  const c = await request(app).post('/api/training/courses').set(H(rootTok)).send({
    title: 'Cómo usar la plataforma', description: 'Onboarding',
  });
  assert.equal(c.status, 201);
  courseId = c.body.id;
  const lesson = await request(app).post(`/api/training/courses/${courseId}/lessons`).set(H(rootTok)).send({
    title: 'Bienvenida', body: 'Intro', youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  });
  assert.equal(lesson.status, 201);
  assert.equal(lesson.body.youtube_id, 'dQw4w9WgXcQ', 'YouTube id parsed from URL');

  // Client sees it as available (not owned) and can consume it.
  const list = await request(app).get('/api/training/courses').set(H(clientTok));
  const avail = list.body.available.find((x) => x.id === courseId);
  assert.ok(avail, 'course visible to the client below');
  assert.equal(avail.owned, false);
  assert.equal(list.body.authored.length, 0, 'client did not author it');

  // Client marks the lesson complete → progress tracked per user.
  const done = await request(app).post(`/api/training/lessons/${lesson.body.id}/complete`).set(H(clientTok));
  assert.equal(done.status, 200);
  const detail = await request(app).get(`/api/training/courses/${courseId}`).set(H(clientTok));
  assert.equal(detail.body.lessons[0].completed, true);
});

test('training: a client cannot edit a course it does not own', async () => {
  const r = await request(app).put(`/api/training/courses/${courseId}`).set(H(clientTok)).send({ title: 'Hack' });
  assert.equal(r.status, 404, 'not owned → not found/editable');

  // But the client can author its OWN course for its clients.
  const own = await request(app).post('/api/training/courses').set(H(clientTok)).send({ title: 'Formación interna' });
  assert.equal(own.status, 201);
  const list = await request(app).get('/api/training/courses').set(H(clientTok));
  assert.ok(list.body.authored.some((x) => x.id === own.body.id), 'client owns its course');
});
