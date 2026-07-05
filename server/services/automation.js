// Workflow automation engine.
// Triggers: contact_created | tag_added | form_submitted | appointment_booked |
//           opportunity_stage_changed | message_received | invoice_paid | appointment_status_changed
// Actions:  add_tag | remove_tag | send_email | send_sms | send_whatsapp | add_note |
//           create_opportunity | wait | branch | create_task | send_review_request
const db = require('../db');
const messaging = require('./messaging');
const notifications = require('./notifications');

async function logActivity(locationId, contactId, type, description) {
  await db.run('INSERT INTO activities (location_id, contact_id, type, description) VALUES (?, ?, ?, ?)', [
    locationId,
    contactId,
    type,
    description,
  ]);
}

// Branch conditions evaluated against the live contact record.
// config: { field: 'tag'|'score'|'email'|'phone'|'source'|custom key, op, value }
async function evaluateCondition(config, contact) {
  const op = config.op || 'has';
  const value = String(config.value ?? '');
  if (config.field === 'tag') {
    const row = await db.get('SELECT 1 AS x FROM contact_tags WHERE contact_id = ? AND tag = ?', [contact.id, value]);
    return op === 'not_has' ? !row : Boolean(row);
  }
  const fresh = (await db.get('SELECT * FROM contacts WHERE id = ?', [contact.id])) || contact;
  let actual;
  if (['score', 'email', 'phone', 'source', 'first_name', 'last_name'].includes(config.field)) {
    actual = fresh[config.field];
  } else {
    actual = JSON.parse(fresh.custom_fields || '{}')[config.field];
  }
  switch (op) {
    case 'equals': return String(actual ?? '') === value;
    case 'not_equals': return String(actual ?? '') !== value;
    case 'contains': return String(actual ?? '').toLowerCase().includes(value.toLowerCase());
    case 'gte': return Number(actual) >= Number(value);
    case 'lte': return Number(actual) <= Number(value);
    case 'is_set': return actual !== undefined && actual !== null && String(actual) !== '';
    case 'not_set': return actual === undefined || actual === null || String(actual) === '';
    default: return false;
  }
}

async function runAction(action, contact, locationId, log) {
  const config = JSON.parse(action.config || '{}');
  switch (action.type) {
    case 'add_tag': {
      await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [
        contact.id,
        config.tag,
      ]);
      log.push(`Added tag "${config.tag}"`);
      // Note: intentionally does NOT re-fire tag_added triggers to avoid loops.
      break;
    }
    case 'remove_tag': {
      await db.run('DELETE FROM contact_tags WHERE contact_id = ? AND tag = ?', [contact.id, config.tag]);
      log.push(`Removed tag "${config.tag}"`);
      break;
    }
    case 'send_email': {
      await messaging.sendEmail(locationId, contact, config.subject || '', config.body || '');
      log.push(`Sent email "${config.subject || '(no subject)'}"`);
      break;
    }
    case 'send_sms': {
      await messaging.sendSms(locationId, contact, config.body || '');
      log.push('Sent SMS');
      break;
    }
    case 'send_whatsapp': {
      await messaging.sendWhatsapp(locationId, contact, config.body || '');
      log.push('Sent WhatsApp');
      break;
    }
    case 'add_note': {
      await db.run('INSERT INTO notes (contact_id, body) VALUES (?, ?)', [
        contact.id,
        messaging.mergeFields(config.body || '', contact),
      ]);
      log.push('Added note');
      break;
    }
    case 'create_opportunity': {
      const pipeline = config.pipeline_id
        ? await db.get('SELECT * FROM pipelines WHERE id = ? AND location_id = ?', [config.pipeline_id, locationId])
        : await db.get('SELECT * FROM pipelines WHERE location_id = ? ORDER BY id LIMIT 1', [locationId]);
      if (!pipeline) {
        log.push('Skipped create_opportunity: no pipeline');
        break;
      }
      const stage = await db.get('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY position LIMIT 1', [
        pipeline.id,
      ]);
      if (!stage) {
        log.push('Skipped create_opportunity: pipeline has no stages');
        break;
      }
      await db.run(
        `INSERT INTO opportunities (location_id, pipeline_id, stage_id, contact_id, title, value)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          locationId,
          pipeline.id,
          stage.id,
          contact.id,
          messaging.mergeFields(config.title || 'New opportunity for {{first_name}}', contact),
          Number(config.value) || 0,
        ]
      );
      log.push(`Created opportunity in "${pipeline.name}"`);
      break;
    }
    case 'create_task': {
      await db.run(
        'INSERT INTO tasks (location_id, contact_id, title, notes, due_at) VALUES (?, ?, ?, ?, ?)',
        [
          locationId,
          contact.id,
          messaging.mergeFields(config.title || 'Follow up with {{first_name}}', contact),
          messaging.mergeFields(config.notes || '', contact),
          config.due_in_days
            ? new Date(Date.now() + Number(config.due_in_days) * 86_400_000).toISOString().slice(0, 19)
            : null,
        ]
      );
      log.push(`Created task "${config.title || 'Follow up'}"`);
      break;
    }
    case 'send_review_request': {
      const location = await db.get('SELECT * FROM locations WHERE id = ?', [locationId]);
      const reputation = require('../routes/reputation'); // lazy: avoids circular dependency
      await reputation.sendReviewRequest(location, contact, config.channel || 'sms', process.env.APP_URL || '');
      log.push(`Sent review request (${config.channel || 'sms'})`);
      break;
    }
    case 'branch': {
      const matched = await evaluateCondition(config, contact);
      const list = matched ? config.then || [] : config.otherwise || [];
      log.push(`Branch: condition ${matched ? 'matched -> THEN' : 'not matched -> ELSE'} (${list.length} action(s))`);
      for (const nested of list) {
        if (nested.type === 'branch' || nested.type === 'wait') {
          log.push(`Nested "${nested.type}" inside a branch is not supported - skipped`);
          continue;
        }
        await runAction({ type: nested.type, config: JSON.stringify(nested.config || {}) }, contact, locationId, log);
      }
      break;
    }
    case 'update_field': {
      const known = ['first_name', 'last_name', 'email', 'phone', 'source'];
      const value = messaging.mergeFields(String(config.value ?? ''), contact);
      if (known.includes(config.field)) {
        await db.run(`UPDATE contacts SET ${config.field} = ?, updated_at = now() WHERE id = ?`, [value, contact.id]);
      } else if (config.field) {
        let cf = {};
        try { cf = JSON.parse(contact.custom_fields || '{}'); } catch { cf = {}; }
        cf[config.field] = value;
        await db.run('UPDATE contacts SET custom_fields = ?, updated_at = now() WHERE id = ?', [JSON.stringify(cf), contact.id]);
      }
      log.push(`Updated field "${config.field}"`);
      break;
    }
    case 'assign_owner': {
      const loc = await db.get('SELECT agency_id FROM locations WHERE id = ?', [locationId]);
      const u = config.user_id ? await db.get('SELECT id, name FROM users WHERE id = ? AND agency_id = ?', [config.user_id, loc && loc.agency_id]) : null;
      await db.run('UPDATE contacts SET owner_user_id = ?, updated_at = now() WHERE id = ?', [u ? u.id : null, contact.id]);
      log.push(u ? `Assigned owner ${u.name}` : 'Cleared owner');
      if (u) await notifications.notify(u.id, {
        type: 'assignment', title: 'Nuevo contacto asignado',
        body: `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.email || contact.phone || 'Contacto',
        link: `#/contacts/${contact.id}`, locationId,
      });
      break;
    }
    case 'set_dnd': {
      const col = config.scope === 'email' ? 'dnd_email' : config.scope === 'sms' ? 'dnd_sms' : 'dnd';
      await db.run(`UPDATE contacts SET ${col} = ? WHERE id = ?`, [config.value ? 1 : 0, contact.id]);
      log.push(`Set ${col} = ${config.value ? 'on' : 'off'}`);
      break;
    }
    case 'enroll_workflow': {
      const target = config.workflow_id
        ? await db.get('SELECT * FROM workflows WHERE id = ? AND location_id = ?', [config.workflow_id, locationId])
        : null;
      if (!target) { log.push('Skipped enroll_workflow: workflow not found'); break; }
      log.push(`Enrolled into workflow "${target.name}"`);
      await executeActions(target, contact, 0, `Enrolled from another workflow`);
      break;
    }
    case 'notify_user': {
      const msg = messaging.mergeFields(config.message || 'Nueva actividad de {{first_name}} {{last_name}} ({{email}} {{phone}})', contact);
      // In-app bell notification when a target user is set (email is optional).
      if (config.user_id) {
        const u = await db.get('SELECT id FROM users WHERE id = ? AND agency_id = ?', [config.user_id, loc && loc.agency_id]);
        if (u) await notifications.notify(u.id, { type: 'workflow', title: config.subject || 'Notificación interna', body: msg, link: `#/contacts/${contact.id}`, locationId });
      }
      const to = config.email;
      if (!to) { log.push(config.user_id ? 'Notified in-app' : 'Skipped notify_user: no recipient'); break; }
      try { await messaging.sendEmail(locationId, { email: to, first_name: '', last_name: '' }, config.subject || 'Notificación interna', msg); log.push(`Notified ${to}`); }
      catch (err) { log.push(`Notify failed: ${err.message}`); }
      break;
    }
    case 'webhook': {
      if (!config.url || !/^https?:\/\//.test(config.url)) {
        log.push('Skipped webhook: invalid URL');
        break;
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(config.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: config.event || 'workflow',
            contact: {
              id: contact.id, first_name: contact.first_name, last_name: contact.last_name,
              email: contact.email, phone: contact.phone, source: contact.source,
            },
            location_id: locationId,
            sent_at: new Date().toISOString(),
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        log.push(`Webhook ${config.url} → ${res.status}`);
      } catch (err) {
        log.push(`Webhook failed: ${err.message}`);
      }
      break;
    }
    default:
      log.push(`Unknown action type "${action.type}" skipped`);
  }
}

const WAIT_UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

// Runs a workflow's actions starting at startIndex. A `wait` action schedules
// a workflow_resume job for the remaining actions and stops this segment.
async function executeActions(wf, contact, startIndex, segmentLabel) {
  const scheduler = require('./scheduler'); // lazy: breaks circular dependency
  const actions = await db.all('SELECT * FROM workflow_actions WHERE workflow_id = ? ORDER BY position', [wf.id]);
  const log = segmentLabel ? [segmentLabel] : [];
  let status = 'success';
  try {
    for (let i = startIndex; i < actions.length; i++) {
      const action = actions[i];
      if (action.type === 'wait') {
        const config = JSON.parse(action.config || '{}');
        const amount = Number(config.amount) || 0;
        const unit = WAIT_UNIT_MS[config.unit] ? config.unit : 'hours';
        const runAt = new Date(Date.now() + amount * WAIT_UNIT_MS[unit]).toISOString();
        await scheduler.schedule(wf.location_id, runAt, 'workflow_resume', {
          workflow_id: wf.id,
          contact_id: contact.id,
          start_index: i + 1,
        });
        log.push(`Waiting ${amount} ${unit} (resumes ${runAt})`);
        break;
      }
      await runAction(action, contact, wf.location_id, log);
    }
  } catch (err) {
    status = 'error';
    log.push(`Error: ${err.message}`);
  }
  await db.run('INSERT INTO workflow_runs (workflow_id, contact_id, status, log) VALUES (?, ?, ?, ?)', [
    wf.id,
    contact.id,
    status,
    JSON.stringify(log),
  ]);
  await logActivity(wf.location_id, contact.id, 'automation', `Workflow "${wf.name}" executed (${status})`);
}

// Called by the scheduler when a wait elapses.
async function resumeWorkflow(wf, contact, startIndex) {
  await executeActions(wf, contact, startIndex, `Resumed after wait (step ${startIndex + 1})`);
}

// Fire all active workflows for a location matching the trigger.
// `event` may carry { tag, pipeline_id, stage_id, funnel_id, calendar_id }.
async function trigger(locationId, triggerType, contact, event = {}) {
  if (!contact) return;
  // Push the event to connected apps (Google Calendar, Zoom, HubSpot…) — best
  // effort, never blocks or breaks the automation run below.
  try { require('./appsync').dispatch(locationId, triggerType, contact, event).catch(() => {}); } catch { /* ignore */ }
  const workflows = await db.all(
    'SELECT * FROM workflows WHERE location_id = ? AND trigger_type = ? AND active = 1',
    [locationId, triggerType]
  );

  for (const wf of workflows) {
    const cfg = JSON.parse(wf.trigger_config || '{}');
    if (triggerType === 'tag_added' && cfg.tag && cfg.tag !== event.tag) continue;
    if (triggerType === 'form_submitted' && cfg.funnel_id && Number(cfg.funnel_id) !== Number(event.funnel_id)) continue;
    if (triggerType === 'appointment_booked' && cfg.calendar_id && Number(cfg.calendar_id) !== Number(event.calendar_id)) continue;
    if (triggerType === 'opportunity_stage_changed' && cfg.stage_id && Number(cfg.stage_id) !== Number(event.stage_id)) continue;
    if (triggerType === 'appointment_status_changed' && cfg.status && cfg.status !== event.status) continue;

    await executeActions(wf, contact, 0, null);
  }
}

// Manually enroll a contact into a workflow (bulk actions / contact quick
// actions). Runs the workflow's actions from the top, like a trigger match.
async function enroll(locationId, workflowId, contact) {
  const wf = await db.get('SELECT * FROM workflows WHERE id = ? AND location_id = ?', [workflowId, locationId]);
  if (!wf || !contact) return false;
  await executeActions(wf, contact, 0, 'Manual enrollment');
  return true;
}

module.exports = { trigger, resumeWorkflow, logActivity, enroll };
