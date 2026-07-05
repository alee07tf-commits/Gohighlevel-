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
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_channel_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_channel_check CHECK (channel IN ('email','sms','whatsapp'));

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  number TEXT NOT NULL,
  title TEXT DEFAULT '',
  items TEXT NOT NULL DEFAULT '[]',
  currency TEXT NOT NULL DEFAULT 'EUR',
  total DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','void')),
  token TEXT NOT NULL UNIQUE,
  due_date TEXT DEFAULT '',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  notes TEXT DEFAULT '',
  due_at TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS custom_fields (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  UNIQUE (location_id, key)
);
CREATE TABLE IF NOT EXISTS review_requests (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  rating INTEGER,
  comment TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','opened','reviewed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS brand_color TEXT DEFAULT '#4f46e5';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT '';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS review_link_google TEXT DEFAULT '';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS review_link_facebook TEXT DEFAULT '';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS briefing_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS briefing_hour INTEGER NOT NULL DEFAULT 8;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS briefing_email TEXT DEFAULT '';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id);
ALTER TABLE funnel_pages ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'clean';

ALTER TABLE locations ADD COLUMN IF NOT EXISTS ai_agent_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS ai_agent_prompt TEXT DEFAULT '';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS public_token TEXT;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE messages ADD CONSTRAINT messages_channel_check CHECK (channel IN ('sms','email','whatsapp','chat','note'));
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_at TIMESTAMPTZ;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check CHECK (status IN ('draft','scheduled','sent'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'invoice';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recurring TEXT NOT NULL DEFAULT '';
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS missed_call_text TEXT DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_public_token ON conversations(public_token) WHERE public_token IS NOT NULL;
CREATE TABLE IF NOT EXISTS smart_lists (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS user_locations (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, location_id)
);
CREATE TABLE IF NOT EXISTS trigger_links (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  tag TEXT DEFAULT '',
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Snapshots: an agency-level library of reusable sub-account templates
-- (structural config serialized as JSON). One can be marked default and is
-- auto-loaded when a new sub-account is created.
CREATE TABLE IF NOT EXISTS snapshots (
  id SERIAL PRIMARY KEY,
  agency_id INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Custom Values: account-level constants ({{custom_values.KEY}}) that let one
-- snapshot template be reused across clients — filled in per sub-account.
CREATE TABLE IF NOT EXISTS custom_values (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT DEFAULT '',
  value TEXT DEFAULT '',
  UNIQUE (location_id, key)
);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS onboarded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS source_snapshot_id INTEGER;

-- Per-scope integration credentials (Phase 2). Credentials resolve in a
-- cascade: location_integrations then agency_integrations then env vars.
-- The config column is an encrypted JSON blob (see services/secretbox.js).
CREATE TABLE IF NOT EXISTS agency_integrations (
  id SERIAL PRIMARY KEY,
  agency_id INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agency_id, provider)
);
CREATE TABLE IF NOT EXISTS location_integrations (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, provider)
);

-- SaaS Mode (Phase 3): the agency resells LeadFlow. Plans are the products a
-- client buys; a subscription ties a sub-account to a plan; wallets + usage
-- power rebilling of metered channels with an agency markup.
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  agency_id INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  interval TEXT NOT NULL DEFAULT 'monthly',
  snapshot_id INTEGER,
  features TEXT NOT NULL DEFAULT '{}',
  rebilling TEXT NOT NULL DEFAULT '{}',
  is_public INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  agency_id INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
  client_user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  stripe_subscription_id TEXT DEFAULT '',
  stripe_customer_id TEXT DEFAULT '',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallets (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL UNIQUE REFERENCES locations(id) ON DELETE CASCADE,
  balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  auto_recharge INTEGER NOT NULL DEFAULT 0,
  threshold DOUBLE PRECISION NOT NULL DEFAULT 5,
  recharge_amount DOUBLE PRECISION NOT NULL DEFAULT 20
);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL,
  kind TEXT NOT NULL DEFAULT 'usage',
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usage_events (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  qty DOUBLE PRECISION NOT NULL DEFAULT 1,
  base_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  billed_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS brand_color TEXT DEFAULT '#4f46e5';
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT '';
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS signup_headline TEXT DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_agencies_slug ON agencies(slug) WHERE slug IS NOT NULL;

-- Recursive tenancy (Phase 4): an agency can belong to a parent agency. The
-- root agency (parent NULL) is the platform operator (e.g. Upcross); each
-- client it creates is a child agency that in turn owns its sub-accounts and,
-- if it resells, its own child agencies. Scope resolves by walking this tree
-- (see server/auth.js: effective agency via the X-Agency-Id header).
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS parent_agency_id INTEGER REFERENCES agencies(id);
CREATE INDEX IF NOT EXISTS idx_agencies_parent ON agencies(parent_agency_id);

-- Training / onboarding (Phase 4): recursive too. A course is authored by a
-- tenant (agency_id) and is visible to that tenant and all of its descendants,
-- so an upper tenant trains the ones below it. Videos are YouTube embeds
-- (youtube_id only) — no file hosting.
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  agency_id INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_published INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_courses_agency ON courses(agency_id);
CREATE TABLE IF NOT EXISTS lessons (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  youtube_id TEXT DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id);
CREATE TABLE IF NOT EXISTS course_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);
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
      client.release();
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // rollback can fail on a broken connection; destroying below handles it
      }
      // Destroy the connection instead of returning it to the pool — after a
      // timeout mid-transaction the stream state is unreliable and a reused
      // client wedges every later request.
      client.release(err);
      throw err;
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
const SCHEMA_VERSION = 11;

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
