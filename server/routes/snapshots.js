// Snapshots: an agency-level library of reusable sub-account templates. Create
// a snapshot from any sub-account, mark one as the default (auto-loaded when a
// new sub-account is created), and apply a snapshot into any sub-account — the
// "deploy a client in minutes" feature agencies use to productize their setup.
// JSON export/import is kept for portability between deployments.
const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const snapshots = require('../services/snapshots');

const router = express.Router();
router.use(requireAuth);

// Resolve a location id and verify it belongs to the caller's agency.
async function ownedLocation(req, id) {
  if (!id) return null;
  return db.get('SELECT * FROM locations WHERE id = ? AND agency_id = ?', [id, req.user.agency_id]);
}

function assetCounts(data = {}) {
  return {
    pipelines: (data.pipelines || []).length,
    workflows: (data.workflows || []).length,
    funnels: (data.funnels || []).length,
    calendars: (data.calendars || []).length,
    email_templates: (data.email_templates || []).length,
    custom_fields: (data.custom_fields || []).length,
    custom_values: (data.custom_values || []).length,
    trigger_links: (data.trigger_links || []).length,
  };
}

// ---- Agency snapshot library ----
router.get('/', async (req, res) => {
  const rows = await db.all(
    'SELECT id, name, description, is_default, created_at, updated_at, data FROM snapshots WHERE agency_id = ? ORDER BY is_default DESC, id DESC',
    [req.user.agency_id]
  );
  res.json(
    rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      is_default: !!s.is_default,
      created_at: s.created_at,
      updated_at: s.updated_at,
      counts: assetCounts((() => { try { return JSON.parse(s.data || '{}'); } catch { return {}; } })()),
    }))
  );
});

router.post('/', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { name, description, from_location_id, is_default } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const loc = await ownedLocation(req, from_location_id);
  if (!loc) return res.status(400).json({ error: 'from_location_id (a valid sub-account) is required' });
  const data = await snapshots.serializeLocation(db, loc.id);
  const id = await db.tx(async (t) => {
    if (is_default) await t.run('UPDATE snapshots SET is_default = 0 WHERE agency_id = ?', [req.user.agency_id]);
    return t.insert(
      'INSERT INTO snapshots (agency_id, name, description, data, is_default) VALUES (?, ?, ?, ?, ?)',
      [req.user.agency_id, name, description || '', JSON.stringify(data), is_default ? 1 : 0]
    );
  });
  res.status(201).json({ id, counts: assetCounts(data) });
});

router.put('/:id', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const snap = await db.get('SELECT * FROM snapshots WHERE id = ? AND agency_id = ?', [req.params.id, req.user.agency_id]);
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
  const { name, description, is_default, recapture_from_location_id } = req.body || {};
  let data = snap.data;
  if (recapture_from_location_id) {
    const loc = await ownedLocation(req, recapture_from_location_id);
    if (!loc) return res.status(400).json({ error: 'recapture_from_location_id is not a valid sub-account' });
    data = JSON.stringify(await snapshots.serializeLocation(db, loc.id));
  }
  await db.tx(async (t) => {
    if (is_default) await t.run('UPDATE snapshots SET is_default = 0 WHERE agency_id = ?', [req.user.agency_id]);
    await t.run(
      'UPDATE snapshots SET name = ?, description = ?, data = ?, is_default = ?, updated_at = now() WHERE id = ?',
      [
        name ?? snap.name,
        description ?? snap.description,
        data,
        is_default != null ? (is_default ? 1 : 0) : snap.is_default,
        snap.id,
      ]
    );
  });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const info = await db.run('DELETE FROM snapshots WHERE id = ? AND agency_id = ?', [req.params.id, req.user.agency_id]);
  if (!info.changes) return res.status(404).json({ error: 'Snapshot not found' });
  res.json({ ok: true });
});

// Apply a stored snapshot into a target sub-account.
router.post('/:id/apply', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const snap = await db.get('SELECT * FROM snapshots WHERE id = ? AND agency_id = ?', [req.params.id, req.user.agency_id]);
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
  const loc = await ownedLocation(req, req.body?.location_id);
  if (!loc) return res.status(400).json({ error: 'location_id (a valid sub-account) is required' });
  const data = (() => { try { return JSON.parse(snap.data || '{}'); } catch { return {}; } })();
  const counts = await db.tx((t) => snapshots.applySnapshot(t, loc.id, data));
  res.json({ ok: true, applied: counts });
});

// ---- JSON portability (between deployments) ----
router.get('/export', requireLocation, async (req, res) => {
  const data = await snapshots.serializeLocation(db, req.location.id);
  res.json({ ...data, name: req.location.name, exported_at: new Date().toISOString() });
});

router.post('/import', requireLocation, async (req, res) => {
  const snap = req.body || {};
  // Accept the new 'upcro-snapshot' kind and the legacy 'leadflow-snapshot' for
  // backward compatibility with exports made before the rebrand.
  if (snap.kind !== 'upcro-snapshot' && snap.kind !== 'leadflow-snapshot')
    return res.status(400).json({ error: 'Not a valid Upcro snapshot' });
  const counts = await db.tx((t) => snapshots.applySnapshot(t, req.location.id, snap));
  res.json({ ok: true, imported: counts });
});

module.exports = router;
