const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

function slugKey(name) {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_|_$)/g, '') || 'field'
  );
}

router.get('/', async (req, res) => {
  res.json(await db.all('SELECT * FROM custom_fields WHERE location_id = ? ORDER BY id', [req.location.id]));
});

router.post('/', async (req, res) => {
  const { name, type } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  let key = slugKey(name);
  let i = 1;
  while (await db.get('SELECT id FROM custom_fields WHERE location_id = ? AND key = ?', [req.location.id, key]))
    key = `${slugKey(name)}_${i++}`;
  const id = await db.insert('INSERT INTO custom_fields (location_id, name, key, type) VALUES (?, ?, ?, ?)', [
    req.location.id,
    name,
    key,
    ['text', 'number', 'date'].includes(type) ? type : 'text',
  ]);
  res.status(201).json(await db.get('SELECT * FROM custom_fields WHERE id = ?', [id]));
});

router.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM custom_fields WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!info.changes) return res.status(404).json({ error: 'Field not found' });
  res.json({ ok: true });
});

module.exports = router;
