// v1.6: Conversation AI (scripted fallback), chat widget API, trigger links,
// smart lists, duplicate merge.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
delete process.env.ANTHROPIC_API_KEY;

const request = require('supertest');
const app = require('../server/index');

let headers, locationId;

before(async () => {
  const res = await request(app).post('/api/auth/register').send({
    agency_name: 'V16', name: 'T', email: 'v16@test.com', password: 'secret1', location_name: 'Clinica AI',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
  locationId = me.body.locations[0].id;
  headers = { Authorization: `Bearer ${res.body.token}`, 'X-Location-Id': String(locationId) };
  // Enable the AI agent + create a calendar it can book into.
  await request(app).put(`/api/locations/${locationId}`).set(headers).send({
    ai_agent_enabled: true,
    ai_agent_prompt: 'Somos una clínica dental.',
  });
  await request(app).post('/api/calendars').set(headers).send({ name: 'Consulta AI', duration_minutes: 30 });
});

let chatToken;

test('chat widget: config + start creates contact and conversation', async () => {
  const cfg = await request(app).get(`/api/public/chat/${locationId}/config`);
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.ai, true);

  const start = await request(app).post(`/api/public/chat/${locationId}/start`).send({
    name: 'Visitante Web', phone: '+34600111222',
  });
  assert.equal(start.status, 200);
  assert.ok(start.body.token);
  chatToken = start.body.token;

  const contacts = await request(app).get('/api/contacts?q=visitante').set(headers);
  assert.equal(contacts.body.length, 1);
  assert.equal(contacts.body[0].source, 'chat-widget');
});

test('conversation AI (scripted): offers real slots and books on confirmation', async () => {
  const ask = await request(app).post('/api/public/chat/message').send({
    token: chatToken, body: 'Hola, quiero reservar una cita',
  });
  assert.equal(ask.status, 200);
  assert.ok(ask.body.reply, 'AI replied');
  assert.match(ask.body.reply, /1\./, 'offers numbered slots');

  const confirm = await request(app).post('/api/public/chat/message').send({ token: chatToken, body: '1' });
  assert.match(confirm.body.reply, /confirmada/i, 'booking confirmed');

  const appts = await request(app).get('/api/calendars/appointments/all').set(headers);
  assert.equal(appts.body.length, 1);
  assert.match(appts.body[0].title, /agendado por IA/);

  // Whole thread visible in the unified inbox.
  const convs = await request(app).get('/api/conversations').set(headers);
  assert.equal(convs.body.length, 1);
  const msgs = await request(app).get(`/api/conversations/${convs.body[0].id}/messages`).set(headers);
  assert.ok(msgs.body.filter((m) => m.channel === 'chat').length >= 4);
});

test('human takeover: pausing AI stops auto-replies', async () => {
  const convs = await request(app).get('/api/conversations').set(headers);
  const conv = convs.body[0];
  await request(app).put(`/api/conversations/${conv.id}/ai`).set(headers).send({ paused: true });
  const r = await request(app).post('/api/public/chat/message').send({ token: chatToken, body: '¿Sigues ahí?' });
  assert.equal(r.body.reply, null, 'no AI reply while paused');
  // Agency replies manually on the chat channel.
  const manual = await request(app).post(`/api/conversations/${conv.id}/messages`).set(headers).send({
    channel: 'chat', body: 'Hola, soy Ana del equipo 👋',
  });
  assert.equal(manual.status, 201);
  assert.equal(manual.body.channel, 'chat');
});

test('widget.js is served and references the public chat API', async () => {
  const res = await request(app).get('/widget.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.match(res.text, /api\/public\/chat/);
});

test('trigger links: click counts, tags contact, fires automation, redirects', async () => {
  await request(app).post('/api/workflows').set(headers).send({
    name: 'Clicked promo', trigger_type: 'tag_added', trigger_config: { tag: 'promo-click' },
    actions: [{ type: 'add_note', config: { body: 'Le interesa la promo' } }],
  });
  const link = await request(app).post('/api/marketing/links').set(headers).send({
    name: 'Promo Junio', target_url: 'https://example.com/promo', tag: 'promo-click',
  });
  assert.equal(link.status, 201);

  const contact = await request(app).post('/api/contacts').set(headers).send({ first_name: 'Clicker', email: 'click@test.com' });
  const click = await request(app).get(`/l/${link.body.slug}?c=${contact.body.id}`);
  assert.equal(click.status, 302);
  assert.equal(click.headers.location, 'https://example.com/promo');

  const detail = await request(app).get(`/api/contacts/${contact.body.id}`).set(headers);
  assert.ok(detail.body.tags.includes('promo-click'));
  assert.equal(detail.body.notes.length, 1, 'tag automation ran');

  const links = await request(app).get('/api/marketing/links').set(headers);
  assert.equal(links.body[0].clicks, 1);
});

test('merge fields: {{link:slug}} and custom field tokens expand', async () => {
  const messaging = require('../server/services/messaging');
  const contact = { id: 42, first_name: 'Eva', custom_fields: '{"ciudad":"Madrid"}' };
  const out = messaging.mergeFields('Hola {{first_name}} de {{ciudad}}: {{link:promo-junio}}', contact);
  assert.match(out, /Hola Eva de Madrid/);
  assert.match(out, /\/l\/promo-junio\?c=42/);
});

test('smart lists: save, list, delete', async () => {
  const created = await request(app).post('/api/contacts/meta/smart-lists').set(headers).send({
    name: 'Clickers', filters: { tag: 'promo-click' },
  });
  assert.equal(created.status, 201);
  const lists = await request(app).get('/api/contacts/meta/smart-lists').set(headers);
  assert.equal(lists.body[0].filters.tag, 'promo-click');
  await request(app).delete(`/api/contacts/meta/smart-lists/${created.body.id}`).set(headers);
  const after = await request(app).get('/api/contacts/meta/smart-lists').set(headers);
  assert.equal(after.body.length, 0);
});

test('duplicates: detect by email and merge preserves children', async () => {
  const a = await request(app).post('/api/contacts').set(headers).send({ first_name: 'Dup', email: 'dup@test.com', tags: ['a'] });
  const b = await request(app).post('/api/contacts').set(headers).send({ first_name: 'Dup2', email: 'dup@test.com', phone: '+34999', tags: ['b'] });
  await request(app).post(`/api/contacts/${b.body.id}/notes`).set(headers).send({ body: 'nota del duplicado' });

  const dupes = await request(app).get('/api/contacts/meta/duplicates').set(headers);
  const group = dupes.body.find((g) => g.value === 'dup@test.com');
  assert.ok(group, 'duplicate group detected');
  assert.equal(group.contacts.length, 2);

  const merged = await request(app).post('/api/contacts/merge').set(headers).send({
    keep_id: a.body.id, merge_id: b.body.id,
  });
  assert.equal(merged.status, 200);

  const detail = await request(app).get(`/api/contacts/${a.body.id}`).set(headers);
  assert.ok(detail.body.tags.includes('a') && detail.body.tags.includes('b'), 'tags unioned');
  assert.ok(detail.body.notes.some((n) => n.body === 'nota del duplicado'), 'notes moved');
  assert.equal(detail.body.phone, '+34999', 'gaps filled from duplicate');
  const gone = await request(app).get(`/api/contacts/${b.body.id}`).set(headers);
  assert.equal(gone.status, 404);
});
