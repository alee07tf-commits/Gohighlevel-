const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'page'
  );
}

async function withPages(funnel) {
  const pages = await db.all('SELECT * FROM funnel_pages WHERE funnel_id = ? ORDER BY position', [funnel.id]);
  return { ...funnel, pages: pages.map((p) => ({ ...p, content: JSON.parse(p.content || '[]') })) };
}

router.get('/', async (req, res) => {
  const funnels = await db.all('SELECT * FROM funnels WHERE location_id = ? ORDER BY id DESC', [req.location.id]);
  res.json(await Promise.all(funnels.map(withPages)));
});

router.post('/', async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  let slug = slugify(name);
  let i = 1;
  while (await db.get('SELECT id FROM funnels WHERE slug = ?', [slug])) slug = `${slugify(name)}-${i++}`;
  const id = await db.insert('INSERT INTO funnels (location_id, name, slug) VALUES (?, ?, ?)', [
    req.location.id,
    name,
    slug,
  ]);
  // Every funnel starts with a default landing page skeleton.
  const defaultContent = [
    { type: 'hero', headline: name, subheadline: 'Edit this page in the funnel builder', cta: 'Get Started' },
    {
      type: 'form',
      headline: 'Leave your details',
      button: 'Submit',
      fields: ['first_name', 'email', 'phone'],
      success_message: 'Thanks! We will be in touch shortly.',
      tag: '',
    },
  ];
  await db.run(
    'INSERT INTO funnel_pages (funnel_id, name, slug, position, published, content) VALUES (?, ?, ?, 0, 1, ?)',
    [id, 'Landing Page', 'home', JSON.stringify(defaultContent)]
  );
  res.status(201).json(await withPages(await db.get('SELECT * FROM funnels WHERE id = ?', [id])));
});

async function getFunnel(req, res, next) {
  const funnel = await db.get('SELECT * FROM funnels WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!funnel) return res.status(404).json({ error: 'Funnel not found' });
  req.funnel = funnel;
  next();
}

router.delete('/:id', getFunnel, async (req, res) => {
  await db.run('DELETE FROM funnels WHERE id = ?', [req.funnel.id]);
  res.json({ ok: true });
});

router.post('/:id/pages', getFunnel, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  let slug = slugify(name);
  let i = 1;
  while (await db.get('SELECT id FROM funnel_pages WHERE funnel_id = ? AND slug = ?', [req.funnel.id, slug]))
    slug = `${slugify(name)}-${i++}`;
  const { m } = await db.get('SELECT COALESCE(MAX(position), -1) AS m FROM funnel_pages WHERE funnel_id = ?', [
    req.funnel.id,
  ]);
  const id = await db.insert(
    'INSERT INTO funnel_pages (funnel_id, name, slug, position, content) VALUES (?, ?, ?, ?, ?)',
    [req.funnel.id, name, slug, m + 1, '[]']
  );
  const page = await db.get('SELECT * FROM funnel_pages WHERE id = ?', [id]);
  res.status(201).json({ ...page, content: [] });
});

router.put('/:id/pages/:pageId', getFunnel, async (req, res) => {
  const page = await db.get('SELECT * FROM funnel_pages WHERE id = ? AND funnel_id = ?', [
    req.params.pageId,
    req.funnel.id,
  ]);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const merged = { ...page, ...req.body };
  let contentJson;
  try {
    contentJson = JSON.stringify(typeof merged.content === 'string' ? JSON.parse(merged.content) : merged.content || []);
  } catch {
    return res.status(400).json({ error: 'content no es JSON válido' });
  }
  await db.run('UPDATE funnel_pages SET name=?, published=?, content=?, theme=? WHERE id=?', [
    merged.name,
    merged.published ? 1 : 0,
    contentJson,
    ['clean', 'bold', 'warm', 'elegant'].includes(merged.theme) ? merged.theme : 'clean',
    page.id,
  ]);
  const updated = await db.get('SELECT * FROM funnel_pages WHERE id = ?', [page.id]);
  res.json({ ...updated, content: JSON.parse(updated.content) });
});

router.delete('/:id/pages/:pageId', getFunnel, async (req, res) => {
  const info = await db.run('DELETE FROM funnel_pages WHERE id = ? AND funnel_id = ?', [
    req.params.pageId,
    req.funnel.id,
  ]);
  if (!info.changes) return res.status(404).json({ error: 'Page not found' });
  res.json({ ok: true });
});

router.get('/:id/submissions', getFunnel, async (req, res) => {
  const subs = await db.all(
    `SELECT fs.*, fp.name AS page_name, c.first_name, c.last_name, c.email AS contact_email
     FROM form_submissions fs
     JOIN funnel_pages fp ON fp.id = fs.funnel_page_id
     LEFT JOIN contacts c ON c.id = fs.contact_id
     WHERE fp.funnel_id = ? ORDER BY fs.created_at DESC LIMIT 200`,
    [req.funnel.id]
  );
  res.json(subs.map((s) => ({ ...s, data: JSON.parse(s.data || '{}') })));
});

module.exports = router;
