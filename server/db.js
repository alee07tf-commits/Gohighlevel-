// Database layer — Postgres everywhere:
//  - DATABASE_URL set (Supabase or any Postgres) → node-postgres pool.
//  - No DATABASE_URL → embedded PGlite (zero-config Postgres for local dev,
//    tests, and ephemeral demo deploys).
//
// API (all async): db.all(sql, params) → rows · db.get → first row
// db.run → {changes} · db.insert → new id (appends RETURNING id)
// db.tx(fn) → fn receives the same API inside a transaction.
// SQL uses `?` placeholders; they are rewritten to $1..$n automatically.
const path = require('path');
const fs = require('fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agencies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  agency_id INTEGER NOT NULL REFERENCES agencies(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  agency_id INTEGER NOT NULL REFERENCES agencies(id),
  name TEXT NOT NULL,
  company TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  website TEXT DEFAULT '',
  timezone TEXT DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  dnd INTEGER NOT NULL DEFAULT 0,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_location ON contacts(location_id);
CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (contact_id, tag)
);
CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id);
CREATE TABLE IF NOT EXISTS pipelines (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stages (
  id SERIAL PRIMARY KEY,
  pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS opportunities (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opps_location ON opportunities(location_id);
CREATE TABLE IF NOT EXISTS calendars (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  start_hour INTEGER NOT NULL DEFAULT 9,
  end_hour INTEGER NOT NULL DEFAULT 17,
  days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  calendar_id INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','completed','no_show')),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appts_location ON appointments(location_id);
CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unread INTEGER NOT NULL DEFAULT 0,
  UNIQUE (location_id, contact_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  channel TEXT NOT NULL CHECK (channel IN ('sms','email','note')),
  subject TEXT DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE TABLE IF NOT EXISTS email_templates (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
  subject TEXT DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tag_filter TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'sent'
);
CREATE TABLE IF NOT EXISTS workflows (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workflow_actions (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'success',
  log TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS funnels (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS funnel_pages (
  id SERIAL PRIMARY KEY,
  funnel_id INTEGER NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL DEFAULT '[]',
  UNIQUE (funnel_id, slug)
);
CREATE TABLE IF NOT EXISTS form_submissions (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  funnel_page_id INTEGER REFERENCES funnel_pages(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  run_at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','error','cancelled')),
  result TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON scheduled_jobs(status, run_at);
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  token TEXT NOT NULL UNIQUE,
  period_days INTEGER NOT NULL DEFAULT 30,
  narrative TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// Idempotent migrations for databases created by earlier versions.
const MIGRATIONS = `
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS reminder_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE messages ADD CONSTRAINT messages_channel_check CHECK (channel IN ('sms','email','whatsapp','note'));
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_channel_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_channel_check CHECK (channel IN ('email','sms','whatsapp'));
`;

// Rewrites `?` placeholders to Postgres $1..$n.
function numbered(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

let raw; // (sql, params) => Promise<{rows, count}>
let execRaw; // multi-statement DDL
let txRaw; // (fn(rawInTx)) => Promise

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({
    connectionString: url,
    ssl: isLocal || process.env.PGSSL === 'disable' ? undefined : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX) || 5,
    // Fail fast instead of hanging a serverless invocation until the gateway 504s.
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 10000,
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS) || 15000,
  });
  const wrap = (client) => async (sql, params = []) => {
    const res = await client.query(sql, params);
    return { rows: res.rows, count: res.rowCount || 0 };
  };
  raw = wrap(pool);
  // DDL batches get a longer budget than regular queries (first boot on a
  // small instance can exceed the default query timeout).
  execRaw = (sql) => pool.query({ text: sql, query_timeout: 25000 });
  txRaw = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(wrap(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
} else {
  const { PGlite } = require('@electric-sql/pglite');
  let dataDir;
  if (process.env.NODE_ENV === 'test') dataDir = 'memory://';
  else if (process.env.VERCEL) dataDir = '/tmp/leadflow-pglite';
  else dataDir = process.env.PGLITE_DIR || path.join(__dirname, '..', 'data', 'pglite');
  if (dataDir !== 'memory://') fs.mkdirSync(dataDir, { recursive: true });
  const pglite = new PGlite(dataDir);
  const wrap = (q) => async (sql, params = []) => {
    const res = await q(sql, params);
    return { rows: res.rows, count: res.affectedRows ?? res.rows.length };
  };
  raw = wrap((sql, params) => pglite.query(sql, params));
  execRaw = (sql) => pglite.exec(sql);
  txRaw = (fn) => pglite.transaction((t) => fn(wrap((sql, params) => t.query(sql, params))));
}

// Schema init. Bump SCHEMA_VERSION whenever SCHEMA/MIGRATIONS change so
// running deployments apply them once and then skip DDL on every cold start.
const SCHEMA_VERSION = 2;

let readyPromise = null;
function ensureReady() {
  if (!readyPromise) {
    readyPromise = initSchema().catch((err) => {
      readyPromise = null; // allow the next request to retry instead of wedging the instance
      throw err;
    });
  }
  return readyPromise;
}

async function initSchema() {
  try {
    const check = await raw('SELECT MAX(version) AS v FROM schema_meta', []);
    if (Number(check.rows[0] && check.rows[0].v) >= SCHEMA_VERSION) return;
  } catch {
    // schema_meta missing → first boot, fall through to DDL
  }
  // One batch on a single connection. The advisory xact lock serializes
  // concurrent serverless cold starts so parallel instances don't deadlock
  // on catalog locks while running the same CREATE TABLE statements.
  await execRaw(
    `BEGIN;
     SELECT pg_advisory_xact_lock(815051);
     ${SCHEMA}
     ${MIGRATIONS}
     CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
     DELETE FROM schema_meta;
     INSERT INTO schema_meta (version) VALUES (${SCHEMA_VERSION});
     COMMIT;`
  );
}

function makeApi(rawFn) {
  return {
    all: async (sql, params = []) => (await rawFn(numbered(sql), params)).rows,
    get: async (sql, params = []) => (await rawFn(numbered(sql), params)).rows[0],
    run: async (sql, params = []) => ({ changes: (await rawFn(numbered(sql), params)).count }),
    insert: async (sql, params = []) => (await rawFn(numbered(sql) + ' RETURNING id', params)).rows[0].id,
  };
}

const base = makeApi(async (sql, params) => {
  await ensureReady();
  return raw(sql, params);
});

module.exports = {
  ...base,
  ready: ensureReady,
  tx: async (fn) => {
    await ensureReady();
    return txRaw((rawInTx) => fn(makeApi(rawInTx)));
  },
};
