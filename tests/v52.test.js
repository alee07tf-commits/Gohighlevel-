// v52: Stripe dunning — a failed renewal charge (invoice.payment_failed) flags
// the subscription past_due so the agency sees at-risk clients, like GHL. The
// event must be signature-verified when STRIPE_WEBHOOK_SECRET is configured.
const { test, before } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const request = require('supertest');
const app = require('../server/index');
const db = require('../server/db');

const SUB_ID = 'sub_dunning_test_1';

function stripeSig(rawBody) {
  const t = 1700000000;
  const v1 = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}
function postStripe(event) {
  const body = JSON.stringify(event);
  return request(app).post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', stripeSig(body))
    .send(body);
}

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Dun', name: 'A', email: 'dun@test.com', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  const agencyId = me.body.user.agency_id;
  const locId = me.body.locations[0].id;
  // A live subscription tied to the Stripe subscription id.
  await db.run(
    `INSERT INTO subscriptions (agency_id, location_id, status, stripe_subscription_id) VALUES (?, ?, 'active', ?)`,
    [agencyId, locId, SUB_ID]
  );
});

test('rejects a lifecycle event with a bad signature', async () => {
  const body = JSON.stringify({ type: 'invoice.payment_failed', data: { object: { subscription: SUB_ID } } });
  const res = await request(app).post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', 't=1,v1=deadbeef')
    .send(body);
  assert.equal(res.status, 400);
});

test('invoice.payment_failed flags the subscription past_due', async () => {
  const res = await postStripe({
    type: 'invoice.payment_failed',
    data: { object: { subscription: SUB_ID } },
  });
  assert.equal(res.status, 200);
  const sub = await db.get('SELECT status FROM subscriptions WHERE stripe_subscription_id = ?', [SUB_ID]);
  assert.equal(sub.status, 'past_due');
});

test('a later invoice.paid restores the subscription to active', async () => {
  const res = await postStripe({
    type: 'invoice.paid',
    data: { object: { subscription: SUB_ID, period_end: 1800000000 } },
  });
  assert.equal(res.status, 200);
  const sub = await db.get('SELECT status FROM subscriptions WHERE stripe_subscription_id = ?', [SUB_ID]);
  assert.equal(sub.status, 'active');
});
