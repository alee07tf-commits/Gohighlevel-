// Sub-account provisioning — the shared pipeline used by BOTH manual creation
// (routes/locations.js) and self-serve SaaS signup (routes/public.js): create
// the location, auto-load a snapshot template, seed business custom values,
// optionally create the client user, and initialize the wallet. Mirrors
// GoHighLevel's "create sub-account from snapshot" flow.
const bcrypt = require('bcryptjs');
const db = require('../db');
const snapshots = require('./snapshots');

function defaultCustomValues({ name, company, phone, email, website }) {
  return [
    { key: 'business_name', label: 'Nombre del negocio', value: name || company || '' },
    { key: 'main_phone', label: 'Teléfono principal', value: phone || '' },
    { key: 'business_email', label: 'Email del negocio', value: email || '' },
    { key: 'website', label: 'Sitio web', value: website || '' },
    { key: 'address', label: 'Dirección', value: '' },
    { key: 'booking_link', label: 'Enlace de reservas', value: '' },
  ];
}

function parseSnap(snap) {
  if (!snap) return null;
  try {
    return JSON.parse(snap.data || '{}');
  } catch {
    return {};
  }
}

// Resolves which snapshot a new sub-account should load: explicit id, else the
// agency default. Returns the snapshot row or null. `snapshotId === 0` forces
// an empty account (no template).
async function resolveSnapshot(agencyId, snapshotId) {
  if (snapshotId === 0) return null;
  if (snapshotId) return db.get('SELECT * FROM snapshots WHERE id = ? AND agency_id = ?', [snapshotId, agencyId]);
  return db.get('SELECT * FROM snapshots WHERE agency_id = ? AND is_default = 1 ORDER BY id DESC LIMIT 1', [agencyId]);
}

// Creates and fully provisions a sub-account in its own transaction.
// opts: { agencyId, profile:{name,company,phone,email,website,timezone},
//         snapshot (row) | snapshotId, client:{name,email,password} }
// The snapshot is resolved BEFORE the transaction opens — the embedded DB is a
// single connection, so querying the global handle inside a live tx deadlocks.
async function provisionSubAccount(opts) {
  const snapshot = opts.snapshot !== undefined ? opts.snapshot : await resolveSnapshot(opts.agencyId, opts.snapshotId);
  return db.tx((t) => provisionInTx(t, { ...opts, snapshot }));
}

async function provisionInTx(t, { agencyId, profile = {}, snapshot, client }) {
  const { name, company = '', phone = '', email = '', website = '', timezone = 'UTC' } = profile;
  const snapData = parseSnap(snapshot);

  const locId = await t.insert(
    `INSERT INTO locations (agency_id, name, company, phone, email, website, timezone, source_snapshot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [agencyId, name, company, phone, email, website, timezone, snapshot ? snapshot.id : null]
  );

  const provisioned = snapData ? await snapshots.applySnapshot(t, locId, snapData) : {};

  let cvSeeded = provisioned.custom_values || 0;
  for (const cv of defaultCustomValues({ name, company, phone, email, website })) {
    const exists = await t.get('SELECT id FROM custom_values WHERE location_id = ? AND key = ?', [locId, cv.key]);
    if (exists) continue;
    await t.run('INSERT INTO custom_values (location_id, key, label, value) VALUES (?, ?, ?, ?)', [locId, cv.key, cv.label, cv.value]);
    cvSeeded++;
  }

  // Every sub-account gets a wallet (used by SaaS rebilling; harmless otherwise).
  await t.run('INSERT INTO wallets (location_id) VALUES (?) ON CONFLICT (location_id) DO NOTHING', [locId]);

  let clientUserId = null;
  if (client && client.email && client.password) {
    const dupe = await t.get('SELECT id FROM users WHERE email = ?', [client.email]);
    if (!dupe) {
      clientUserId = await t.insert(
        'INSERT INTO users (agency_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        [agencyId, client.name || name, client.email, bcrypt.hashSync(client.password, 10), 'member']
      );
      await t.run('INSERT INTO user_locations (user_id, location_id) VALUES (?, ?)', [clientUserId, locId]);
    }
  }

  return { locId, clientUserId, snapshot: snapshot ? snapshot.name : null, provisioned: { ...provisioned, custom_values: cvSeeded } };
}

module.exports = { provisionSubAccount, resolveSnapshot, defaultCustomValues };
