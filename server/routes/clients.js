// Clients console (Phase 4): manage the agencies directly below you in the
// tenant tree. Upcross uses it to manage its clients; a client that resells
// uses the very same screen to manage its own clients. "Entering" a client is
// done from the frontend by sending its id as X-Agency-Id — every module then
// scopes to that client automatically (see server/auth.js).
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../auth');
const provisioning = require('../services/provisioning');

const router = express.Router();
router.use(requireAuth);

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// A slug unique across all agencies (used for the client's branded login link).
// `q` is a db handle (may be a transaction handle).
async function uniqueSlug(q, base, exceptId) {
  const root = slugify(base) || 'cliente';
  let cand = root;
  for (let i = 2; ; i++) {
    const clash = await q.get('SELECT id FROM agencies WHERE slug = ? AND id != ?', [cand, exceptId || 0]);
    if (!clash) return cand;
    cand = `${root}-${i}`;
  }
}

// List the direct child agencies of the effective agency, with a light rollup.
// Rollup metrics use one grouped query each (keyed by child agency) rather than
// four queries per client.
router.get('/', async (req, res) => {
  const children = await db.all(
    'SELECT id, name, slug, brand_color, logo_url, created_at FROM agencies WHERE parent_agency_id = ? ORDER BY id',
    [req.user.agency_id]
  );
  if (!children.length) return res.json([]);

  const ids = children.map((c) => c.id);
  const ph = ids.map(() => '?').join(',');
  const [subRows, contactRows, clientRows, adminRows] = await Promise.all([
    db.all(`SELECT agency_id, COUNT(*)::int AS n FROM locations WHERE agency_id IN (${ph}) GROUP BY agency_id`, ids),
    db.all(`SELECT l.agency_id, COUNT(*)::int AS n FROM contacts c JOIN locations l ON l.id = c.location_id WHERE l.agency_id IN (${ph}) GROUP BY l.agency_id`, ids),
    db.all(`SELECT parent_agency_id AS agency_id, COUNT(*)::int AS n FROM agencies WHERE parent_agency_id IN (${ph}) GROUP BY parent_agency_id`, ids),
    db.all(`SELECT DISTINCT ON (agency_id) agency_id, name, email FROM users WHERE agency_id IN (${ph}) AND role = 'admin' ORDER BY agency_id, id`, ids),
  ]);
  const map = (arr) => Object.fromEntries(arr.map((r) => [r.agency_id, r]));
  const sMap = map(subRows), cMap = map(contactRows), gMap = map(clientRows), aMap = map(adminRows);

  const rows = children.map((c) => ({
    ...c,
    subaccounts: sMap[c.id] ? sMap[c.id].n : 0,
    contacts: cMap[c.id] ? cMap[c.id].n : 0,
    clients: gMap[c.id] ? gMap[c.id].n : 0,
    admin: aMap[c.id] ? { name: aMap[c.id].name, email: aMap[c.id].email } : null,
  }));
  res.json(rows);
});

// Create a client = a child agency + its admin user (+ optionally a first
// sub-account provisioned from a snapshot owned by the creating agency).
router.post('/', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { agency_name, admin_name, admin_email, admin_password, location_name } = req.body || {};
  if (!agency_name || !admin_email || !admin_password)
    return res.status(400).json({ error: 'agency_name, admin_email y admin_password son obligatorios' });
  if (String(admin_password).length < 6)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  if (await db.get('SELECT id FROM users WHERE email = ?', [admin_email]))
    return res.status(409).json({ error: 'Ese email ya está registrado' });

  // Plan-driven provisioning (the GoHighLevel model): if a plan is chosen, it
  // brings its own template (snapshot) and opens a subscription automatically —
  // "elige el plan y ya le trae todo configurado". An explicit snapshot_id still
  // wins if the admin picked one on purpose.
  let plan = null;
  if (req.body?.plan_id) {
    plan = await db.get('SELECT * FROM plans WHERE id = ? AND agency_id = ?', [req.body.plan_id, req.user.agency_id]);
    if (!plan) return res.status(400).json({ error: 'Plan no encontrado' });
  }

  // Snapshots belong to the creating (effective) agency; resolve the row here
  // and hand it to provisioning so the new client's first sub-account is
  // installed from the chosen template.
  let snapshot;
  if (req.body?.snapshot_id !== undefined && Number(req.body.snapshot_id) !== 0) {
    snapshot = await provisioning.resolveSnapshot(req.user.agency_id, Number(req.body.snapshot_id));
  } else if (plan && plan.snapshot_id) {
    snapshot = await provisioning.resolveSnapshot(req.user.agency_id, plan.snapshot_id); // the plan's template
  } else if (req.body?.snapshot_id === undefined) {
    snapshot = await provisioning.resolveSnapshot(req.user.agency_id, undefined); // agency default, if any
  } else {
    snapshot = null; // snapshot_id === 0 → empty
  }

  const created = await db.tx(async (t) => {
    const aid = await t.insert('INSERT INTO agencies (name, parent_agency_id) VALUES (?, ?)', [
      agency_name,
      req.user.agency_id,
    ]);
    // Give the client a unique slug so it gets a branded login link out of the box.
    const slug = await uniqueSlug(t, agency_name, aid);
    await t.run('UPDATE agencies SET slug = ? WHERE id = ?', [slug, aid]);
    const uid = await t.insert('INSERT INTO users (agency_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [
      aid, admin_name || agency_name, admin_email, bcrypt.hashSync(admin_password, 10), 'admin',
    ]);
    return { agencyId: aid, adminUserId: uid };
  });
  const childAgencyId = created.agencyId;

  // First sub-account for the client (own transaction). Snapshot is passed as a
  // pre-resolved row so provisioning doesn't look it up under the child agency.
  const result = await provisioning.provisionSubAccount({
    agencyId: childAgencyId,
    profile: { name: location_name || agency_name, company: agency_name },
    snapshot: snapshot || null,
  });

  // Open the subscription so the client is on the plan from day one (and the
  // agency's MRR/roll-up reflects it). Managed services (SMS/WhatsApp/Email/AI)
  // are already available via the credential cascade — nothing for the client
  // to set up.
  if (plan) {
    await db.run(
      `INSERT INTO subscriptions (agency_id, location_id, plan_id, client_user_id, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [req.user.agency_id, result.locId, plan.id, created.adminUserId]
    );
  }

  const agency = await db.get('SELECT id, name, slug, brand_color, logo_url FROM agencies WHERE id = ?', [childAgencyId]);
  res.status(201).json({ ...agency, first_location_id: result.locId, provisioned: result.provisioned, plan: plan ? { id: plan.id, name: plan.name } : null });
});

// Rename / rebrand a direct child agency.
router.put('/:id', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const child = await db.get('SELECT * FROM agencies WHERE id = ? AND parent_agency_id = ?', [
    req.params.id,
    req.user.agency_id,
  ]);
  if (!child) return res.status(404).json({ error: 'Cliente no encontrado' });
  const b = req.body || {};
  // Slug: keep the current one unless a new value is provided; ensure uniqueness.
  const slug = b.slug !== undefined ? await uniqueSlug(db, b.slug, child.id) : child.slug || (await uniqueSlug(db, child.name, child.id));
  await db.run('UPDATE agencies SET name = ?, slug = ?, brand_color = ?, logo_url = ?, signup_headline = ? WHERE id = ?', [
    b.name || child.name,
    slug,
    b.brand_color ?? child.brand_color,
    b.logo_url ?? child.logo_url,
    b.signup_headline ?? child.signup_headline,
    child.id,
  ]);
  res.json(await db.get('SELECT id, name, slug, brand_color, logo_url, signup_headline FROM agencies WHERE id = ?', [child.id]));
});

// Delete a direct child agency — only when it is empty (no sub-accounts and no
// clients of its own), to avoid orphaning data.
router.delete('/:id', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const child = await db.get('SELECT * FROM agencies WHERE id = ? AND parent_agency_id = ?', [
    req.params.id,
    req.user.agency_id,
  ]);
  if (!child) return res.status(404).json({ error: 'Cliente no encontrado' });
  const { locs } = await db.get('SELECT COUNT(*)::int AS locs FROM locations WHERE agency_id = ?', [child.id]);
  const { kids } = await db.get('SELECT COUNT(*)::int AS kids FROM agencies WHERE parent_agency_id = ?', [child.id]);
  if (locs > 0 || kids > 0)
    return res.status(400).json({ error: 'No se puede eliminar: el cliente tiene sub-cuentas o clientes. Vacíalo primero.' });
  await db.tx(async (t) => {
    await t.run('DELETE FROM users WHERE agency_id = ?', [child.id]);
    await t.run('DELETE FROM agencies WHERE id = ?', [child.id]);
  });
  res.json({ ok: true });
});

module.exports = router;
