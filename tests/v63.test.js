// v63: Block C — A/B testing for email campaigns, round-robin owner assignment,
// and order bumps / upsells on the public payment page.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');
const automation = require('../server/services/automation');

let H, loc, u2;

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'BlockC', name: 'Admin', email: 'blockc@test.com', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${r.body.token}`, 'X-Location-Id': String(loc) };
  const m = await request(app).post('/api/locations/team/users').set(H).send({ name: 'Vendedor 2', email: 'v2@blockc.com', password: 'secret1', role: 'member' });
  u2 = m.body.id;
  await request(app).post('/api/pipelines').set(H).send({ name: 'Ventas' });
});

// ---- A/B email testing ----
test('A/B campaign splits recipients between two variants', async () => {
  for (let i = 0; i < 4; i++) await request(app).post('/api/contacts').set(H).send({ first_name: `C${i}`, email: `c${i}@ab.com` });
  const camp = await request(app).post('/api/marketing/campaigns').set(H).send({
    name: 'Promo', channel: 'email', subject: 'Asunto A', body: 'Cuerpo A',
    ab_test: true, subject_b: 'Asunto B', body_b: 'Cuerpo B',
  });
  assert.equal(camp.body.ab_test, 1);
  await request(app).post(`/api/marketing/campaigns/${camp.body.id}/send`).set(H);
  const stats = await request(app).get(`/api/marketing/campaigns/${camp.body.id}/stats`).set(H);
  assert.equal(stats.body.ab_test, true);
  const variants = stats.body.variants.map((v) => v.variant).sort();
  assert.deepEqual(variants, ['A', 'B'], 'both variants were used');
  assert.ok(stats.body.variants.every((v) => v.sent >= 1));
});

// ---- Round-robin assignment ----
test('nextRoundRobin rotates deterministically', async () => {
  const key = 'test:pool';
  const a = await automation.nextRoundRobin(key);
  const b = await automation.nextRoundRobin(key);
  const c = await automation.nextRoundRobin(key);
  assert.deepEqual([a, b, c], [0, 1, 2]);
});

test('assign_owner round-robin alternates owners across new contacts', async () => {
  const me = await request(app).get('/api/auth/me').set(H);
  const adminId = me.body.user.id;
  await request(app).post('/api/workflows').set(H).send({
    name: 'Reparto', trigger_type: 'contact_created', trigger_config: {},
    actions: [{ type: 'assign_owner', config: { round_robin: true, user_ids: [adminId, u2] } }],
  });
  const c1 = await request(app).post('/api/contacts').set(H).send({ first_name: 'RR1', email: 'rr1@x.com' });
  const c2 = await request(app).post('/api/contacts').set(H).send({ first_name: 'RR2', email: 'rr2@x.com' });
  const d1 = await request(app).get(`/api/contacts/${c1.body.id}`).set(H);
  const d2 = await request(app).get(`/api/contacts/${c2.body.id}`).set(H);
  assert.ok(d1.body.owner_user_id, 'first contact got an owner');
  assert.ok(d2.body.owner_user_id, 'second contact got an owner');
  assert.notEqual(d1.body.owner_user_id, d2.body.owner_user_id, 'owners alternate (round-robin)');
});

// ---- Order bumps / upsells ----
test('an invoice with order bumps lets the buyer add them at checkout', async () => {
  const contact = await request(app).post('/api/contacts').set(H).send({ first_name: 'Buyer', email: 'buyer@x.com' });
  const inv = await request(app).post('/api/payments').set(H).send({
    contact_id: contact.body.id, title: 'Servicio', items: [{ name: 'Plan', qty: 1, price: 100 }],
    bumps: [{ name: 'Soporte premium', price: 30 }, { name: 'Garantía extra', price: 20 }],
  });
  assert.equal(Number(inv.body.total), 100);
  const token = inv.body.token;
  // The pay page offers the bumps.
  const page = await request(app).get(`/pay/${token}`);
  assert.match(page.text, /Soporte premium/);
  assert.match(page.text, /Añade a tu pedido/);
  // Buyer selects bump 0 (30) and pays → total becomes 130.
  await request(app).post(`/api/public/pay/${token}/simulate-paid`).type('form').send({ bump: '0' });
  const list = await request(app).get('/api/payments').set(H);
  const paid = list.body.invoices.find((x) => x.token === token);
  assert.equal(paid.status, 'paid');
  assert.equal(Number(paid.total), 130, 'bump added to the settled total');
});
