const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');
const scheduler = require('../server/services/scheduler');

let headers;

before(async () => {
  const res = await request(app).post('/api/auth/register').send({
    agency_name: 'V12 Agency',
    name: 'Boss',
    email: 'boss@v12.com',
    password: 'secret1',
    location_name: 'V12 Location',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
  headers = { Authorization: `Bearer ${res.body.token}`, 'X-Location-Id': String(me.body.locations[0].id) };
});

test('integrations status reports simulated providers without keys', async () => {
  const res = await request(app).get('/api/system/integrations').set(headers);
  assert.equal(res.status, 200);
  assert.equal(res.body.email, 'simulated');
  assert.equal(res.body.sms, 'simulated');
  assert.equal(res.body.whatsapp, 'simulated');
  assert.equal(res.body.ai, false);
});

test('workflow wait: pauses, schedules a job, and resumes on tick', async () => {
  const wf = await request(app).post('/api/workflows').set(headers).send({
    name: 'Nurture with wait',
    trigger_type: 'contact_created',
    actions: [
      { type: 'add_tag', config: { tag: 'step1' } },
      { type: 'wait', config: { amount: 0, unit: 'minutes' } },
      { type: 'add_tag', config: { tag: 'step2' } },
    ],
  });
  assert.equal(wf.status, 201);

  const contact = await request(app).post('/api/contacts').set(headers).send({ first_name: 'Wero', email: 'wero@v12.com' });
  let detail = await request(app).get(`/api/contacts/${contact.body.id}`).set(headers);
  assert.ok(detail.body.tags.includes('step1'), 'first segment ran');
  assert.ok(!detail.body.tags.includes('step2'), 'second segment paused behind wait');

  // 0-minute wait is due immediately; the cron tick resumes it.
  const tick = await request(app).get('/api/cron/tick');
  assert.equal(tick.status, 200);
  assert.ok(tick.body.processed >= 1);

  detail = await request(app).get(`/api/contacts/${contact.body.id}`).set(headers);
  assert.ok(detail.body.tags.includes('step2'), 'workflow resumed after wait');
});

test('appointment reminder job is scheduled and sends messages when due', async () => {
  const cal = await request(app).post('/api/calendars').set(headers).send({ name: 'Reminder Cal', reminder_hours: 1 });
  const contact = await request(app).post('/api/contacts').set(headers).send({
    first_name: 'Remy', email: 'remy@v12.com', phone: '+34600000001',
  });
  // Appointment ~90 minutes out → reminder (1h before) lands ~30 min in the future.
  const startsAt = new Date(Date.now() + 90 * 60000).toISOString().slice(0, 19);
  const appt = await request(app)
    .post(`/api/calendars/${cal.body.id}/appointments`)
    .set(headers)
    .send({ title: 'Check-in', starts_at: startsAt, contact_id: contact.body.id });
  assert.equal(appt.status, 201);

  const db = require('../server/db');
  const job = await db.get(
    `SELECT * FROM scheduled_jobs WHERE type = 'appointment_reminder' AND payload LIKE ? ORDER BY id DESC LIMIT 1`,
    [`%"appointment_id":${appt.body.id}%`]
  );
  assert.ok(job, 'reminder job scheduled');
  assert.equal(job.status, 'pending');

  // Force it due and tick.
  await db.run(`UPDATE scheduled_jobs SET run_at = now() - interval '1 minute' WHERE id = ?`, [job.id]);
  await request(app).get('/api/cron/tick');
  const done = await db.get('SELECT * FROM scheduled_jobs WHERE id = ?', [job.id]);
  assert.equal(done.status, 'done');
  assert.match(done.result, /reminder sent/);

  const convs = await request(app).get('/api/conversations').set(headers);
  const conv = convs.body.find((c) => c.contact_id === contact.body.id);
  assert.ok(conv, 'reminder created inbox messages');
});

test('twilio inbound webhook creates contact, message and score', async () => {
  const locationId = headers['X-Location-Id'];
  const res = await request(app)
    .post(`/api/webhooks/twilio/${locationId}`)
    .type('form')
    .send({ From: 'whatsapp:+34611222333', Body: 'Hola, quiero información' });
  assert.equal(res.status, 200);
  assert.match(res.text, /<Response>/);

  const contacts = await request(app).get('/api/contacts?q=%2B34611222333').set(headers);
  assert.equal(contacts.body.length, 1);
  assert.equal(contacts.body[0].source, 'whatsapp-inbound');
  assert.ok(contacts.body[0].score >= 5, 'inbound message scored');

  const convs = await request(app).get('/api/conversations').set(headers);
  const conv = convs.body.find((c) => c.contact_id === contacts.body[0].id);
  assert.equal(conv.last_channel, 'whatsapp');
  assert.equal(conv.unread, 1);
});

test('lead scoring surfaces hot leads on dashboard', async () => {
  const contact = await request(app).post('/api/contacts').set(headers).send({ first_name: 'Hot', email: 'hot@v12.com', phone: '+34600000009' });
  // form submission (via funnel) + appointment would be organic; simulate points quickly:
  const db = require('../server/db');
  await db.run('UPDATE contacts SET score = 35 WHERE id = ?', [contact.body.id]);
  const dash = await request(app).get('/api/dashboard').set(headers);
  assert.ok(Array.isArray(dash.body.hotLeads));
  assert.ok(dash.body.hotLeads.some((l) => l.id === contact.body.id), 'hot lead listed');
});

test('whatsapp campaign channel works (simulated delivery)', async () => {
  await request(app).post('/api/contacts').set(headers).send({ first_name: 'Wapp', phone: '+34600000010', tags: ['wa'] });
  const camp = await request(app).post('/api/marketing/campaigns').set(headers).send({
    name: 'WA blast', channel: 'whatsapp', body: 'Hola {{first_name}}!', tag_filter: 'wa',
  });
  assert.equal(camp.status, 201);
  assert.equal(camp.body.channel, 'whatsapp');
  const sent = await request(app).post(`/api/marketing/campaigns/${camp.body.id}/send`).set(headers);
  assert.equal(sent.body.recipient_count, 1);
});

test('CSV export and import round-trip', async () => {
  const exp = await request(app).get('/api/contacts/export/csv').set(headers);
  assert.equal(exp.status, 200);
  assert.match(exp.headers['content-type'], /text\/csv/);
  assert.match(exp.text, /first_name,last_name,email/);

  const csv = 'first_name,last_name,email,phone,tags\n"Ana","Imported","ana@import.com","+34999888777","vip;import"\n"Dup","Row","ana@import.com","",""';
  const imp = await request(app).post('/api/contacts/import/csv').set(headers).send({ csv });
  assert.equal(imp.status, 200);
  assert.equal(imp.body.imported, 1);
  assert.equal(imp.body.skipped, 1, 'duplicate email skipped');

  const found = await request(app).get('/api/contacts?q=ana@import.com').set(headers);
  assert.equal(found.body.length, 1);
  assert.deepEqual(found.body[0].tags.sort(), ['import', 'vip']);
  assert.equal(found.body[0].source, 'import');
});

test('client report: generate, public page, and send (simulated)', async () => {
  const gen = await request(app).post('/api/reports/generate').set(headers).send({ period_days: 30 });
  assert.equal(gen.status, 201);
  assert.ok(gen.body.token);
  assert.ok(gen.body.narrative.length > 20, 'narrative generated (template fallback without AI key)');
  assert.ok(gen.body.stats.new_contacts >= 1);

  const page = await request(app).get(`/r/${gen.body.token}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Informe de resultados/);
  assert.match(page.text, /Contactos nuevos/);

  const send = await request(app).post(`/api/reports/${gen.body.id}/send`).set(headers).send({ email: 'client@v12.com' });
  assert.equal(send.status, 200);
  assert.match(send.body.delivery, /simulated/);

  const list = await request(app).get('/api/reports').set(headers);
  assert.ok(list.body.length >= 1);
});

test('AI endpoint returns clear 501 without API key', async () => {
  const res = await request(app).post('/api/ai/generate').set(headers).send({ kind: 'email', prompt: 'promo de verano' });
  assert.equal(res.status, 501);
  assert.match(res.body.error, /ANTHROPIC_API_KEY/);
});
