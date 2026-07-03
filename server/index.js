const express = require('express');
const path = require('path');
require('./db'); // initialize schema (async; queries await readiness)

// Demo-mode seeding: on Vercel WITHOUT a DATABASE_URL the embedded database
// lives in /tmp and resets on cold starts, so re-seed the demo agency there.
// With Supabase/Postgres connected, data is persistent and seeding is opt-in
// via AUTO_SEED=1.
if ((process.env.VERCEL && !process.env.DATABASE_URL) || process.env.AUTO_SEED) {
  require('./demo-seed')
    .seedDemo()
    .catch((err) => console.error('Auto-seed failed:', err));
}

const app = express();
app.use(express.json({ limit: '4mb' }));

// Lazy scheduler tick: on serverless there is no resident interval, so any
// traffic opportunistically processes due jobs (throttled to 1/min).
const scheduler = require('./services/scheduler');
app.use((req, res, next) => {
  scheduler.lazyTick();
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/pipelines', require('./routes/pipelines'));
app.use('/api/calendars', require('./routes/calendars'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/marketing', require('./routes/marketing'));
app.use('/api/workflows', require('./routes/workflows'));
app.use('/api/funnels', require('./routes/funnels'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/system', require('./routes/system'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/custom-fields', require('./routes/custom-fields'));
app.use('/api/reputation', require('./routes/reputation'));
app.use('/api/snapshots', require('./routes/snapshots'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/cron', require('./routes/cron'));
app.use('/api/public', require('./routes/public'));
app.use('/api/public/chat', require('./routes/chat-public'));
app.get('/widget.js', require('./routes/chat-public').widgetScript);

// Public pretty URLs: funnels (/f/...), booking (/book/...), reports (/r/...),
// invoice payment (/pay/...) and review gate (/review/...).
for (const prefix of ['/f', '/book', '/r', '/pay', '/review', '/l']) {
  app.use(prefix, (req, res, next) => {
    req.url = prefix + req.url;
    require('./routes/public')(req, res, next);
  });
}

app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback for the admin app.
app.get(/^\/(?!api|f\/|book\/|r\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`LeadFlow running on http://localhost:${PORT}`));
  // Resident scheduler when running as a long-lived server.
  setInterval(() => scheduler.tick().catch((e) => console.error('tick failed:', e.message)), 30_000);
}

module.exports = app;
