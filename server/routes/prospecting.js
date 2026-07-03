const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const prospecting = require('../services/prospecting');
const automation = require('../services/automation');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/status', (req, res) => res.json({ provider: prospecting.provider() }));

router.post('/search', async (req, res) => {
  const query = String(req.body?.query || '').trim();
  const filters = req.body?.filters || {};
  const enrich = req.body?.enrich !== false; // ads/tech detection on by default
  if (query.length < 3) return res.status(400).json({ error: 'Escribe qué buscar (ej: "dentistas en Madrid")' });
  try {
    const out = await prospecting.search(query);
    if (enrich) out.results = await prospecting.enrich(out.results);
    const total = out.results.length;
    out.results = prospecting.applyFilters(out.results, filters);
    out.total_before_filters = total;
    // Mark results whose phone already exists as contacts in this sub-account.
    const withDupes = [];
    for (const r of out.results) {
      let exists = false;
      if (r.phone) {
        const normalized = r.phone.replace(/[^+\d]/g, '');
        const row = await db.get(
          `SELECT id FROM contacts WHERE location_id = ? AND replace(replace(replace(phone, ' ', ''), '-', ''), '.', '') = ?`,
          [req.location.id, normalized]
        );
        exists = Boolean(row);
      }
      withDupes.push({ ...r, already_contact: exists });
    }
    res.json({ provider: out.provider, results: withDupes, total_before_filters: out.total_before_filters });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Import selected prospects as contacts (+tag +note +optional opportunity).
router.post('/import', async (req, res) => {
  const { prospects, tag = 'prospecto', create_opportunities = true } = req.body || {};
  if (!Array.isArray(prospects) || !prospects.length)
    return res.status(400).json({ error: 'No hay prospectos que importar' });

  const pipeline = create_opportunities
    ? await db.get('SELECT * FROM pipelines WHERE location_id = ? ORDER BY id LIMIT 1', [req.location.id])
    : null;
  const stage = pipeline
    ? await db.get('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY position LIMIT 1', [pipeline.id])
    : null;

  let imported = 0;
  let skipped = 0;
  for (const p of prospects.slice(0, 50)) {
    const name = String(p.name || '').trim();
    if (!name) continue;
    const phone = String(p.phone || '').trim();
    if (phone) {
      const dupe = await db.get(`SELECT id FROM contacts WHERE location_id = ? AND phone = ? AND phone != ''`, [
        req.location.id,
        phone,
      ]);
      if (dupe) {
        skipped++;
        continue;
      }
    }
    const id = await db.insert(
      `INSERT INTO contacts (location_id, first_name, phone, source, custom_fields)
       VALUES (?, ?, ?, 'prospecting', ?)`,
      [
        req.location.id,
        name.slice(0, 80),
        phone,
        JSON.stringify({
          direccion: p.address || '',
          web: p.website || '',
          rating_google: p.rating != null ? String(p.rating) : '',
          resenas_google: String(p.reviews || ''),
          hace_anuncios: p.runs_ads === true ? 'sí' : p.runs_ads === false ? 'no' : 'desconocido',
        }),
      ]
    );
    if (tag) await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [id, tag]);
    await automation.logActivity(
      req.location.id,
      id,
      'contact',
      `Prospecto importado de Google${p.rating ? ` (${p.rating}★, ${p.reviews} reseñas)` : ''}${p.runs_ads === true ? ' · 📢 hace anuncios' : p.runs_ads === false ? ' · sin anuncios 🎯' : ''}${p.maps_url ? ` — ${p.maps_url}` : ''}`
    );
    if (pipeline && stage) {
      await db.run(
        `INSERT INTO opportunities (location_id, pipeline_id, stage_id, contact_id, title, value)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [req.location.id, pipeline.id, stage.id, id, `Prospecto — ${name.slice(0, 60)}`]
      );
    }
    const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
    await automation.trigger(req.location.id, 'contact_created', contact);
    if (tag) await automation.trigger(req.location.id, 'tag_added', contact, { tag });
    imported++;
  }
  res.json({ ok: true, imported, skipped });
});

module.exports = router;
