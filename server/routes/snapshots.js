// Snapshots: export a sub-account's full configuration (pipelines, workflows,
// funnels, calendars, email templates, custom fields) as portable JSON and
// import it into any other sub-account — the "deploy a client in minutes"
// feature agencies use to productize their setups.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/export', async (req, res) => {
  const loc = req.location.id;
  const pipelines = await db.all('SELECT * FROM pipelines WHERE location_id = ?', [loc]);
  const snapshot = {
    kind: 'leadflow-snapshot',
    version: 1,
    name: req.location.name,
    exported_at: new Date().toISOString(),
    pipelines: await Promise.all(
      pipelines.map(async (p) => ({
        name: p.name,
        stages: (await db.all('SELECT name, position FROM stages WHERE pipeline_id = ? ORDER BY position', [p.id])).map(
          (s) => s.name
        ),
      }))
    ),
    workflows: await Promise.all(
      (await db.all('SELECT * FROM workflows WHERE location_id = ?', [loc])).map(async (w) => ({
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
      (await db.all('SELECT * FROM funnels WHERE location_id = ?', [loc])).map(async (f) => ({
        name: f.name,
        pages: (
          await db.all('SELECT name, slug, position, published, content FROM funnel_pages WHERE funnel_id = ? ORDER BY position', [f.id])
        ).map((p) => ({ ...p, content: JSON.parse(p.content || '[]') })),
      }))
    ),
    calendars: (
      await db.all('SELECT name, description, duration_minutes, start_hour, end_hour, days, reminder_hours FROM calendars WHERE location_id = ?', [loc])
    ).map((c) => ({ ...c, days: JSON.parse(c.days || '[]') })),
    email_templates: await db.all('SELECT name, subject, body FROM email_templates WHERE location_id = ?', [loc]),
    custom_fields: await db.all('SELECT name, key, type FROM custom_fields WHERE location_id = ?', [loc]),
  };
  res.json(snapshot);
});

function slugify(text, fallback) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || fallback
  );
}

router.post('/import', async (req, res) => {
  const snap = req.body || {};
  if (snap.kind !== 'leadflow-snapshot' || !snap.version)
    return res.status(400).json({ error: 'Not a valid LeadFlow snapshot' });
  const loc = req.location.id;
  const counts = { pipelines: 0, workflows: 0, funnels: 0, calendars: 0, email_templates: 0, custom_fields: 0 };

  await db.tx(async (t) => {
    for (const p of snap.pipelines || []) {
      const pid = await t.insert('INSERT INTO pipelines (location_id, name) VALUES (?, ?)', [loc, p.name || 'Pipeline']);
      (p.stages || []).forEach(() => {});
      for (let i = 0; i < (p.stages || []).length; i++) {
        await t.run('INSERT INTO stages (pipeline_id, name, position) VALUES (?, ?, ?)', [pid, p.stages[i], i]);
      }
      counts.pipelines++;
    }
    for (const w of snap.workflows || []) {
      const wid = await t.insert(
        'INSERT INTO workflows (location_id, name, trigger_type, trigger_config, active) VALUES (?, ?, ?, ?, ?)',
        [loc, w.name || 'Workflow', w.trigger_type || 'contact_created', JSON.stringify(w.trigger_config || {}), w.active === false ? 0 : 1]
      );
      for (let i = 0; i < (w.actions || []).length; i++) {
        await t.run('INSERT INTO workflow_actions (workflow_id, position, type, config) VALUES (?, ?, ?, ?)', [
          wid, i, w.actions[i].type, JSON.stringify(w.actions[i].config || {}),
        ]);
      }
      counts.workflows++;
    }
    for (const f of snap.funnels || []) {
      let slug = slugify(f.name, 'funnel');
      let i = 1;
      while (await t.get('SELECT id FROM funnels WHERE slug = ?', [slug])) slug = `${slugify(f.name, 'funnel')}-${i++}`;
      const fid = await t.insert('INSERT INTO funnels (location_id, name, slug) VALUES (?, ?, ?)', [loc, f.name || 'Funnel', slug]);
      for (const page of f.pages || []) {
        await t.run(
          'INSERT INTO funnel_pages (funnel_id, name, slug, position, published, content) VALUES (?, ?, ?, ?, ?, ?)',
          [fid, page.name || 'Page', page.slug || 'home', page.position || 0, page.published ? 1 : 0, JSON.stringify(page.content || [])]
        );
      }
      counts.funnels++;
    }
    for (const c of snap.calendars || []) {
      let slug = slugify(c.name, 'calendar');
      let i = 1;
      while (await t.get('SELECT id FROM calendars WHERE slug = ?', [slug])) slug = `${slugify(c.name, 'calendar')}-${i++}`;
      await t.run(
        `INSERT INTO calendars (location_id, name, slug, description, duration_minutes, start_hour, end_hour, days, reminder_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [loc, c.name || 'Calendar', slug, c.description || '', c.duration_minutes || 30, c.start_hour ?? 9, c.end_hour ?? 17, JSON.stringify(c.days || [1, 2, 3, 4, 5]), c.reminder_hours ?? 24]
      );
      counts.calendars++;
    }
    for (const tpl of snap.email_templates || []) {
      await t.run('INSERT INTO email_templates (location_id, name, subject, body) VALUES (?, ?, ?, ?)', [
        loc, tpl.name || 'Template', tpl.subject || '', tpl.body || '',
      ]);
      counts.email_templates++;
    }
    for (const cf of snap.custom_fields || []) {
      const exists = await t.get('SELECT id FROM custom_fields WHERE location_id = ? AND key = ?', [loc, cf.key]);
      if (exists) continue;
      await t.run('INSERT INTO custom_fields (location_id, name, key, type) VALUES (?, ?, ?, ?)', [
        loc, cf.name || cf.key, cf.key || crypto.randomBytes(4).toString('hex'), cf.type || 'text',
      ]);
      counts.custom_fields++;
    }
  });

  res.json({ ok: true, imported: counts });
});

module.exports = router;
