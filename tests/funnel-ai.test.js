// Claude design: AI-generated landing pages that stay fully editable.
// Runs against the template fallback (no ANTHROPIC_API_KEY in tests).
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
delete process.env.ANTHROPIC_API_KEY;

const request = require('supertest');
const app = require('../server/index');

let headers;

before(async () => {
  const res = await request(app).post('/api/auth/register').send({
    agency_name: 'AI Agency', name: 'Tester', email: 'ai@test.com', password: 'secret1', location_name: 'Clinica X',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
  headers = { Authorization: `Bearer ${res.body.token}`, 'X-Location-Id': String(me.body.locations[0].id) };
});

test('ai funnel: generates from a single free-text prompt (Claude design interface)', async () => {
  // The primary interface: the user just describes what they want, like talking
  // to a designer. No structured fields required.
  const gen = await request(app).post('/api/ai/funnel').set(headers).send({
    prompt: 'Una landing premium para mi clínica dental en Madrid que promocione el blanqueamiento con 20% de descuento, con testimonios y formulario para pedir cita.',
  });
  assert.equal(gen.status, 201);
  assert.equal(gen.body.mode, 'created');
  const funnels = await request(app).get('/api/funnels').set(headers);
  const page = funnels.body.find((f) => f.id === gen.body.funnel_id).pages[0];
  assert.ok(page.content.length >= 4, 'a full page generated from just the prompt');
  assert.equal(page.content[0].type, 'hero');
  assert.ok(page.content.some((b) => b.type === 'form'), 'lead form wired in');
});

test('ai funnel: generates a complete funnel (template fallback) with editable blocks', async () => {
  const gen = await request(app).post('/api/ai/funnel').set(headers).send({
    business: 'Clínica dental', offer: 'Blanqueamiento 20% dto', goal: 'captar leads',
  });
  assert.equal(gen.status, 201);
  assert.equal(gen.body.mode, 'created');
  assert.match(gen.body.generated_by, /template/);

  const funnels = await request(app).get('/api/funnels').set(headers);
  const funnel = funnels.body.find((f) => f.id === gen.body.funnel_id);
  assert.ok(funnel, 'funnel created');
  const page = funnel.pages[0];
  assert.ok(page.published, 'page published by default');
  assert.ok(page.content.length >= 4, 'multiple sections generated');
  assert.equal(page.content[0].type, 'hero');
  assert.ok(page.content.some((b) => b.type === 'form'), 'always includes a lead form');
  assert.ok(page.content.some((b) => b.type === 'testimonials'), 'includes testimonials');
  assert.ok(['clean', 'bold', 'warm', 'elegant'].includes(page.theme));
});

test('ai funnel: rendered page includes new block types and theme css', async () => {
  const funnels = await request(app).get('/api/funnels').set(headers);
  const funnel = funnels.body[0];
  const rendered = await request(app).get(`/f/${funnel.slug}/home`);
  assert.equal(rendered.status, 200);
  assert.match(rendered.text, /t-card/, 'testimonials rendered');
  assert.match(rendered.text, /details/, 'faq rendered');
  assert.match(rendered.text, /lead-form/, 'form rendered');
});

test('ai funnel: result is fully editable and edits persist', async () => {
  const funnels = await request(app).get('/api/funnels').set(headers);
  const funnel = funnels.body[0];
  const page = funnel.pages[0];

  const edited = structuredClone(page.content);
  edited[0].headline = 'Titular editado por el usuario';
  edited.push({ type: 'cta', headline: 'CTA añadido a mano', body: 'texto', button: 'Vamos' });

  const saved = await request(app)
    .put(`/api/funnels/${funnel.id}/pages/${page.id}`)
    .set(headers)
    .send({ content: edited, published: true, theme: 'bold' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.theme, 'bold');
  assert.equal(saved.body.content[0].headline, 'Titular editado por el usuario');

  const rendered = await request(app).get(`/f/${funnel.slug}/home`);
  assert.match(rendered.text, /Titular editado por el usuario/);
  assert.match(rendered.text, /CTA añadido a mano/);
  assert.match(rendered.text, /#0f172a/, 'bold theme css applied');
});

test('ai funnel: regenerate an existing page in place', async () => {
  const funnels = await request(app).get('/api/funnels').set(headers);
  const funnel = funnels.body[0];
  const page = funnel.pages[0];
  const regen = await request(app).post('/api/ai/funnel').set(headers).send({
    offer: 'Nueva promo implantes', funnel_id: funnel.id, page_id: page.id,
  });
  assert.equal(regen.status, 200);
  assert.equal(regen.body.mode, 'regenerated');
  const after = await request(app).get('/api/funnels').set(headers);
  const newContent = after.body.find((f) => f.id === funnel.id).pages[0].content;
  assert.match(newContent[0].headline, /implantes/i);
});

test('ai funnel: lead capture still wires into CRM + automations', async () => {
  await request(app).post('/api/workflows').set(headers).send({
    name: 'AI funnel follow-up', trigger_type: 'form_submitted',
    actions: [{ type: 'add_tag', config: { tag: 'ai-lead' } }],
  });
  const funnels = await request(app).get('/api/funnels').set(headers);
  const funnel = funnels.body[0];
  const page = funnel.pages[0];
  const submit = await request(app).post(`/api/public/pages/${page.id}/submit`).send({
    first_name: 'LeadIA', email: 'leadia@test.com',
  });
  assert.equal(submit.status, 201);
  const found = await request(app).get('/api/contacts?q=leadia').set(headers);
  assert.ok(found.body[0].tags.includes('ai-lead'));
});
