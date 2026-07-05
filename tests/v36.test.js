// v3.7: Stripe subscription-lifecycle webhooks. Renewals/cancellations keep the
// subscriptions table in sync, gated by Stripe-Signature verification.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

function sign(bodyString, secret, t = 1750000000) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${bodyString}`).digest('hex');
  return `t=${t},v1=${v1}`;
}
function postEvent(obj, { sig } = {}) {
  const body = JSON.stringify(obj);
  const req = request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json');
  if (sig) req.set('Stripe-Signature', sig);
  return req.send(body);
}

test('lifecycle event with a bad signature is rejected', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const res = await postEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_x' } } }, { sig: 't=1,v1=bad' });
  assert.equal(res.status, 400);
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

test('a correctly-signed lifecycle event is accepted', async () => {
  const secret = 'whsec_test';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  const obj = { type: 'customer.subscription.deleted', data: { object: { id: 'sub_x' } } };
  const body = JSON.stringify(obj);
  const res = await postEvent(obj, { sig: sign(body, secret) });
  assert.equal(res.status, 200);
  assert.equal(res.body.received, true);
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

test('without a configured secret, lifecycle events are accepted (dev)', async () => {
  const res = await postEvent({ type: 'invoice.paid', data: { object: { subscription: 'sub_y', period_end: 1760000000 } } });
  assert.equal(res.status, 200);
  assert.equal(res.body.received, true);
});

test('non-lifecycle, non-checkout events are acknowledged', async () => {
  const res = await postEvent({ type: 'ping', data: { object: {} } });
  assert.equal(res.status, 200);
  assert.equal(res.body.received, true);
});
