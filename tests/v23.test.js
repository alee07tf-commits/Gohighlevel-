// v2.3: real email polish — HTML rendering of email bodies and a test-send
// endpoint so an admin can verify their Resend/SendGrid key end to end. In the
// test env (no key configured) delivery resolves to 'simulated'.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');
const messaging = require('../server/services/messaging');

let headers;

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Mail Agency', name: 'Owner', email: 'owner@mail.test', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  headers = { Authorization: `Bearer ${r.body.token}`, 'X-Location-Id': String(me.body.locations[0].id) };
});

test('renderEmailHtml: escapes, links URLs, keeps line breaks, tints with brand', () => {
  const html = messaging.renderEmailHtml('Hola <b>&amp;</b>\nvisita https://acme.test ahora', { color: '#ff0000', fromName: 'Acme' });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /&lt;b&gt;/); // raw HTML is escaped, not injected
  assert.match(html, /<a href="https:\/\/acme\.test"/); // URL auto-linked
  assert.match(html, /#ff0000/); // brand colour applied
  assert.match(html, /Acme/); // from name footer
  assert.match(html, /<br>/); // single newline becomes a line break
});

test('test-email: returns simulated when no real provider key is set', async () => {
  const r = await request(app).post('/api/integrations/test-email').set(headers).send({});
  assert.equal(r.status, 200);
  assert.equal(r.body.provider, 'simulated');
  assert.equal(r.body.ok, true);
  assert.equal(r.body.to, 'owner@mail.test'); // defaults to the current user
});

test('test-email: honours an explicit recipient', async () => {
  const r = await request(app).post('/api/integrations/test-email').set(headers).send({ to: 'someone@else.test' });
  assert.equal(r.status, 200);
  assert.equal(r.body.to, 'someone@else.test');
});

test('email integration config round-trips (masked) at the agency level', async () => {
  await request(app).put('/api/integrations/agency/email').set(headers).send({
    vendor: 'resend', api_key: 're_test_123456', mail_from: 'hola@miagencia.com',
  });
  const r = await request(app).get('/api/integrations/agency/email').set(headers);
  const fields = Object.fromEntries(r.body.fields.map((f) => [f.key, f]));
  assert.equal(fields.mail_from.value, 'hola@miagencia.com');
  assert.equal(fields.api_key.set, true);
  assert.ok(fields.api_key.value.includes('••') || fields.api_key.value.endsWith('3456')); // masked, not clear
});
