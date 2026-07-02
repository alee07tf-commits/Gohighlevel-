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

function withPages(funnel) {
  return {
    ...funnel,
    pages: db
      .prepare('SELECT * FROM funnel_pages WHERE funnel_id = ? ORDER BY position')
      .all(funnel.id)
      .map((p) => ({ ...p, content: JSON.parse(p.content || '[]') })),
  };
}

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM funnels WHERE location_id = ? ORDER BY id DESC').all(req.location.id).map(withPages));
});

router.post('/', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  let slug = slugify(name);
  let i = 1;
  while (db.prepare('SELECT id FROM funnels WHERE slug = ?').get(slug)) slug = `${slugify(name)}-${i++}`;
  const info = db.prepare('INSERT INTO funnels (location_id, name, slug) VALUES (?, ?, ?)').run(
    req.location.id, name, slug
  );
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
  db.prepare(
    'INSERT INTO funnel_pages (funnel_id, name, slug, position, published, content) VALUES (?, ?, ?, 0, 1, ?)'
  ).run(info.lastInsertRowid, 'Landing Page', 'home', JSON.stringify(defaultContent));
  res.status(201).json(withPages(db.prepare('SELECT * FROM funnels WHERE id = ?').get(info.lastInsertRowid)));
});

function getFunnel(req, res, next) {
  const funnel = db
    .prepare('SELECT * FROM funnels WHERE id = ? AND location_id = ?')
    .get(req.params.id, req.location.id);
  if (!funnel) return res.status(404).json({ error: 'Funnel not found' });
  req.funnel = funnel;
  next();
}

router.delete('/:id', getFunnel, (req, res) => {
  db.prepare('DELETE FROM funnels WHERE id = ?').run(req.funnel.id);
  res.json({ ok: true });
});

router.post('/:id/pages', getFunnel, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  let slug = slugify(name);
  let i = 1;
  while (db.prepare('SELECT id FROM funnel_pages WHERE funnel_id = ? AND slug = ?').get(req.funnel.id, slug))
    slug = `${slugify(name)}-${i++}`;
  const max = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM funnel_pages WHERE funnel_id = ?')
    .get(req.funnel.id).m;
  const info = db
    .prepare('INSERT INTO funnel_pages (funnel_id, name, slug, position, content) VALUES (?, ?, ?, ?, ?)')
    .run(req.funnel.id, name, slug, max + 1, '[]');
  const page = db.prepare('SELECT * FROM funnel_pages WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ...page, content: [] });
});

router.put('/:id/pages/:pageId', getFunnel, (req, res) => {
  const page = db
    .prepare('SELECT * FROM funnel_pages WHERE id = ? AND funnel_id = ?')
    .get(req.params.pageId, req.funnel.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const merged = { ...page, ...req.body };
  db.prepare('UPDATE funnel_pages SET name=?, published=?, content=? WHERE id=?').run(
    merged.name,
    merged.published ? 1 : 0,
    JSON.stringify(
      typeof merged.content === 'string' ? JSON.parse(merged.content) : merged.content || []
    ),
    page.id
  );
  const updated = db.prepare('SELECT * FROM funnel_pages WHERE id = ?').get(page.id);
  res.json({ ...updated, content: JSON.parse(updated.content) });
});

router.delete('/:id/pages/:pageId', getFunnel, (req, res) => {
  const info = db
    .prepare('DELETE FROM funnel_pages WHERE id = ? AND funnel_id = ?')
    .run(req.params.pageId, req.funnel.id);
  if (!info.changes) return res.status(404).json({ error: 'Page not found' });
  res.json({ ok: true });
});

router.get('/:id/submissions', getFunnel, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT fs.*, fp.name AS page_name, c.first_name, c.last_name, c.email AS contact_email
         FROM form_submissions fs
         JOIN funnel_pages fp ON fp.id = fs.funnel_page_id
         LEFT JOIN contacts c ON c.id = fs.contact_id
         WHERE fp.funnel_id = ? ORDER BY fs.created_at DESC LIMIT 200`
      )
      .all(req.funnel.id)
      .map((s) => ({ ...s, data: JSON.parse(s.data || '{}') }))
  );
});

module.exports = router;
