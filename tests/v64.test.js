// v64: Claude design v2 + prospecting removal.
//  - Prospecting endpoints are gone (404).
//  - Landings render hero background photos, split (text+image) and image blocks.
//  - The Claude design chat endpoint edits a page from natural language, with a
//    rule-engine fallback when no AI key is configured.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
delete process.env.ANTHROPIC_API_KEY;

const request = require('supertest');
const app = require('../server/index');

let H, funnelId, pageId, pageSlug, funnelSlug;

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'CD2', name: 'A', email: 'cd2@test.com', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  H = { Authorization: `Bearer ${r.body.token}`, 'X-Location-Id': String(me.body.locations[0].id) };
  const gen = await request(app).post('/api/ai/funnel').set(H).send({
    business: 'Clínica dental Madrid', offer: 'Blanqueamiento 20% dto',
  });
  funnelId = gen.body.funnel_id;
  const funnels = await request(app).get('/api/funnels').set(H);
  const f = funnels.body.find((x) => x.id === funnelId);
  funnelSlug = f.slug;
  pageId = f.pages[0].id;
  pageSlug = f.pages[0].slug;
});

test('prospecting module is fully removed (404)', async () => {
  const res = await request(app).get('/api/prospecting/status').set(H);
  assert.equal(res.status, 404);
});

test('generated landing includes hero photo, split section and stock images', async () => {
  const page = await request(app).get(`/f/${funnelSlug}/${pageSlug}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /hero has-img/, 'hero has a background photo');
  assert.match(page.text, /class="split/, 'split (text+image) section rendered');
  assert.match(page.text, /loremflickr\.com/, 'keyword stock images resolved without any API key');
});

test('authenticated draft preview renders the real page', async () => {
  // Unpublish → public URL 404s but the builder preview still renders.
  await request(app).put(`/api/funnels/${funnelId}/pages/${pageId}`).set(H).send({ published: false });
  const pub = await request(app).get(`/f/${funnelSlug}/${pageSlug}`);
  assert.equal(pub.status, 404);
  const prev = await request(app).get(`/api/funnels/${funnelId}/pages/${pageId}/preview`).set(H);
  assert.equal(prev.status, 200);
  assert.match(prev.text, /hero/, 'draft preview uses the real renderer');
  await request(app).put(`/api/funnels/${funnelId}/pages/${pageId}`).set(H).send({ published: true });
});

test('design chat: adds a pricing section and switches to dark theme (fallback)', async () => {
  const res = await request(app).post('/api/ai/design').set(H).send({
    funnel_id: funnelId, page_id: pageId, prompt: 'Añade una sección de precios y hazla más oscura',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.generated_by, 'rules');
  assert.ok(res.body.changed, 'the rule engine applied changes');
  assert.equal(res.body.theme, 'bold', 'dark theme applied');
  assert.ok(res.body.blocks.some((b) => b.type === 'pricing'), 'pricing section added');
  // Persisted: the rendered page now shows pricing.
  const page = await request(app).get(`/f/${funnelSlug}/${pageSlug}`);
  assert.match(page.text, /p-grid|p-card/, 'pricing rendered on the live page');
});

test('design chat: puts a photo in the hero from a prompt', async () => {
  const res = await request(app).post('/api/ai/design').set(H).send({
    funnel_id: funnelId, page_id: pageId, prompt: 'Pon una foto de dentist smile en el hero de fondo',
  });
  assert.equal(res.status, 200);
  const hero = res.body.blocks.find((b) => b.type === 'hero');
  assert.ok(hero.image_keywords, 'hero got image keywords from the prompt');
});

test('design chat: never loses the lead form', async () => {
  const res = await request(app).post('/api/ai/design').set(H).send({
    funnel_id: funnelId, page_id: pageId, prompt: 'quita los testimonios',
  });
  assert.ok(res.body.blocks.some((b) => b.type === 'form'), 'form block always preserved');
  assert.ok(!res.body.blocks.some((b) => b.type === 'testimonials'), 'testimonials removed');
});
