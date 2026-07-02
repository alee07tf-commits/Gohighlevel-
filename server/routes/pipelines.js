const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const automation = require('../services/automation');

const router = express.Router();
router.use(requireAuth, requireLocation);

// ---- Pipelines & stages ----
router.get('/', (req, res) => {
  const pipelines = db.prepare('SELECT * FROM pipelines WHERE location_id = ? ORDER BY id').all(req.location.id);
  res.json(
    pipelines.map((p) => ({
      ...p,
      stages: db.prepare('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY position').all(p.id),
    }))
  );
});

router.post('/', (req, res) => {
  const { name, stages } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db.prepare('INSERT INTO pipelines (location_id, name) VALUES (?, ?)').run(req.location.id, name);
  const stageNames = stages && stages.length ? stages : ['New Lead', 'Contacted', 'Qualified', 'Won'];
  stageNames.forEach((s, i) =>
    db.prepare('INSERT INTO stages (pipeline_id, name, position) VALUES (?, ?, ?)').run(info.lastInsertRowid, s, i)
  );
  res.status(201).json({
    ...db.prepare('SELECT * FROM pipelines WHERE id = ?').get(info.lastInsertRowid),
    stages: db.prepare('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY position').all(info.lastInsertRowid),
  });
});

function getPipeline(req, res, next) {
  const pipeline = db
    .prepare('SELECT * FROM pipelines WHERE id = ? AND location_id = ?')
    .get(req.params.id, req.location.id);
  if (!pipeline) return res.status(404).json({ error: 'Pipeline not found' });
  req.pipeline = pipeline;
  next();
}

router.put('/:id', getPipeline, (req, res) => {
  if (req.body.name) db.prepare('UPDATE pipelines SET name = ? WHERE id = ?').run(req.body.name, req.pipeline.id);
  res.json(db.prepare('SELECT * FROM pipelines WHERE id = ?').get(req.pipeline.id));
});

router.delete('/:id', getPipeline, (req, res) => {
  db.prepare('DELETE FROM pipelines WHERE id = ?').run(req.pipeline.id);
  res.json({ ok: true });
});

router.post('/:id/stages', getPipeline, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM stages WHERE pipeline_id = ?').get(req.pipeline.id).m;
  const info = db
    .prepare('INSERT INTO stages (pipeline_id, name, position) VALUES (?, ?, ?)')
    .run(req.pipeline.id, name, max + 1);
  res.status(201).json(db.prepare('SELECT * FROM stages WHERE id = ?').get(info.lastInsertRowid));
});

// ---- Opportunities ----
router.get('/:id/opportunities', getPipeline, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT o.*, c.first_name, c.last_name, c.email FROM opportunities o
         LEFT JOIN contacts c ON c.id = o.contact_id
         WHERE o.pipeline_id = ? ORDER BY o.created_at DESC`
      )
      .all(req.pipeline.id)
  );
});

router.post('/:id/opportunities', getPipeline, (req, res) => {
  const { title, value, contact_id, stage_id } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  const stage = stage_id
    ? db.prepare('SELECT * FROM stages WHERE id = ? AND pipeline_id = ?').get(stage_id, req.pipeline.id)
    : db.prepare('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY position LIMIT 1').get(req.pipeline.id);
  if (!stage) return res.status(400).json({ error: 'Pipeline has no stages' });
  const info = db
    .prepare(
      `INSERT INTO opportunities (location_id, pipeline_id, stage_id, contact_id, title, value)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.location.id, req.pipeline.id, stage.id, contact_id || null, title, Number(value) || 0);
  if (contact_id) automation.logActivity(req.location.id, contact_id, 'opportunity', `Opportunity "${title}" created`);
  res.status(201).json(db.prepare('SELECT * FROM opportunities WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/opportunities/:oppId', (req, res) => {
  const opp = db
    .prepare('SELECT * FROM opportunities WHERE id = ? AND location_id = ?')
    .get(req.params.oppId, req.location.id);
  if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
  const merged = { ...opp, ...req.body };
  if (req.body.stage_id) {
    const stage = db
      .prepare('SELECT * FROM stages WHERE id = ? AND pipeline_id = ?')
      .get(req.body.stage_id, opp.pipeline_id);
    if (!stage) return res.status(400).json({ error: 'Stage does not belong to this pipeline' });
  }
  db.prepare(
    `UPDATE opportunities SET title=?, value=?, stage_id=?, status=?, contact_id=?, updated_at=datetime('now') WHERE id=?`
  ).run(merged.title, Number(merged.value) || 0, merged.stage_id, merged.status, merged.contact_id, opp.id);

  if (req.body.stage_id && Number(req.body.stage_id) !== opp.stage_id && opp.contact_id) {
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(opp.contact_id);
    const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(req.body.stage_id);
    automation.logActivity(req.location.id, opp.contact_id, 'opportunity', `Opportunity moved to "${stage.name}"`);
    automation.trigger(req.location.id, 'opportunity_stage_changed', contact, { stage_id: stage.id });
  }
  res.json(db.prepare('SELECT * FROM opportunities WHERE id = ?').get(opp.id));
});

router.delete('/opportunities/:oppId', (req, res) => {
  const info = db
    .prepare('DELETE FROM opportunities WHERE id = ? AND location_id = ?')
    .run(req.params.oppId, req.location.id);
  if (!info.changes) return res.status(404).json({ error: 'Opportunity not found' });
  res.json({ ok: true });
});

module.exports = router;
