// v59: Visual email builder — email templates persist a block `design` (JSON)
// alongside the compiled HTML `body` used for sending.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let H, tpl;

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Mail', name: 'A', email: 'mailb@test.com', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  H = { Authorization: `Bearer ${r.body.token}`, 'X-Location-Id': String(me.body.locations[0].id) };
});

test('creates a template with a block design and compiled body', async () => {
  const design = JSON.stringify([
    { type: 'heading', text: 'Hola {{first_name}}', align: 'center', size: 26 },
    { type: 'button', text: 'Reserva', url: 'https://x.com', align: 'center' },
  ]);
  const res = await request(app).post('/api/marketing/templates').set(H).send({
    name: 'Bienvenida', subject: 'Bienvenido', design,
    body: '<div><h1>Hola {{first_name}}</h1><a href="https://x.com">Reserva</a></div>',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.design, design, 'block design persisted');
  assert.match(res.body.body, /Reserva/, 'compiled HTML body persisted');
  tpl = res.body;
});

test('editing keeps the design re-editable', async () => {
  const newDesign = JSON.stringify([{ type: 'text', text: 'Nuevo contenido', align: 'left' }]);
  const res = await request(app).put(`/api/marketing/templates/${tpl.id}`).set(H).send({
    design: newDesign, body: '<div><p>Nuevo contenido</p></div>',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.design, newDesign);
  const list = await request(app).get('/api/marketing/templates').set(H);
  assert.equal(list.body.find((t) => t.id === tpl.id).design, newDesign);
});
