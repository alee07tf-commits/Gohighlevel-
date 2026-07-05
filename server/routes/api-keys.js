// Public API keys (v3.0): external apps / Zapier / Make authenticate the REST
// API with these. The full secret is shown once on creation; only its SHA-256
// hash is stored. Management is JWT-admin only (never via an API key itself).
const express = require('express');
const db = require('../db');
const { requireAuth, generateApiKey } = require('../auth');

const router = express.Router();
router.use(requireAuth);

function jwtAdminOnly(req, res, next) {
  if (req.apiKey) return res.status(403).json({ error: 'No permitido con una API key' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  next();
}

router.get('/', jwtAdminOnly, async (req, res) => {
  const rows = await db.all(
    'SELECT id, name, prefix, last_used_at, created_at FROM api_keys WHERE agency_id = ? ORDER BY id DESC',
    [req.user.agency_id]
  );
  res.json(rows.map((r) => ({ ...r, masked: `${r.prefix}${'•'.repeat(8)}` })));
});

router.post('/', jwtAdminOnly, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { key, prefix, hash } = generateApiKey();
  const id = await db.insert('INSERT INTO api_keys (agency_id, name, prefix, key_hash) VALUES (?, ?, ?, ?)', [
    req.user.agency_id, name, prefix, hash,
  ]);
  // Full key returned ONLY here — it cannot be retrieved again.
  res.status(201).json({ id, name, prefix, key });
});

router.delete('/:id', jwtAdminOnly, async (req, res) => {
  const info = await db.run('DELETE FROM api_keys WHERE id = ? AND agency_id = ?', [req.params.id, req.user.agency_id]);
  if (!info.changes) return res.status(404).json({ error: 'API key not found' });
  res.json({ ok: true });
});

module.exports = router;
