// Workflow automation engine.
// Triggers: contact_created | tag_added | form_submitted | appointment_booked | opportunity_stage_changed
// Actions:  add_tag | remove_tag | send_email | send_sms | add_note | create_opportunity
const db = require('../db');
const messaging = require('./messaging');

async function logActivity(locationId, contactId, type, description) {
  await db.run('INSERT INTO activities (location_id, contact_id, type, description) VALUES (?, ?, ?, ?)', [
    locationId,
    contactId,
    type,
    description,
  ]);
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
    default:
      log.push(`Unknown action type "${action.type}" skipped`);
  }
}

// Fire all active workflows for a location matching the trigger.
// `event` may carry { tag, pipeline_id, stage_id, funnel_id, calendar_id }.
async function trigger(locationId, triggerType, contact, event = {}) {
  if (!contact) return;
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

    const actions = await db.all('SELECT * FROM workflow_actions WHERE workflow_id = ? ORDER BY position', [wf.id]);
    const log = [];
    let status = 'success';
    try {
      for (const action of actions) await runAction(action, contact, locationId, log);
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
    await logActivity(locationId, contact.id, 'automation', `Workflow "${wf.name}" executed (${status})`);
  }
}

module.exports = { trigger, logActivity };
