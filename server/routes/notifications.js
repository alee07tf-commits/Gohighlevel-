// In-app notification center (bell). Scoped to the authenticated user.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Recent notifications for the current user (+ unread count).
router.get('/', async (req, res) => {
  const rows = await db.all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30',
    [req.user.id]
  );
  const { n } = await db.get('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND read = 0', [req.user.id]);
  res.json({ notifications: rows, unread: n });
});

// Lightweight unread count for polling the badge.
router.get('/unread-count', async (req, res) => {
  const { n } = await db.get('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND read = 0', [req.user.id]);
  res.json({ unread: n });
});

router.post('/:id/read', async (req, res) => {
  await db.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.post('/read-all', async (req, res) => {
  await db.run('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0', [req.user.id]);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await db.run('DELETE FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
