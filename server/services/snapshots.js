// Snapshot engine: serialize a sub-account's structural configuration into a
// portable object, and apply it into another sub-account. Used by the agency
// snapshot library, JSON export/import, and auto-provisioning on sub-account
// creation. Mirrors GoHighLevel snapshots: STRUCTURE only (pipelines,
// workflows, funnels, calendars, templates, custom fields, custom values,
// trigger links) — never live data (contacts, conversations, invoices…).
const crypto = require('crypto');

// ---- Serialize a location → snapshot data object ----
async function serializeLocation(db, locId) {
  const pipelines = await db.all('SELECT * FROM pipelines WHERE location_id = ?', [locId]);
  return {
    kind: 'leadflow-snapshot',
    version: 2,
    pipelines: await Promise.all(
      pipelines.map(async (p) => ({
        name: p.name,
        stages: (
          await db.all('SELECT name, position FROM stages WHERE pipeline_id = ? ORDER BY position', [p.id])
        ).map((s) => s.name),
      }))
    ),
    workflows: await Promise.all(
      (await db.all('SELECT * FROM workflows WHERE location_id = ?', [locId])).map(async (w) => ({
        name: w.name,
        trigger_type: w.trigger_type,
        trigger_config: JSON.parse(w.trigger_config || '{}'),
        active: !!w.active,
        actions: (
          await db.all('SELECT type, config FROM workflow_actions WHERE workflow_id = ? ORDER BY position', [w.id])
        ).map((a) => ({ type: a.type, config: JSON.parse(a.config || '{}') })),
      }))
    ),
    funnels: await Promise.all(
      (await db.all('SELECT * FROM funnels WHERE location_id = ?', [locId])).map(async (f) => ({
        name: f.name,
        pages: (
          await db.all(
            'SELECT name, slug, position, published, content, theme FROM funnel_pages WHERE funnel_id = ? ORDER BY position',
            [f.id]
          )
        ).map((p) => ({ ...p, content: JSON.parse(p.content || '[]') })),
      }))
    ),
    calendars: (
      await db.all(
        'SELECT name, description, duration_minutes, start_hour, end_hour, days, reminder_hours, capacity FROM calendars WHERE location_id = ?',
        [locId]
      )
    ).map((c) => ({ ...c, days: JSON.parse(c.days || '[]') })),
    email_templates: await db.all('SELECT name, subject, body FROM email_templates WHERE location_id = ?', [locId]),
    custom_fields: await db.all('SELECT name, key, type FROM custom_fields WHERE location_id = ?', [locId]),
    custom_values: await db.all('SELECT key, label, value FROM custom_values WHERE location_id = ?', [locId]),
    trigger_links: await db.all('SELECT name, slug, target_url, tag FROM trigger_links WHERE location_id = ?', [locId]),
  };
}

function slugify(text, fallback) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || fallback
  );
}

async function uniqueSlug(t, table, base) {
  let slug = base;
  let i = 1;
  while (await t.get(`SELECT id FROM ${table} WHERE slug = ?`, [slug])) slug = `${base}-${i++}`;
  return slug;
}

// ---- Apply a snapshot into a location (must run inside a db.tx) ----
// Idempotent-ish: dedups slugs and custom-field/value keys so re-applying does
// not throw. Returns per-asset counts.
async function applySnapshot(t, locId, data = {}) {
  const counts = {
    pipelines: 0, workflows: 0, funnels: 0, calendars: 0,
    email_templates: 0, custom_fields: 0, custom_values: 0, trigger_links: 0,
  };

  for (const p of data.pipelines || []) {
    const pid = await t.insert('INSERT INTO pipelines (location_id, name) VALUES (?, ?)', [locId, p.name || 'Pipeline']);
    for (let i = 0; i < (p.stages || []).length; i++) {
      await t.run('INSERT INTO stages (pipeline_id, name, position) VALUES (?, ?, ?)', [pid, p.stages[i], i]);
    }
    counts.pipelines++;
  }

  for (const w of data.workflows || []) {
    const wid = await t.insert(
      'INSERT INTO workflows (location_id, name, trigger_type, trigger_config, active) VALUES (?, ?, ?, ?, ?)',
      [locId, w.name || 'Workflow', w.trigger_type || 'contact_created', JSON.stringify(w.trigger_config || {}), w.active === false ? 0 : 1]
    );
    for (let i = 0; i < (w.actions || []).length; i++) {
      await t.run('INSERT INTO workflow_actions (workflow_id, position, type, config) VALUES (?, ?, ?, ?)', [
        wid, i, w.actions[i].type, JSON.stringify(w.actions[i].config || {}),
      ]);
    }
    counts.workflows++;
  }

  for (const f of data.funnels || []) {
    const slug = await uniqueSlug(t, 'funnels', slugify(f.name, 'funnel'));
    const fid = await t.insert('INSERT INTO funnels (location_id, name, slug) VALUES (?, ?, ?)', [locId, f.name || 'Funnel', slug]);
    for (const page of f.pages || []) {
      await t.run(
        'INSERT INTO funnel_pages (funnel_id, name, slug, position, published, content, theme) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [fid, page.name || 'Page', page.slug || 'home', page.position || 0, page.published ? 1 : 0, JSON.stringify(page.content || []), page.theme || 'clean']
      );
    }
    counts.funnels++;
  }

  for (const c of data.calendars || []) {
    const slug = await uniqueSlug(t, 'calendars', slugify(c.name, 'calendar'));
    await t.run(
      `INSERT INTO calendars (location_id, name, slug, description, duration_minutes, start_hour, end_hour, days, reminder_hours, capacity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [locId, c.name || 'Calendar', slug, c.description || '', c.duration_minutes || 30, c.start_hour ?? 9, c.end_hour ?? 17,
        JSON.stringify(c.days || [1, 2, 3, 4, 5]), c.reminder_hours ?? 24, c.capacity ?? 1]
    );
    counts.calendars++;
  }

  for (const tpl of data.email_templates || []) {
    await t.run('INSERT INTO email_templates (location_id, name, subject, body) VALUES (?, ?, ?, ?)', [
      locId, tpl.name || 'Template', tpl.subject || '', tpl.body || '',
    ]);
    counts.email_templates++;
  }

  for (const cf of data.custom_fields || []) {
    const exists = await t.get('SELECT id FROM custom_fields WHERE location_id = ? AND key = ?', [locId, cf.key]);
    if (exists) continue;
    await t.run('INSERT INTO custom_fields (location_id, name, key, type) VALUES (?, ?, ?, ?)', [
      locId, cf.name || cf.key, cf.key || crypto.randomBytes(4).toString('hex'), cf.type || 'text',
    ]);
    counts.custom_fields++;
  }

  for (const cv of data.custom_values || []) {
    if (!cv.key) continue;
    const exists = await t.get('SELECT id FROM custom_values WHERE location_id = ? AND key = ?', [locId, cv.key]);
    if (exists) continue;
    await t.run('INSERT INTO custom_values (location_id, key, label, value) VALUES (?, ?, ?, ?)', [
      locId, cv.key, cv.label || cv.key, cv.value || '',
    ]);
    counts.custom_values++;
  }

  for (const link of data.trigger_links || []) {
    const slug = await uniqueSlug(t, 'trigger_links', slugify(link.slug || link.name, 'link'));
    await t.run('INSERT INTO trigger_links (location_id, name, slug, target_url, tag) VALUES (?, ?, ?, ?, ?)', [
      locId, link.name || 'Link', slug, link.target_url || '', link.tag || '',
    ]);
    counts.trigger_links++;
  }

  return counts;
}

module.exports = { serializeLocation, applySnapshot, slugify };
