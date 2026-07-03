const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const automation = require('../services/automation');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/', async (req, res) => {
  const { status = 'open', contact_id } = req.query;
  let sql = `SELECT t.*, c.first_name, c.last_name, u.name AS user_name FROM tasks t
             LEFT JOIN contacts c ON c.id = t.contact_id
             LEFT JOIN users u ON u.id = t.user_id
             WHERE t.location_id = ?`;
  const params = [req.location.id];
  if (status !== 'all') { sql += ' AND t.status = ?'; params.push(status); }
  if (contact_id) { sql += ' AND t.contact_id = ?'; params.push(contact_id); }
  sql += ' ORDER BY t.due_at NULLS LAST, t.id DESC LIMIT 300';
  res.json(await db.all(sql, params));
});

router.post('/', async (req, res) => {
  const { title, notes, due_at, contact_id, user_id } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  const id = await db.insert(
    'INSERT INTO tasks (location_id, contact_id, user_id, title, notes, due_at) VALUES (?, ?, ?, ?, ?, ?)',
    [req.location.id, contact_id || null, user_id || req.user.id, title, notes || '', due_at || null]
  );
  if (contact_id) await automation.logActivity(req.location.id, contact_id, 'note', `Task created: ${title}`);
  res.status(201).json(await db.get('SELECT * FROM tasks WHERE id = ?', [id]));
});

router.put('/:id', async (req, res) => {
  const task = await db.get('SELECT * FROM tasks WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const merged = { ...task, ...req.body };
  await db.run('UPDATE tasks SET title=?, notes=?, due_at=?, status=?, user_id=? WHERE id=?', [
    merged.title,
    merged.notes,
    merged.due_at || null,
    merged.status === 'done' ? 'done' : 'open',
    merged.user_id || null,
    task.id,
  ]);
  res.json(await db.get('SELECT * FROM tasks WHERE id = ?', [task.id]));
});

router.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM tasks WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!info.changes) return res.status(404).json({ error: 'Task not found' });
  res.json({ ok: true });
});

module.exports = router;
