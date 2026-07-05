// Standalone forms (v2.7): embeddable lead-capture forms independent of funnels.
// Each has a public URL (/form/<slug>) and posts into the CRM, tagging the
// contact and firing the form_submitted automation trigger.
const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

const FIELD_KEYS = ['first_name', 'last_name', 'email', 'phone', 'message'];

function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'form'
  );
}
async function uniqueSlug(base) {
  let slug = base;
  for (let i = 2; await db.get('SELECT id FROM forms WHERE slug = ?', [slug]); i++) slug = `${base}-${i}`;
  return slug;
}
function cleanFields(fields, extraKeys = []) {
  const allowed = new Set([...FIELD_KEYS, ...extraKeys]);
  const arr = Array.isArray(fields) ? fields.filter((f) => allowed.has(f)) : [];
  return arr.length ? [...new Set(arr)] : ['first_name', 'email', 'phone'];
}

// The location's custom-field keys are also valid form fields.
async function customKeys(locationId) {
  const rows = await db.all('SELECT key FROM custom_fields WHERE location_id = ?', [locationId]);
  return rows.map((r) => r.key);
}

router.get('/', async (req, res) => {
  res.json(await db.all('SELECT * FROM forms WHERE location_id = ? ORDER BY id DESC', [req.location.id]));
});

router.post('/', async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const b = req.body || {};
  const keys = await customKeys(req.location.id);
  const fields = cleanFields(b.fields, keys);
  const required = Array.isArray(b.required_fields) ? b.required_fields.filter((f) => fields.includes(f)) : [];
  const id = await db.insert(
    `INSERT INTO forms (location_id, name, slug, headline, fields, tag, success_message, redirect_url, notify_email, required_fields)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.location.id, name, await uniqueSlug(slugify(name)),
      b.headline || '', JSON.stringify(fields), b.tag || '',
      b.success_message || '¡Gracias! Te contactaremos pronto.', b.redirect_url || '',
      b.notify_email || '', JSON.stringify(required),
    ]
  );
  res.status(201).json(await db.get('SELECT * FROM forms WHERE id = ?', [id]));
});

async function getForm(req, res, next) {
  const form = await db.get('SELECT * FROM forms WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  req.form = form;
  next();
}

router.put('/:id', getForm, async (req, res) => {
  const b = req.body || {};
  const f = req.form;
  const keys = await customKeys(req.location.id);
  const fields = b.fields ? cleanFields(b.fields, keys) : JSON.parse(f.fields || '[]');
  const required = b.required_fields !== undefined
    ? (Array.isArray(b.required_fields) ? b.required_fields.filter((x) => fields.includes(x)) : [])
    : JSON.parse(f.required_fields || '[]');
  await db.run(
    'UPDATE forms SET name=?, headline=?, fields=?, tag=?, success_message=?, redirect_url=?, notify_email=?, required_fields=? WHERE id=?',
    [
      b.name || f.name, b.headline ?? f.headline,
      JSON.stringify(fields), b.tag ?? f.tag, b.success_message ?? f.success_message, b.redirect_url ?? f.redirect_url,
      b.notify_email ?? f.notify_email, JSON.stringify(required), f.id,
    ]
  );
  res.json(await db.get('SELECT * FROM forms WHERE id = ?', [f.id]));
});

router.delete('/:id', getForm, async (req, res) => {
  await db.run('DELETE FROM forms WHERE id = ?', [req.form.id]);
  res.json({ ok: true });
});

// Submissions for one form.
router.get('/:id/submissions', getForm, async (req, res) => {
  res.json(
    await db.all(
      `SELECT s.*, c.first_name, c.last_name, c.email, c.phone FROM form_submissions s
       LEFT JOIN contacts c ON c.id = s.contact_id
       WHERE s.form_id = ? ORDER BY s.created_at DESC LIMIT 200`,
      [req.form.id]
    )
  );
});

module.exports = router;
