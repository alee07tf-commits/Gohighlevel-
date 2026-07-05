// Surveys: multi-question forms with conditional logic. Managed here; filled on
// the public /s/<slug> page (see public.js).
const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'encuesta';
}

const parse = (s) => { try { return JSON.parse(s.questions || '[]'); } catch { return []; } };

router.get('/', async (req, res) => {
  const rows = await db.all('SELECT * FROM surveys WHERE location_id = ? ORDER BY id DESC', [req.location.id]);
  const withCounts = await Promise.all(rows.map(async (s) => {
    const { n } = await db.get('SELECT COUNT(*)::int AS n FROM survey_responses WHERE survey_id = ?', [s.id]);
    return { ...s, questions: parse(s), responses: n };
  }));
  res.json(withCounts);
});

router.get('/:id', async (req, res) => {
  const s = await db.get('SELECT * FROM surveys WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!s) return res.status(404).json({ error: 'No encontrada' });
  const responses = await db.all(
    `SELECT sr.*, c.first_name, c.last_name, c.email FROM survey_responses sr
     LEFT JOIN contacts c ON c.id = sr.contact_id WHERE sr.survey_id = ? ORDER BY sr.id DESC LIMIT 200`,
    [s.id]
  );
  res.json({ ...s, questions: parse(s), responses: responses.map((r) => ({ ...r, answers: JSON.parse(r.answers || '{}') })) });
});

router.post('/', async (req, res) => {
  const { name, questions = [], tag } = req.body || {};
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  let slug = slugify(name), i = 2;
  while (await db.get('SELECT id FROM surveys WHERE slug = ?', [slug])) slug = `${slugify(name)}-${i++}`;
  const id = await db.insert(
    'INSERT INTO surveys (location_id, name, slug, questions, tag) VALUES (?, ?, ?, ?, ?)',
    [req.location.id, name, slug, JSON.stringify(Array.isArray(questions) ? questions : []), tag || '']
  );
  res.status(201).json(await db.get('SELECT * FROM surveys WHERE id = ?', [id]));
});

router.put('/:id', async (req, res) => {
  const s = await db.get('SELECT * FROM surveys WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!s) return res.status(404).json({ error: 'No encontrada' });
  const b = req.body || {};
  await db.run('UPDATE surveys SET name = ?, questions = ?, tag = ? WHERE id = ?', [
    b.name ?? s.name,
    b.questions !== undefined ? JSON.stringify(b.questions) : s.questions,
    b.tag !== undefined ? (b.tag || '') : s.tag,
    s.id,
  ]);
  res.json(await db.get('SELECT * FROM surveys WHERE id = ?', [s.id]));
});

router.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM surveys WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!info.changes) return res.status(404).json({ error: 'No encontrada' });
  res.json({ ok: true });
});

module.exports = router;
