// v3.20: Funnel/site parity — per-page SEO metadata + custom tracking code
// rendered on the published page.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server/index');

let jwt, loc, H, funnelId, pageId, funnelSlug, pageSlug;
before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Fun', name: 'A', email: 'fun@test.com', password: 'secret1', location_name: 'Sede',
  });
  jwt = r.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt}`);
  loc = me.body.locations[0].id;
  H = { Authorization: `Bearer ${jwt}`, 'X-Location-Id': String(loc) };
  const funnel = await request(app).post('/api/funnels').set(H).send({ name: 'Landing' });
  funnelId = funnel.body.id;
  funnelSlug = funnel.body.slug;
  // The funnel is created with a first page.
  const page = funnel.body.pages ? funnel.body.pages[0] : (await request(app).post(`/api/funnels/${funnelId}/pages`).set(H).send({ name: 'Home' })).body;
  pageId = page.id;
  pageSlug = page.slug;
});

test('page accepts SEO + tracking code and renders them when published', async () => {
  const upd = await request(app).put(`/api/funnels/${funnelId}/pages/${pageId}`).set(H).send({
    published: true,
    content: [{ type: 'hero', config: { title: 'Hi' } }],
    seo_title: 'Best Dentist in Town',
    seo_description: 'Book your cleaning today',
    seo_image: 'https://cdn.example.com/og.png',
    head_code: '<script>window.__px=1</script>',
    body_code: '<!-- end pixel -->',
  });
  assert.equal(upd.body.seo_title, 'Best Dentist in Town');

  const html = (await request(app).get(`/f/${funnelSlug}/${pageSlug}`)).text;
  assert.match(html, /<title>Best Dentist in Town<\/title>/);
  assert.match(html, /<meta name="description" content="Book your cleaning today">/);
  assert.match(html, /og:image" content="https:\/\/cdn\.example\.com\/og\.png"/);
  assert.match(html, /window\.__px=1/);
  assert.match(html, /<!-- end pixel -->/);
});
