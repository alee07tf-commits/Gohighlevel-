// Community: an agency-level feed where the team (and client users under the
// agency) post updates and comment. Scoped to the caller's agency.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const isAdmin = (req) => req.user.role === 'admin';

// Feed: recent posts with author + comment count.
router.get('/', async (req, res) => {
  const posts = await db.all(
    `SELECT p.*, u.name AS author,
       (SELECT COUNT(*)::int FROM community_comments c WHERE c.post_id = p.id) AS comments
     FROM community_posts p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.agency_id = ? ORDER BY p.id DESC LIMIT 100`,
    [req.user.agency_id]
  );
  res.json(posts);
});

router.get('/:id', async (req, res) => {
  const post = await db.get(
    'SELECT p.*, u.name AS author FROM community_posts p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.agency_id = ?',
    [req.params.id, req.user.agency_id]
  );
  if (!post) return res.status(404).json({ error: 'No encontrado' });
  const comments = await db.all(
    'SELECT c.*, u.name AS author FROM community_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id',
    [post.id]
  );
  res.json({ ...post, comments });
});

router.post('/', async (req, res) => {
  const { title, body } = req.body || {};
  if (!body && !title) return res.status(400).json({ error: 'Escribe algo' });
  const id = await db.insert(
    'INSERT INTO community_posts (agency_id, user_id, title, body) VALUES (?, ?, ?, ?)',
    [req.user.agency_id, req.user.id, String(title || '').slice(0, 200), String(body || '').slice(0, 5000)]
  );
  res.status(201).json(await db.get('SELECT * FROM community_posts WHERE id = ?', [id]));
});

router.post('/:id/comments', async (req, res) => {
  const post = await db.get('SELECT id FROM community_posts WHERE id = ? AND agency_id = ?', [req.params.id, req.user.agency_id]);
  if (!post) return res.status(404).json({ error: 'No encontrado' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Comentario vacío' });
  const id = await db.insert(
    'INSERT INTO community_comments (post_id, user_id, body) VALUES (?, ?, ?)',
    [post.id, req.user.id, body.slice(0, 3000)]
  );
  res.status(201).json(await db.get('SELECT * FROM community_comments WHERE id = ?', [id]));
});

// Authors delete their own; admins can moderate anything in their agency.
router.delete('/:id', async (req, res) => {
  const post = await db.get('SELECT * FROM community_posts WHERE id = ? AND agency_id = ?', [req.params.id, req.user.agency_id]);
  if (!post) return res.status(404).json({ error: 'No encontrado' });
  if (post.user_id !== req.user.id && !isAdmin(req)) return res.status(403).json({ error: 'No autorizado' });
  await db.run('DELETE FROM community_posts WHERE id = ?', [post.id]);
  res.json({ ok: true });
});

router.delete('/comments/:id', async (req, res) => {
  const c = await db.get(
    `SELECT cc.* FROM community_comments cc JOIN community_posts p ON p.id = cc.post_id
     WHERE cc.id = ? AND p.agency_id = ?`,
    [req.params.id, req.user.agency_id]
  );
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  if (c.user_id !== req.user.id && !isAdmin(req)) return res.status(403).json({ error: 'No autorizado' });
  await db.run('DELETE FROM community_comments WHERE id = ?', [c.id]);
  res.json({ ok: true });
});

module.exports = router;
