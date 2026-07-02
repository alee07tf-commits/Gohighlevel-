const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

const TRIGGER_TYPES = [
  'contact_created',
  'tag_added',
  'form_submitted',
  'appointment_booked',
  'opportunity_stage_changed',
];
const ACTION_TYPES = ['add_tag', 'remove_tag', 'send_email', 'send_sms', 'add_note', 'create_opportunity'];

function withActions(wf) {
  return {
    ...wf,
    trigger_config: JSON.parse(wf.trigger_config || '{}'),
    actions: db
      .prepare('SELECT * FROM workflow_actions WHERE workflow_id = ? ORDER BY position')
      .all(wf.id)
      .map((a) => ({ ...a, config: JSON.parse(a.config || '{}') })),
    run_count: db.prepare('SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_id = ?').get(wf.id).n,
  };
}

router.get('/meta', (req, res) => res.json({ triggers: TRIGGER_TYPES, actions: ACTION_TYPES }));

router.get('/', (req, res) => {
  res.json(
    db.prepare('SELECT * FROM workflows WHERE location_id = ? ORDER BY id DESC').all(req.location.id).map(withActions)
  );
});

router.post('/', (req, res) => {
  const { name, trigger_type, trigger_config, actions, active } = req.body || {};
  if (!name || !trigger_type) return res.status(400).json({ error: 'name and trigger_type are required' });
  if (!TRIGGER_TYPES.includes(trigger_type))
    return res.status(400).json({ error: `trigger_type must be one of: ${TRIGGER_TYPES.join(', ')}` });
  for (const a of actions || []) {
    if (!ACTION_TYPES.includes(a.type))
      return res.status(400).json({ error: `Invalid action type "${a.type}"` });
  }
  const wfId = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO workflows (location_id, name, trigger_type, trigger_config, active) VALUES (?, ?, ?, ?, ?)')
      .run(req.location.id, name, trigger_type, JSON.stringify(trigger_config || {}), active === false ? 0 : 1);
    (actions || []).forEach((a, i) =>
      db.prepare('INSERT INTO workflow_actions (workflow_id, position, type, config) VALUES (?, ?, ?, ?)').run(
        info.lastInsertRowid, i, a.type, JSON.stringify(a.config || {})
      )
    );
    return info.lastInsertRowid;
  })();
  res.status(201).json(withActions(db.prepare('SELECT * FROM workflows WHERE id = ?').get(wfId)));
});

function getWorkflow(req, res, next) {
  const wf = db
    .prepare('SELECT * FROM workflows WHERE id = ? AND location_id = ?')
    .get(req.params.id, req.location.id);
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  req.workflow = wf;
  next();
}

// Full update: replaces name/trigger/active and the action list.
router.put('/:id', getWorkflow, (req, res) => {
  const { name, trigger_type, trigger_config, actions, active } = req.body || {};
  if (trigger_type && !TRIGGER_TYPES.includes(trigger_type))
    return res.status(400).json({ error: 'Invalid trigger_type' });
  db.transaction(() => {
    db.prepare('UPDATE workflows SET name=?, trigger_type=?, trigger_config=?, active=? WHERE id=?').run(
      name || req.workflow.name,
      trigger_type || req.workflow.trigger_type,
      JSON.stringify(trigger_config !== undefined ? trigger_config : JSON.parse(req.workflow.trigger_config)),
      active === undefined ? req.workflow.active : active ? 1 : 0,
      req.workflow.id
    );
    if (actions !== undefined) {
      db.prepare('DELETE FROM workflow_actions WHERE workflow_id = ?').run(req.workflow.id);
      actions.forEach((a, i) =>
        db.prepare('INSERT INTO workflow_actions (workflow_id, position, type, config) VALUES (?, ?, ?, ?)').run(
          req.workflow.id, i, a.type, JSON.stringify(a.config || {})
        )
      );
    }
  })();
  res.json(withActions(db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.workflow.id)));
});

router.delete('/:id', getWorkflow, (req, res) => {
  db.prepare('DELETE FROM workflows WHERE id = ?').run(req.workflow.id);
  res.json({ ok: true });
});

router.get('/:id/runs', getWorkflow, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT r.*, c.first_name, c.last_name FROM workflow_runs r
         LEFT JOIN contacts c ON c.id = r.contact_id
         WHERE r.workflow_id = ? ORDER BY r.created_at DESC LIMIT 100`
      )
      .all(req.workflow.id)
      .map((r) => ({ ...r, log: JSON.parse(r.log || '[]') }))
  );
});

module.exports = router;
