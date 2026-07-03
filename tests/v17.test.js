// v1.7: outgoing webhooks, Workflow/Reviews AI (fallback), review_received
// trigger, scheduled campaigns, quotes, recurring invoices, group bookings,
// member↔location permissions, missed-call text-back.
const { test, before } = require('node:test');
const assert = require('node:assert');
const http = require('http');

process.env.NODE_ENV = 'test';
delete process.env.ANTHROPIC_API_KEY;

const request = require('supertest');
const app = require('../server/index');

let headers, locationId, adminToken;

before(async () => {
  const res = await request(app).post('/api/auth/register').send({
    agency_name: 'V17', name: 'Admin', email: 'v17@test.com', password: 'secret1', location_name: 'Loc Uno',
  });
  adminToken = res.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
  locationId = me.body.locations[0].id;
  headers = { Authorization: `Bearer ${adminToken}`, 'X-Location-Id': String(locationId) };
});

test('workflow AI (fallback): creates a paused, editable workflow', async () => {
  const r = await request(app).post('/api/ai/workflow').set(headers).send({ goal: 'seguir a leads nuevos' });
  assert.equal(r.status, 201);
  const wfs = await request(app).get('/api/workflows').set(headers);
  const wf = wfs.body.find((w) => w.id === r.body.workflow_id);
  assert.ok(wf);
  assert.equal(wf.active, 0, 'created paused for review');
  assert.ok(wf.actions.length >= 2);
});

test('outgoing webhook action posts contact data', async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      received = JSON.parse(data);
      res.end('ok');
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  await request(app).post('/api/workflows').set(headers).send({
    name: 'Hook', trigger_type: 'tag_added', trigger_config: { tag: 'hooked' },
    actions: [{ type: 'webhook', config: { url: `http://127.0.0.1:${port}/hook`, event: 'test' } }],
  });
  const c = await request(app).post('/api/contacts').set(headers).send({ first_name: 'Hook', email: 'hook@test.com' });
  await request(app).post(`/api/contacts/${c.body.id}/tags`).set(headers).send({ tag: 'hooked' });
  server.close();
  assert.ok(received, 'webhook was called');
  assert.equal(received.contact.email, 'hook@test.com');
  assert.equal(received.event, 'test');
});

test('review_received trigger + Reviews AI suggestion (fallback)', async () => {
  await request(app).post('/api/workflows').set(headers).send({
    name: 'On review', trigger_type: 'review_received',
    actions: [{ type: 'add_tag', config: { tag: 'reseño' } }],
  });
  const c = await request(app).post('/api/contacts').set(headers).send({ first_name: 'Rev', email: 'rev@test.com' });
  const rq = await request(app).post('/api/reputation/request').set(headers).send({ contact_id: c.body.id });
  await request(app).post(`/api/public/review/${rq.body.token}`).send({ rating: 5, comment: 'Genial todo' });

  const detail = await request(app).get(`/api/contacts/${c.body.id}`).set(headers);
  assert.ok(detail.body.tags.includes('reseño'), 'review_received workflow fired');

  const rep = await request(app).get('/api/reputation').set(headers);
  const row = rep.body.requests.find((r) => r.token === rq.body.token);
  const suggestion = await request(app).post(`/api/reputation/${row.id}/suggest-reply`).set(headers);
  assert.equal(suggestion.status, 200);
  assert.match(suggestion.body.reply, /gracias/i);
});

test('scheduled campaign: stored as scheduled and sent by the scheduler', async () => {
  await request(app).post('/api/contacts').set(headers).send({ first_name: 'Sched', email: 'sched@test.com', tags: ['prog'] });
  const camp = await request(app).post('/api/marketing/campaigns').set(headers).send({
    name: 'Programada', channel: 'email', subject: 'Hola {{first_name}}', body: 'Programado!',
    tag_filter: 'prog', send_at: new Date(Date.now() - 1000).toISOString(), // already due
  });
  // send_at in the past → created as draft? No: our API only schedules future. Re-create with +1s and tick after.
  const camp2 = await request(app).post('/api/marketing/campaigns').set(headers).send({
    name: 'Programada2', channel: 'email', subject: 'Hola', body: 'Programado!',
    tag_filter: 'prog', send_at: new Date(Date.now() + 5000).toISOString(),
  });
  assert.equal(camp2.body.status, 'scheduled');
  await new Promise((r) => setTimeout(r, 5500));
  const scheduler = require('../server/services/scheduler');
  await scheduler.tick();
  const list = await request(app).get('/api/marketing/campaigns').set(headers);
  const sent = list.body.find((x) => x.id === camp2.body.id);
  assert.equal(sent.status, 'sent');
  assert.equal(sent.recipient_count, 1);
});

test('quotes: public accept converts to payable invoice and tags contact', async () => {
  const c = await request(app).post('/api/contacts').set(headers).send({ first_name: 'Quote', email: 'quote@test.com' });
  const q = await request(app).post('/api/payments').set(headers).send({
    contact_id: c.body.id, title: 'Proyecto web', kind: 'quote',
    items: [{ name: 'Web completa', qty: 1, price: 1500 }],
  });
  assert.equal(q.body.kind, 'quote');
  const page = await request(app).get(`/pay/${q.body.token}`);
  assert.match(page.text, /Presupuesto/);
  assert.match(page.text, /Aceptar presupuesto/);

  const accepted = await request(app).post(`/api/public/pay/${q.body.token}/accept-quote`);
  assert.equal(accepted.status, 302);
  const detail = await request(app).get(`/api/contacts/${c.body.id}`).set(headers);
  assert.ok(detail.body.tags.includes('presupuesto-aceptado'));
  const list = await request(app).get('/api/payments').set(headers);
  const inv = list.body.invoices.find((i) => i.id === q.body.id);
  assert.equal(inv.kind, 'invoice');
  assert.equal(inv.status, 'sent');
});

test('recurring invoice: settling schedules the next monthly cycle', async () => {
  const c = await request(app).post('/api/contacts').set(headers).send({ first_name: 'Recur', email: 'recur@test.com' });
  const inv = await request(app).post('/api/payments').set(headers).send({
    contact_id: c.body.id, title: 'Mantenimiento', recurring: 'monthly',
    items: [{ name: 'Plan mensual', qty: 1, price: 99 }],
  });
  await request(app).post(`/api/payments/${inv.body.id}/mark-paid`).set(headers);
  const db = require('../server/db');
  const job = await db.get(
    `SELECT * FROM scheduled_jobs WHERE type = 'recurring_invoice' AND status = 'pending' AND payload LIKE ?`,
    [`%"invoice_id":${inv.body.id}%`]
  );
  assert.ok(job, 'next recurring cycle scheduled');
});

test('group bookings: capacity 2 allows two bookings, rejects the third', async () => {
  const cal = await request(app).post('/api/calendars').set(headers).send({ name: 'Clase Yoga', capacity: 2 });
  const slot = { date: '2031-03-10', time: '10:00' };
  const b1 = await request(app).post(`/api/public/book/${cal.body.slug}`).send({ name: 'A A', email: 'a@x.com', ...slot });
  const b2 = await request(app).post(`/api/public/book/${cal.body.slug}`).send({ name: 'B B', email: 'b@x.com', ...slot });
  const b3 = await request(app).post(`/api/public/book/${cal.body.slug}`).send({ name: 'C C', email: 'c@x.com', ...slot });
  assert.equal(b1.status, 201);
  assert.equal(b2.status, 201);
  assert.equal(b3.status, 409);
});

test('member permissions: assigned member cannot access other sub-accounts', async () => {
  const locB = await request(app).post('/api/locations').set(headers).send({ name: 'Loc Dos' });
  const member = await request(app).post('/api/locations/team/users').set(headers).send({
    name: 'Member', email: 'member17@test.com', password: 'secret1', role: 'member',
  });
  // Without assignments: access everywhere.
  const login = await request(app).post('/api/auth/login').send({ email: 'member17@test.com', password: 'secret1' });
  const mHeaders = { Authorization: `Bearer ${login.body.token}` };
  let r = await request(app).get('/api/contacts').set({ ...mHeaders, 'X-Location-Id': String(locB.body.id) });
  assert.equal(r.status, 200);
  // Restrict to Loc Uno only.
  await request(app).put(`/api/locations/team/users/${member.body.id}/locations`).set(headers).send({
    location_ids: [locationId],
  });
  r = await request(app).get('/api/contacts').set({ ...mHeaders, 'X-Location-Id': String(locB.body.id) });
  assert.equal(r.status, 403);
  r = await request(app).get('/api/contacts').set({ ...mHeaders, 'X-Location-Id': String(locationId) });
  assert.equal(r.status, 200);
});

test('missed-call text-back: no-answer call creates contact and sends SMS', async () => {
  await request(app).put(`/api/locations/${locationId}`).set(headers).send({
    missed_call_text: 'Vimos tu llamada, ¿en qué te ayudamos?',
  });
  const r = await request(app)
    .post(`/api/webhooks/twilio-voice/${locationId}`)
    .type('form')
    .send({ CallStatus: 'no-answer', From: '+34677889900' });
  assert.equal(r.status, 200);
  const found = await request(app).get('/api/contacts?q=677889900').set(headers);
  assert.equal(found.body.length, 1);
  assert.equal(found.body[0].source, 'missed-call');
  const convs = await request(app).get('/api/conversations').set(headers);
  const conv = convs.body.find((c) => c.contact_id === found.body[0].id);
  assert.ok(conv, 'text-back recorded in inbox');
});

test('prospecting: simulated search + import creates contacts/opportunities', async () => {
  const status = await request(app).get('/api/prospecting/status').set(headers);
  assert.equal(status.body.provider, 'simulated');

  const search = await request(app).post('/api/prospecting/search').set(headers).send({
    query: 'dentistas en Madrid',
  });
  assert.equal(search.status, 200);
  assert.ok(search.body.results.length >= 5);
  assert.ok(search.body.results[0].demo, 'clearly labeled as demo');

  await request(app).post('/api/pipelines').set(headers).send({ name: 'Prospección' });
  const imp = await request(app).post('/api/prospecting/import').set(headers).send({
    prospects: search.body.results.slice(0, 3), tag: 'prospecto', create_opportunities: true,
  });
  assert.equal(imp.body.imported, 3);

  const contacts = await request(app).get('/api/contacts?tag=prospecto').set(headers);
  assert.equal(contacts.body.length, 3);
  assert.equal(contacts.body[0].source, 'prospecting');
  assert.ok(contacts.body[0].custom_fields.direccion, 'address stored in custom fields');

  // Re-import same prospects → skipped as duplicates by phone.
  const again = await request(app).post('/api/prospecting/import').set(headers).send({
    prospects: search.body.results.slice(0, 3),
  });
  assert.equal(again.body.imported, 0);
  assert.equal(again.body.skipped, 3);
});

test('prospecting ads detection: scans real HTML for Google Ads / Meta Pixel tags', async () => {
  const prospecting = require('../server/services/prospecting');
  const advertiser = http.createServer((req, res) =>
    res.end(`<html><head><script async src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script>
      <script>fbq('init','111');</script></head><body>Hola</body></html>`)
  );
  const organic = http.createServer((req, res) => res.end('<html><body>Sin pixeles</body></html>'));
  await new Promise((r) => advertiser.listen(0, r));
  await new Promise((r) => organic.listen(0, r));

  const results = [
    { name: 'Anunciante SL', website: `http://127.0.0.1:${advertiser.address().port}`, reviews: 80, rating: 4.5 },
    { name: 'Orgánico SL', website: `http://127.0.0.1:${organic.address().port}`, reviews: 12, rating: 4.9 },
    { name: 'Sin Web SL', website: '', reviews: 3, rating: 5 },
  ];
  await prospecting.enrich(results);
  advertiser.close();
  organic.close();

  assert.equal(results[0].runs_ads, true, 'AW- tag + fbq detected');
  assert.equal(results[0].tech.google_ads, true);
  assert.equal(results[0].tech.meta_pixel, true);
  assert.equal(results[1].runs_ads, false, 'clean site → not advertising');
  assert.equal(results[2].runs_ads, false, 'no website → not advertising');

  // Filters
  const conAds = prospecting.applyFilters(results, { ads: 'with' });
  assert.deepEqual(conAds.map((r) => r.name), ['Anunciante SL']);
  const sinAdsConWeb = prospecting.applyFilters(results, { ads: 'without', website: 'with' });
  assert.deepEqual(sinAdsConWeb.map((r) => r.name), ['Orgánico SL']);
  const muchasResenas = prospecting.applyFilters(results, { min_reviews: 50 });
  assert.deepEqual(muchasResenas.map((r) => r.name), ['Anunciante SL']);
  const sinWeb = prospecting.applyFilters(results, { website: 'without' });
  assert.deepEqual(sinWeb.map((r) => r.name), ['Sin Web SL']);
});

test('prospecting search API: enriched results + server-side filters', async () => {
  const filtered = await request(app).post('/api/prospecting/search').set(headers).send({
    query: 'clinicas en Sevilla',
    filters: { ads: 'without', website: 'with' },
  });
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.total_before_filters > filtered.body.results.length, 'filters reduced the set');
  for (const r of filtered.body.results) {
    assert.equal(r.runs_ads, false);
    assert.ok(r.website);
    assert.ok(r.tech, 'tech detection attached');
  }
});
