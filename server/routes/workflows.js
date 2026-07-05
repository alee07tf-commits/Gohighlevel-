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
  'invoice_paid',
  'appointment_status_changed',
  'review_received',
  'note_added',
  'task_completed',
];
const ACTION_TYPES = [
  'add_tag',
  'remove_tag',
  'send_email',
  'send_sms',
  'send_whatsapp',
  'add_note',
  'create_opportunity',
  'update_field',
  'assign_owner',
  'set_dnd',
  'enroll_workflow',
  'notify_user',
  'wait',
  'branch',
  'create_task',
  'send_review_request',
  'webhook',
];

function parseJSON(raw, fallback) {
  try {
    return JSON.parse(raw || fallback);
  } catch {
    return JSON.parse(fallback);
  }
}

async function withActions(wf) {
  const [actions, runs] = await Promise.all([
    db.all('SELECT * FROM workflow_actions WHERE workflow_id = ? ORDER BY position', [wf.id]),
    db.get('SELECT COUNT(*)::int AS n FROM workflow_runs WHERE workflow_id = ?', [wf.id]),
  ]);
  return {
    ...wf,
    trigger_config: parseJSON(wf.trigger_config, '{}'),
    actions: actions.map((a) => ({ ...a, config: parseJSON(a.config, '{}') })),
    run_count: runs.n,
  };
}

// Hydrates many workflows with two grouped queries instead of 2 per workflow.
async function withActionsBulk(workflows) {
  if (!workflows.length) return [];
  const ids = workflows.map((w) => w.id);
  const ph = ids.map(() => '?').join(',');
  const [actionRows, runRows] = await Promise.all([
    db.all(`SELECT * FROM workflow_actions WHERE workflow_id IN (${ph}) ORDER BY workflow_id, position`, ids),
    db.all(`SELECT workflow_id, COUNT(*)::int AS n FROM workflow_runs WHERE workflow_id IN (${ph}) GROUP BY workflow_id`, ids),
  ]);
  const actByWf = {};
  for (const a of actionRows) (actByWf[a.workflow_id] || (actByWf[a.workflow_id] = [])).push({ ...a, config: parseJSON(a.config, '{}') });
  const runByWf = Object.fromEntries(runRows.map((r) => [r.workflow_id, r.n]));
  return workflows.map((wf) => ({
    ...wf,
    trigger_config: parseJSON(wf.trigger_config, '{}'),
    actions: actByWf[wf.id] || [],
    run_count: runByWf[wf.id] || 0,
  }));
}


// Prebuilt workflow recipes (Spanish-first) installable with one click.
const RECIPES = [
  {
    key: 'lead-nurture',
    name: 'Bienvenida a nuevos leads',
    description: 'Cuando entra un contacto: etiqueta, email + WhatsApp de bienvenida y oportunidad en el pipeline.',
    trigger_type: 'contact_created',
    trigger_config: {},
    actions: [
      { type: 'add_tag', config: { tag: 'lead' } },
      { type: 'send_email', config: { subject: 'Bienvenido/a, {{first_name}}', body: 'Hola {{first_name}},\n\nGracias por tu interes. En breve un miembro del equipo te contactara.\n\nUn saludo' } },
      { type: 'send_whatsapp', config: { body: 'Hola {{first_name}}! Recibimos tus datos, te llamamos en breve.' } },
      { type: 'create_opportunity', config: { title: 'Nuevo lead - {{first_name}} {{last_name}}', value: 0 } },
    ],
  },
  {
    key: 'no-show-recovery',
    name: 'Recuperar citas perdidas (no-show)',
    description: 'Cuando una cita se marca como no-show: mensaje para reagendar + tarea de seguimiento.',
    trigger_type: 'appointment_status_changed',
    trigger_config: { status: 'no_show' },
    actions: [
      { type: 'send_sms', config: { body: 'Hola {{first_name}}, te esperamos hoy y no pudiste venir. Sin problema! Responde a este mensaje y te reagendamos.' } },
      { type: 'create_task', config: { title: 'Llamar a {{first_name}} para reagendar (no-show)', due_in_days: 1 } },
      { type: 'add_tag', config: { tag: 'no-show' } },
    ],
  },
  {
    key: 'review-after-visit',
    name: 'Pedir resena tras la cita',
    description: 'Cuando la cita se completa: espera 2 horas y envia solicitud de resena con filtro (4-5 estrellas -> Google).',
    trigger_type: 'appointment_status_changed',
    trigger_config: { status: 'completed' },
    actions: [
      { type: 'wait', config: { amount: 2, unit: 'hours' } },
      { type: 'send_review_request', config: { channel: 'sms' } },
    ],
  },
  {
    key: 'invoice-thanks',
    name: 'Agradecer el pago + resena',
    description: 'Cuando se paga una factura: agradecimiento inmediato, y peticion de resena al dia siguiente.',
    trigger_type: 'invoice_paid',
    trigger_config: {},
    actions: [
      { type: 'send_email', config: { subject: 'Pago recibido - gracias {{first_name}}!', body: 'Hola {{first_name}},\n\nHemos recibido tu pago correctamente. Gracias por confiar en nosotros!\n\nUn saludo' } },
      { type: 'wait', config: { amount: 1, unit: 'days' } },
      { type: 'send_review_request', config: { channel: 'email' } },
    ],
  },
  {
    key: 'hot-lead-alert',
    name: 'Seguimiento a lead que responde',
    description: 'Cuando el contacto responde un mensaje: si ya es cliente no hace nada; si es lead, tarea urgente de llamada.',
    trigger_type: 'message_received',
    trigger_config: {},
    actions: [
      {
        type: 'branch',
        config: {
          field: 'tag', op: 'has', value: 'customer',
          then: [],
          otherwise: [
            { type: 'create_task', config: { title: 'LLAMAR YA: {{first_name}} respondio un mensaje', due_in_days: 0 } },
            { type: 'add_tag', config: { tag: 'caliente' } },
          ],
        },
      },
    ],
  },
  {
    key: 'reactivation-30d',
    name: 'Reactivacion de leads frios (30 dias)',
    description: 'Al etiquetar como "frio": espera 30 dias y envia oferta de reactivacion por email y WhatsApp.',
    trigger_type: 'tag_added',
    trigger_config: { tag: 'frio' },
    actions: [
      { type: 'wait', config: { amount: 30, unit: 'days' } },
      { type: 'send_email', config: { subject: '{{first_name}}, te echamos de menos', body: 'Hola {{first_name}},\n\nHace un tiempo que no sabemos de ti. Tenemos una oferta especial si vuelves este mes. Responde a este email y te contamos.' } },
      { type: 'send_whatsapp', config: { body: 'Hola {{first_name}}! Tenemos una promo especial para ti este mes. Te interesa?' } },
    ],
  },
];

router.get('/recipes', (req, res) =>
  res.json(RECIPES.map(({ key, name, description, trigger_type }) => ({ key, name, description, trigger_type })))
);

router.post('/recipes/:key/install', async (req, res) => {
  const recipe = RECIPES.find((r) => r.key === req.params.key);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
  const wfId = await db.tx(async (t) => {
    const id = await t.insert(
      'INSERT INTO workflows (location_id, name, trigger_type, trigger_config, active) VALUES (?, ?, ?, ?, 1)',
      [req.location.id, recipe.name, recipe.trigger_type, JSON.stringify(recipe.trigger_config)]
    );
    for (let i = 0; i < recipe.actions.length; i++) {
      await t.run('INSERT INTO workflow_actions (workflow_id, position, type, config) VALUES (?, ?, ?, ?)', [
        id, i, recipe.actions[i].type, JSON.stringify(recipe.actions[i].config || {}),
      ]);
    }
    return id;
  });
  res.status(201).json(await withActions(await db.get('SELECT * FROM workflows WHERE id = ?', [wfId])));
});

router.get('/meta', (req, res) => res.json({ triggers: TRIGGER_TYPES, actions: ACTION_TYPES }));

router.get('/', async (req, res) => {
  const workflows = await db.all('SELECT * FROM workflows WHERE location_id = ? ORDER BY id DESC', [req.location.id]);
  res.json(await withActionsBulk(workflows));
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
