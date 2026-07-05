// v53: AI rebilling. Conversation AI is a managed, plan-gated service — the
// agency sets an "IA ×" markup on the plan and each AI reply must debit the
// sub-account wallet, exactly like SMS/email. Before this the agent never
// metered AI, so the plan's ai multiplier was dead. This verifies the 'ai'
// category bills through the same wallet path the agent now feeds.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');
const billing = require('../server/services/billing');

let headers, adminToken, planId, clientLoc;

before(async () => {
  const res = await request(app).post('/api/auth/register').send({
    agency_name: 'V53', name: 'Admin', email: 'v53@test.com', password: 'secret1', location_name: 'Origen',
  });
  adminToken = res.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
  const sourceLoc = me.body.locations[0].id;
  headers = { Authorization: `Bearer ${adminToken}`, 'X-Location-Id': String(sourceLoc) };
  await request(app).post('/api/pipelines').set(headers).send({ name: 'Ventas' });
  const snap = await request(app).post('/api/snapshots').set(headers).send({ name: 'Base', from_location_id: sourceLoc });
  // Plan whose managed AI is rebilled at 3× the base cost.
  const plan = await request(app).post('/api/plans').set(headers).send({
    name: 'AI Pro', price: 149, interval: 'monthly', snapshot_id: snap.body.id,
    features: { ai: true }, rebilling: { ai: 3 },
  });
  planId = plan.body.id;
  await request(app).put('/api/agency/settings').set(headers).send({ slug: 'v53-agency' });
  const signup = await request(app).post('/api/public/saas/v53-agency/signup').send({
    plan_id: planId, name: 'Cliente', email: 'cli@v53.com', business_name: 'Cliente V53',
  });
  clientLoc = signup.body.location_id;
});

test('plan persists an AI rebilling multiplier', async () => {
  const list = await request(app).get('/api/plans').set(headers);
  const plan = list.body.find((p) => p.id === planId);
  assert.equal(plan.rebilling.ai, 3);
  assert.equal(plan.features.ai, true);
});

test('an AI reply debits the wallet at base(0.02) × multiplier', async () => {
  const before = (await billing.getWallet(clientLoc)).balance;
  const billed = await billing.recordUsage(clientLoc, 'ai', 1);
  assert.ok(Math.abs(billed - 0.06) < 1e-6, 'billed 0.02 × 3 = 0.06');
  const after = (await billing.getWallet(clientLoc)).balance;
  assert.ok(Math.abs((before - after) - 0.06) < 1e-6, 'wallet debited by the AI charge');
  const usage = await billing.monthlyUsage(clientLoc);
  assert.ok(usage.some((u) => u.category === 'ai'), 'AI usage event recorded for the monthly roll-up');
});
