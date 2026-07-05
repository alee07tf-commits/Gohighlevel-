// v3.16: Forms parity — custom fields, required fields, submission notification.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H, cfKey, slug;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Forms', name: 'A', email: 'forms@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  const cf = await request(app).post('/api/custom-fields').set(H).send({ name: 'Empresa', type: 'text' });
  cfKey = cf.body.key;
  const form = await request(app).post('/api/forms').set(H).send({
    name: 'Contacto', fields: ['first_name', 'email', 'phone', cfKey], required_fields: ['phone', cfKey],
    notify_email: 'team@agency.com', tag: 'lead',
  });
  slug = form.body.slug;
});

test('form accepts a custom field and required list', async () => {
  const forms = await request(app).get('/api/forms').set(H);
  const f = forms.body.find((x) => x.slug === slug);
  const fields = JSON.parse(f.fields);
  assert.ok(fields.includes(cfKey), 'custom field kept');
  assert.equal(f.notify_email, 'team@agency.com');
  assert.deepEqual(JSON.parse(f.required_fields).sort(), ['phone', cfKey].sort());
});

test('public form renders required + custom fields', async () => {
  const page = await request(app).get(`/form/${slug}`);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(`name="${cfKey}"`), 'custom field rendered');
  // phone is marked required in the HTML.
  assert.match(page.text, new RegExp(`name="phone"[^>]*required`));
});

test('submission saves the custom field onto the contact', async () => {
  const res = await request(app).post(`/api/public/form/${slug}/submit`).send({
    first_name: 'Lía', email: 'lia@x.com', phone: '+34600', [cfKey]: 'Acme SL',
  });
  assert.equal(res.status, 201);
  const contacts = await request(app).get('/api/contacts?q=lia@x.com').set(H);
  const c = contacts.body.find((x) => x.email === 'lia@x.com');
  assert.ok(c, 'contact created');
  const detail = await request(app).get(`/api/contacts/${c.id}`).set(H);
  assert.equal(detail.body.custom_fields[cfKey], 'Acme SL');
});
