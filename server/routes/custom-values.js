// Custom Values: account-level constants referenced as {{custom_values.KEY}}
// across funnels, emails and SMS — filled in once per sub-account so a single
// snapshot template works for every client ("fill in the blanks" onboarding).
const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

function slugKey(text, fallback) {
  return (
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_|_$)/g, '') || fallback
  );
}

router.get('/', async (req, res) => {
  res.json(
    await db.all('SELECT id, key, label, value FROM custom_values WHERE location_id = ? ORDER BY id', [req.location.id])
  );
});

router.post('/', async (req, res) => {
  const { label, value } = req.body || {};
  let key = req.body?.key ? slugKey(req.body.key) : slugKey(label);
  if (!key) return res.status(400).json({ error: 'key or label is required' });
  // De-dup the key within this location.
  let base = key;
  let i = 1;
  while (await db.get('SELECT id FROM custom_values WHERE location_id = ? AND key = ?', [req.location.id, key]))
    key = `${base}_${i++}`;
  const id = await db.insert('INSERT INTO custom_values (location_id, key, label, value) VALUES (?, ?, ?, ?)', [
    req.location.id, key, label || key, value || '',
  ]);
  res.status(201).json(await db.get('SELECT id, key, label, value FROM custom_values WHERE id = ?', [id]));
});

router.put('/:id', async (req, res) => {
  const cv = await db.get('SELECT * FROM custom_values WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!cv) return res.status(404).json({ error: 'Custom value not found' });
  await db.run('UPDATE custom_values SET label = ?, value = ? WHERE id = ?', [
    req.body?.label ?? cv.label,
    req.body?.value ?? cv.value,
    cv.id,
  ]);
  res.json(await db.get('SELECT id, key, label, value FROM custom_values WHERE id = ?', [cv.id]));
});

router.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM custom_values WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!info.changes) return res.status(404).json({ error: 'Custom value not found' });
  res.json({ ok: true });
});

module.exports = router;
