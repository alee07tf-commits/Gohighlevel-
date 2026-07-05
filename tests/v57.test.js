// v57: Launch-readiness — security headers, brute-force rate limiting on auth,
// password reset flow, and RGPD legal pages.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');
const db = require('../server/db');

before(async () => {
  await request(app).post('/api/auth/register').send({
    agency_name: 'Sec', name: 'A', email: 'sec@test.com', password: 'secret1', location_name: 'Sede',
  });
});

test('security headers are present on responses', async () => {
  const res = await request(app).get('/api/system/health');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  assert.ok(res.headers['referrer-policy']);
});

test('forgot-password never reveals whether an email exists', async () => {
  const known = await request(app).post('/api/auth/forgot').send({ email: 'sec@test.com' });
  const unknown = await request(app).post('/api/auth/forgot').send({ email: 'nobody@nowhere.com' });
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.deepEqual(known.body, unknown.body);
});

test('a valid reset token sets a new password and returns a session', async () => {
  await request(app).post('/api/auth/forgot').send({ email: 'sec@test.com' });
  const user = await db.get('SELECT id FROM users WHERE email = ?', ['sec@test.com']);
  const row = await db.get('SELECT token FROM password_resets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [user.id]);
  assert.ok(row && row.token, 'reset token was created');
  const reset = await request(app).post('/api/auth/reset').send({ token: row.token, password: 'newpass9' });
  assert.equal(reset.status, 200);
  assert.ok(reset.body.token, 'issues a session on reset');
  // Old password no longer works; new one does.
  const oldLogin = await request(app).post('/api/auth/login').send({ email: 'sec@test.com', password: 'secret1' });
  assert.equal(oldLogin.status, 401);
  const newLogin = await request(app).post('/api/auth/login').send({ email: 'sec@test.com', password: 'newpass9' });
  assert.equal(newLogin.status, 200);
  // Token is single-use.
  const reuse = await request(app).post('/api/auth/reset').send({ token: row.token, password: 'again123' });
  assert.equal(reuse.status, 400);
});

test('login rate limiting kicks in after too many attempts', async () => {
  let limited = false;
  for (let i = 0; i < 14; i++) {
    const res = await request(app).post('/api/auth/login')
      .set('X-Forwarded-For', '9.9.9.9')
      .send({ email: 'x@x.com', password: 'wrong' });
    if (res.status === 429) { limited = true; break; }
  }
  assert.ok(limited, 'the limiter returns 429 under brute force');
});

test('RGPD legal pages render', async () => {
  for (const doc of ['privacidad', 'terminos', 'cookies']) {
    const res = await request(app).get(`/legal/${doc}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /Upcro/);
  }
  const missing = await request(app).get('/legal/nope');
  assert.equal(missing.status, 404);
});
