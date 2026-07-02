const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const automation = require('../services/automation');

const router = express.Router();
router.use(requireAuth, requireLocation);

async function stagesOf(pipelineId) {
  return db.all('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY position', [pipelineId]);
}

// ---- Pipelines & stages ----
router.get('/', async (req, res) => {
  const pipelines = await db.all('SELECT * FROM pipelines WHERE location_id = ? ORDER BY id', [req.location.id]);
  res.json(await Promise.all(pipelines.map(async (p) => ({ ...p, stages: await stagesOf(p.id) }))));
});

router.post('/', async (req, res) => {
  const { name, stages } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = await db.insert('INSERT INTO pipelines (location_id, name) VALUES (?, ?)', [req.location.id, name]);
  const stageNames = stages && stages.length ? stages : ['New Lead', 'Contacted', 'Qualified', 'Won'];
  for (let i = 0; i < stageNames.length; i++) {
    await db.run('INSERT INTO stages (pipeline_id, name, position) VALUES (?, ?, ?)', [id, stageNames[i], i]);
  }
  res.status(201).json({
    ...(await db.get('SELECT * FROM pipelines WHERE id = ?', [id])),
    stages: await stagesOf(id),
  });
});

async function getPipeline(req, res, next) {
  const pipeline = await db.get('SELECT * FROM pipelines WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!pipeline) return res.status(404).json({ error: 'Pipeline not found' });
  req.pipeline = pipeline;
  next();
}

router.put('/:id', getPipeline, async (req, res) => {
  if (req.body.name) await db.run('UPDATE pipelines SET name = ? WHERE id = ?', [req.body.name, req.pipeline.id]);
  res.json(await db.get('SELECT * FROM pipelines WHERE id = ?', [req.pipeline.id]));
});

router.delete('/:id', getPipeline, async (req, res) => {
  await db.run('DELETE FROM pipelines WHERE id = ?', [req.pipeline.id]);
  res.json({ ok: true });
});

router.post('/:id/stages', getPipeline, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { m } = await db.get('SELECT COALESCE(MAX(position), -1) AS m FROM stages WHERE pipeline_id = ?', [
    req.pipeline.id,
  ]);
  const id = await db.insert('INSERT INTO stages (pipeline_id, name, position) VALUES (?, ?, ?)', [
    req.pipeline.id,
    name,
    m + 1,
  ]);
  res.status(201).json(await db.get('SELECT * FROM stages WHERE id = ?', [id]));
});

// ---- Opportunities ----
router.get('/:id/opportunities', getPipeline, async (req, res) => {
  res.json(
    await db.all(
      `SELECT o.*, c.first_name, c.last_name, c.email FROM opportunities o
       LEFT JOIN contacts c ON c.id = o.contact_id
       WHERE o.pipeline_id = ? ORDER BY o.created_at DESC`,
      [req.pipeline.id]
    )
  );
});

router.post('/:id/opportunities', getPipeline, async (req, res) => {
  const { title, value, contact_id, stage_id } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  const stage = stage_id
    ? await db.get('SELECT * FROM stages WHERE id = ? AND pipeline_id = ?', [stage_id, req.pipeline.id])
    : await db.get('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY position LIMIT 1', [req.pipeline.id]);
  if (!stage) return res.status(400).json({ error: 'Pipeline has no stages' });
  const id = await db.insert(
    `INSERT INTO opportunities (location_id, pipeline_id, stage_id, contact_id, title, value)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.location.id, req.pipeline.id, stage.id, contact_id || null, title, Number(value) || 0]
  );
  if (contact_id)
    await automation.logActivity(req.location.id, contact_id, 'opportunity', `Opportunity "${title}" created`);
  res.status(201).json(await db.get('SELECT * FROM opportunities WHERE id = ?', [id]));
});

router.put('/opportunities/:oppId', async (req, res) => {
  const opp = await db.get('SELECT * FROM opportunities WHERE id = ? AND location_id = ?', [
    req.params.oppId,
    req.location.id,
  ]);
  if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
  const merged = { ...opp, ...req.body };
  if (req.body.stage_id) {
    const stage = await db.get('SELECT * FROM stages WHERE id = ? AND pipeline_id = ?', [
      req.body.stage_id,
      opp.pipeline_id,
    ]);
    if (!stage) return res.status(400).json({ error: 'Stage does not belong to this pipeline' });
  }
  await db.run(
    `UPDATE opportunities SET title=?, value=?, stage_id=?, status=?, contact_id=?, updated_at=now() WHERE id=?`,
    [merged.title, Number(merged.value) || 0, merged.stage_id, merged.status, merged.contact_id, opp.id]
  );

  if (req.body.stage_id && Number(req.body.stage_id) !== opp.stage_id && opp.contact_id) {
    const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [opp.contact_id]);
    const stage = await db.get('SELECT * FROM stages WHERE id = ?', [req.body.stage_id]);
    await automation.logActivity(req.location.id, opp.contact_id, 'opportunity', `Opportunity moved to "${stage.name}"`);
    await automation.trigger(req.location.id, 'opportunity_stage_changed', contact, { stage_id: stage.id });
  }
  res.json(await db.get('SELECT * FROM opportunities WHERE id = ?', [opp.id]));
});

router.delete('/opportunities/:oppId', async (req, res) => {
  const info = await db.run('DELETE FROM opportunities WHERE id = ? AND location_id = ?', [
    req.params.oppId,
    req.location.id,
  ]);
  if (!info.changes) return res.status(404).json({ error: 'Opportunity not found' });
  res.json({ ok: true });
});

module.exports = router;
