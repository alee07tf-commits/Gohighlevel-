// v2.4: persistence self-diagnostic. /api/system/health reports whether the
// backend has a durable database, so a serverless deploy without DATABASE_URL
// (data silently vanishing) is caught instead of looking like a mystery bug.
const { test } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

test('health: reports persistent=true locally (no serverless flag)', async () => {
  const r = await request(app).get('/api/system/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.persistent, true);
});

test('health: reports persistent=false on serverless without DATABASE_URL', async () => {
  const prevVercel = process.env.VERCEL;
  const prevDb = process.env.DATABASE_URL;
  process.env.VERCEL = '1';
  delete process.env.DATABASE_URL;
  try {
    const r = await request(app).get('/api/system/health');
    assert.equal(r.body.serverless, true);
    assert.equal(r.body.persistent, false);
    assert.equal(r.body.database, 'pglite');
  } finally {
    if (prevVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = prevVercel;
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
  }
});
