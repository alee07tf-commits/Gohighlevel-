// Content AI endpoints (Claude). Enabled with ANTHROPIC_API_KEY; the UI
// shows a friendly message otherwise.
const express = require('express');
const { requireAuth, requireLocation } = require('../auth');
const ai = require('../services/ai');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/status', async (req, res) =>
  res.json({ enabled: await ai.ready({ locationId: req.location.id, agencyId: req.user.agency_id }) })
);

// kind: email | sms | whatsapp | funnel
router.post('/generate', async (req, res) => {
  const { kind = 'email', prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  try {
    const business = `${req.location.name}${req.location.company ? ` (${req.location.company})` : ''}`;
    const result = await ai.generateCopy({ kind, prompt, business, ctx: { locationId: req.location.id, agencyId: req.user.agency_id } });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});


// ---- Claude design: generate a complete, fully-editable landing page ----
// Creates a new funnel (or replaces an existing page's content). The result
// uses the same block schema as the visual editor, so the user can edit
// every text, reorder sections and re-publish afterwards.
const db = require('../db');

function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'funnel'
  );
}

router.post('/funnel', async (req, res) => {
  const { business, offer, audience, goal, tone, prompt, funnel_id, page_id } = req.body || {};
  try {
    const design = await ai.generateFunnelDesign({
      business: business || `${req.location.name}${req.location.company ? ` (${req.location.company})` : ''}`,
      offer,
      audience,
      goal,
      tone,
      prompt,
      locationName: req.location.name,
      ctx: { locationId: req.location.id, agencyId: req.user.agency_id },
    });

    // Regenerate an existing page in place (kept unpublished changes editable).
    if (funnel_id && page_id) {
      const page = await db.get(
        `SELECT fp.* FROM funnel_pages fp JOIN funnels f ON f.id = fp.funnel_id
         WHERE fp.id = ? AND f.id = ? AND f.location_id = ?`,
        [page_id, funnel_id, req.location.id]
      );
      if (!page) return res.status(404).json({ error: 'Page not found' });
      await db.run('UPDATE funnel_pages SET content = ?, theme = ? WHERE id = ?', [
        JSON.stringify(design.blocks),
        design.theme || 'clean',
        page.id,
      ]);
      return res.json({ ok: true, mode: 'regenerated', generated_by: design.generated_by, page_id: page.id, funnel_id });
    }

    // Create a brand new funnel with the generated landing page.
    let slug = slugify(design.name || offer);
    let i = 1;
    while (await db.get('SELECT id FROM funnels WHERE slug = ?', [slug])) slug = `${slugify(design.name || offer)}-${i++}`;
    const funnelId = await db.insert('INSERT INTO funnels (location_id, name, slug) VALUES (?, ?, ?)', [
      req.location.id,
      design.name || offer || 'Funnel IA',
      slug,
    ]);
    await db.run(
      'INSERT INTO funnel_pages (funnel_id, name, slug, position, published, content, theme) VALUES (?, ?, ?, 0, 1, ?, ?)',
      [funnelId, 'Landing', 'home', JSON.stringify(design.blocks), design.theme || 'clean']
    );
    res.status(201).json({ ok: true, mode: 'created', generated_by: design.generated_by, funnel_id: funnelId, slug });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Workflow AI: create an automation from a plain-language goal.
router.post('/workflow', async (req, res) => {
  const { goal } = req.body || {};
  if (!goal) return res.status(400).json({ error: 'goal is required' });
  try {
    const design = await ai.generateWorkflow({
      goal,
      business: `${req.location.name}${req.location.company ? ` (${req.location.company})` : ''}`,
      ctx: { locationId: req.location.id, agencyId: req.user.agency_id },
    });
    const wfId = await db.tx(async (t) => {
      const id = await t.insert(
        'INSERT INTO workflows (location_id, name, trigger_type, trigger_config, active) VALUES (?, ?, ?, ?, 0)',
        [req.location.id, design.name, design.trigger_type, JSON.stringify(design.trigger_config || {})]
      );
      for (let i = 0; i < design.actions.length; i++) {
        await t.run('INSERT INTO workflow_actions (workflow_id, position, type, config) VALUES (?, ?, ?, ?)', [
          id, i, design.actions[i].type, JSON.stringify(design.actions[i].config || {}),
        ]);
      }
      return id;
    });
    res.status(201).json({ ok: true, workflow_id: wfId, generated_by: design.generated_by, note: 'Creado en pausa: revísalo y actívalo' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
