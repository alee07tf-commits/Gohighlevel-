// Saved replies (snippets) for the inbox — canned responses agents insert into
// the composer. Support merge fields like the rest of messaging.
const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/', async (req, res) => {
  res.json(await db.all('SELECT * FROM snippets WHERE location_id = ? ORDER BY title', [req.location.id]));
});

router.post('/', async (req, res) => {
  const { title, body } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  const id = await db.insert('INSERT INTO snippets (location_id, title, body) VALUES (?, ?, ?)', [req.location.id, title, body || '']);
  res.status(201).json(await db.get('SELECT * FROM snippets WHERE id = ?', [id]));
});

router.put('/:id', async (req, res) => {
  const s = await db.get('SELECT * FROM snippets WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!s) return res.status(404).json({ error: 'Snippet not found' });
  await db.run('UPDATE snippets SET title = ?, body = ? WHERE id = ?', [req.body?.title ?? s.title, req.body?.body ?? s.body, s.id]);
  res.json(await db.get('SELECT * FROM snippets WHERE id = ?', [s.id]));
});

router.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM snippets WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!info.changes) return res.status(404).json({ error: 'Snippet not found' });
  res.json({ ok: true });
});

module.exports = router;
