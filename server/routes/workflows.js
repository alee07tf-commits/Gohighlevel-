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
  'message_received',
];
const ACTION_TYPES = [
  'add_tag',
  'remove_tag',
  'send_email',
  'send_sms',
  'send_whatsapp',
  'add_note',
  'create_opportunity',
  'wait',
];

async function withActions(wf) {
  const actions = await db.all('SELECT * FROM workflow_actions WHERE workflow_id = ? ORDER BY position', [wf.id]);
  return {
    ...wf,
    trigger_config: JSON.parse(wf.trigger_config || '{}'),
    actions: actions.map((a) => ({ ...a, config: JSON.parse(a.config || '{}') })),
    run_count: (await db.get('SELECT COUNT(*)::int AS n FROM workflow_runs WHERE workflow_id = ?', [wf.id])).n,
  };
}

router.get('/meta', (req, res) => res.json({ triggers: TRIGGER_TYPES, actions: ACTION_TYPES }));

router.get('/', async (req, res) => {
  const workflows = await db.all('SELECT * FROM workflows WHERE location_id = ? ORDER BY id DESC', [req.location.id]);
  res.json(await Promise.all(workflows.map(withActions)));
});

router.post('/', async (req, res) => {
  const { name, trigger_type, trigger_config, actions, active } = req.body || {};
  if (!name || !trigger_type) return res.status(400).json({ error: 'name and trigger_type are required' });
  if (!TRIGGER_TYPES.includes(trigger_type))
    return res.status(400).json({ error: `trigger_type must be one of: ${TRIGGER_TYPES.join(', ')}` });
  for (const a of actions || []) {
    if (!ACTION_TYPES.includes(a.type)) return res.status(400).json({ error: `Invalid action type "${a.type}"` });
  }
  const wfId = await db.tx(async (t) => {
    const id = await t.insert(
      'INSERT INTO workflows (location_id, name, trigger_type, trigger_config, active) VALUES (?, ?, ?, ?, ?)',
      [req.location.id, name, trigger_type, JSON.stringify(trigger_config || {}), active === false ? 0 : 1]
    );
    const list = actions || [];
    for (let i = 0; i < list.length; i++) {
      await t.run('INSERT INTO workflow_actions (workflow_id, position, type, config) VALUES (?, ?, ?, ?)', [
        id,
        i,
        list[i].type,
        JSON.stringify(list[i].config || {}),
      ]);
    }
    return id;
  });
  res.status(201).json(await withActions(await db.get('SELECT * FROM workflows WHERE id = ?', [wfId])));
});

async function getWorkflow(req, res, next) {
  const wf = await db.get('SELECT * FROM workflows WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  req.workflow = wf;
  next();
}

// Full update: replaces name/trigger/active and the action list.
router.put('/:id', getWorkflow, async (req, res) => {
  const { name, trigger_type, trigger_config, actions, active } = req.body || {};
  if (trigger_type && !TRIGGER_TYPES.includes(trigger_type))
    return res.status(400).json({ error: 'Invalid trigger_type' });
  await db.tx(async (t) => {
    await t.run('UPDATE workflows SET name=?, trigger_type=?, trigger_config=?, active=? WHERE id=?', [
      name || req.workflow.name,
      trigger_type || req.workflow.trigger_type,
      JSON.stringify(trigger_config !== undefined ? trigger_config : JSON.parse(req.workflow.trigger_config)),
      active === undefined ? req.workflow.active : active ? 1 : 0,
      req.workflow.id,
    ]);
    if (actions !== undefined) {
      await t.run('DELETE FROM workflow_actions WHERE workflow_id = ?', [req.workflow.id]);
      for (let i = 0; i < actions.length; i++) {
        await t.run('INSERT INTO workflow_actions (workflow_id, position, type, config) VALUES (?, ?, ?, ?)', [
          req.workflow.id,
          i,
          actions[i].type,
          JSON.stringify(actions[i].config || {}),
        ]);
      }
    }
  });
  res.json(await withActions(await db.get('SELECT * FROM workflows WHERE id = ?', [req.workflow.id])));
});

router.delete('/:id', getWorkflow, async (req, res) => {
  await db.run('DELETE FROM workflows WHERE id = ?', [req.workflow.id]);
  res.json({ ok: true });
});

router.get('/:id/runs', getWorkflow, async (req, res) => {
  const runs = await db.all(
    `SELECT r.*, c.first_name, c.last_name FROM workflow_runs r
     LEFT JOIN contacts c ON c.id = r.contact_id
     WHERE r.workflow_id = ? ORDER BY r.created_at DESC LIMIT 100`,
    [req.workflow.id]
  );
  res.json(runs.map((r) => ({ ...r, log: JSON.parse(r.log || '[]') })));
});

module.exports = router;
