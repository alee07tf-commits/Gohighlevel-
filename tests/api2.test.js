// v1.3 module tests: payments, tasks, custom fields, reputation, snapshots,
// workflow branches/recipes, appointment status triggers, PWA assets.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let headers, locationId, contactId;

before(async () => {
  const res = await request(app).post('/api/auth/register').send({
    agency_name: 'V13 Agency', name: 'Tester', email: 'v13@test.com', password: 'secret1', location_name: 'Loc A',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
  locationId = me.body.locations[0].id;
  headers = { Authorization: `Bearer ${res.body.token}`, 'X-Location-Id': String(locationId) };
  const contact = await request(app).post('/api/contacts').set(headers).send({
    first_name: 'Pago', last_name: 'Cliente', email: 'pago@test.com', phone: '+34600', tags: ['customer'],
  });
  contactId = contact.body.id;
});

test('payments: invoice lifecycle + public pay page + invoice_paid workflow', async () => {
  await request(app).post('/api/workflows').set(headers).send({
    name: 'Thanks after pay',
    trigger_type: 'invoice_paid',
    actions: [{ type: 'add_tag', config: { tag: 'pagador' } }],
  });

  const inv = await request(app).post('/api/payments').set(headers).send({
    contact_id: contactId,
    title: 'Servicio mensual',
    currency: 'EUR',
    items: [{ name: 'Plan CRM', qty: 1, price: 99.5 }, { name: 'Setup', qty: 1, price: 50 }],
  });
  assert.equal(inv.status, 201);
  assert.equal(inv.body.total, 149.5);
  assert.equal(inv.body.status, 'draft');

  const sent = await request(app).post(`/api/payments/${inv.body.id}/send`).set(headers).send({ channel: 'email' });
  assert.equal(sent.status, 200);
  assert.match(sent.body.url, /\/pay\//);

  const page = await request(app).get(`/pay/${inv.body.token}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Servicio mensual/);
  assert.match(page.text, /modo prueba/); // simulated mode button

  const paid = await request(app).post(`/api/public/pay/${inv.body.token}/simulate-paid`);
  assert.equal(paid.status, 302);

  const list = await request(app).get('/api/payments').set(headers);
  const mine = list.body.invoices.find((i) => i.id === inv.body.id);
  assert.equal(mine.status, 'paid');
  assert.equal(list.body.stats.paid, 149.5);

  const c = await request(app).get(`/api/contacts/${contactId}`).set(headers);
  assert.ok(c.body.tags.includes('pagador'), 'invoice_paid workflow fired');
});

test('tasks: CRUD + done toggle', async () => {
  const t = await request(app).post('/api/tasks').set(headers).send({
    title: 'Llamar a Pago', contact_id: contactId, due_at: '2030-01-01T10:00:00',
  });
  assert.equal(t.status, 201);
  const open = await request(app).get('/api/tasks?status=open').set(headers);
  assert.ok(open.body.some((x) => x.id === t.body.id));
  const done = await request(app).put(`/api/tasks/${t.body.id}`).set(headers).send({ status: 'done' });
  assert.equal(done.body.status, 'done');
  const detail = await request(app).get(`/api/contacts/${contactId}`).set(headers);
  assert.ok(detail.body.tasks.some((x) => x.id === t.body.id));
});

test('custom fields: definition + value on contact', async () => {
  const cf = await request(app).post('/api/custom-fields').set(headers).send({ name: 'Cumpleaños', type: 'date' });
  assert.equal(cf.status, 201);
  assert.equal(cf.body.key, 'cumpleanos');
  const updated = await request(app).put(`/api/contacts/${contactId}`).set(headers).send({
    custom_fields: { [cf.body.key]: '1990-05-10' },
  });
  assert.equal(updated.body.custom_fields[cf.body.key], '1990-05-10');
});

test('reputation: request + low-rating private feedback + stats', async () => {
  const rq = await request(app).post('/api/reputation/request').set(headers).send({
    contact_id: contactId, channel: 'sms',
  });
  assert.equal(rq.status, 201);

  const page = await request(app).get(`/review/${rq.body.token}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /experiencia/);

  const rated = await request(app).post(`/api/public/review/${rq.body.token}`).send({ rating: 2, comment: 'Esperé mucho' });
  assert.equal(rated.status, 200);

  const rep = await request(app).get('/api/reputation').set(headers);
  assert.equal(rep.body.stats.responded, 1);
  assert.equal(rep.body.stats.detractors, 1);
  assert.equal(rep.body.requests[0].rating, 2);
});

test('workflows: branch runs THEN/ELSE correctly', async () => {
  await request(app).post('/api/workflows').set(headers).send({
    name: 'Branch test',
    trigger_type: 'tag_added',
    trigger_config: { tag: 'evaluar' },
    actions: [
      {
        type: 'branch',
        config: {
          field: 'tag', op: 'has', value: 'customer',
          then: [{ type: 'add_tag', config: { tag: 'vip-cliente' } }],
          otherwise: [{ type: 'add_tag', config: { tag: 'lead-nuevo' } }],
        },
      },
    ],
  });
  // contactId has 'customer' → THEN
  await request(app).post(`/api/contacts/${contactId}/tags`).set(headers).send({ tag: 'evaluar' });
  const c1 = await request(app).get(`/api/contacts/${contactId}`).set(headers);
  assert.ok(c1.body.tags.includes('vip-cliente'));
  assert.ok(!c1.body.tags.includes('lead-nuevo'));

  const other = await request(app).post('/api/contacts').set(headers).send({ first_name: 'SinTag', email: 'sintag@test.com' });
  await request(app).post(`/api/contacts/${other.body.id}/tags`).set(headers).send({ tag: 'evaluar' });
  const c2 = await request(app).get(`/api/contacts/${other.body.id}`).set(headers);
  assert.ok(c2.body.tags.includes('lead-nuevo'));
});

test('workflows: recipes list + install', async () => {
  const recipes = await request(app).get('/api/workflows/recipes').set(headers);
  assert.ok(recipes.body.length >= 5);
  const installed = await request(app)
    .post(`/api/workflows/recipes/no-show-recovery/install`)
    .set(headers);
  assert.equal(installed.status, 201);
  assert.equal(installed.body.trigger_type, 'appointment_status_changed');
  assert.ok(installed.body.actions.length >= 2);
});

test('appointment_status_changed trigger fires on no-show', async () => {
  const cal = await request(app).post('/api/calendars').set(headers).send({ name: 'Consulta v13' });
  const appt = await request(app).post(`/api/calendars/${cal.body.id}/appointments`).set(headers).send({
    title: 'Cita test', starts_at: '2030-02-01T10:00:00', contact_id: contactId,
  });
  const upd = await request(app).put(`/api/calendars/appointments/${appt.body.id}`).set(headers).send({ status: 'no_show' });
  assert.equal(upd.body.status, 'no_show');
  // Recipe installed above adds tag 'no-show'
  const c = await request(app).get(`/api/contacts/${contactId}`).set(headers);
  assert.ok(c.body.tags.includes('no-show'), 'no-show recipe should tag the contact');
});

test('snapshots: export from A, import into B', async () => {
  await request(app).post('/api/funnels').set(headers).send({ name: 'Snap Funnel' });
  const snap = await request(app).get('/api/snapshots/export').set(headers);
  assert.equal(snap.body.kind, 'upcro-snapshot');
  assert.ok(snap.body.workflows.length >= 1);
  assert.ok(snap.body.funnels.length >= 1);

  const locB = await request(app).post('/api/locations').set(headers).send({ name: 'Loc B' });
  const headersB = { ...headers, 'X-Location-Id': String(locB.body.id) };
  const imported = await request(app).post('/api/snapshots/import').set(headersB).send(snap.body);
  assert.equal(imported.status, 200);
  assert.ok(imported.body.imported.workflows >= 1);
  const funnelsB = await request(app).get('/api/funnels').set(headersB);
  assert.ok(funnelsB.body.some((f) => f.name === 'Snap Funnel'));
});

test('branding: brand color applied to public funnel page', async () => {
  await request(app).put(`/api/locations/${locationId}`).set(headers).send({ brand_color: '#0ea5e9' });
  const funnels = await request(app).get('/api/funnels').set(headers);
  const rendered = await request(app).get(`/f/${funnels.body[0].slug}/home`);
  assert.match(rendered.text, /#0ea5e9/);
});

test('PWA: manifest, service worker and icons are served', async () => {
  const manifest = await request(app).get('/manifest.json');
  assert.equal(manifest.status, 200);
  assert.equal(JSON.parse(manifest.text).short_name, 'Upcro');
  const sw = await request(app).get('/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.text, /addEventListener\('fetch'/);
  const icon = await request(app).get('/icons/icon-192.png');
  assert.equal(icon.status, 200);
  const html = await request(app).get('/');
  assert.match(html.text, /manifest\.json/);
  assert.match(html.text, /theme-color/);
});
