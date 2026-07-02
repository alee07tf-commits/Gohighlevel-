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
app.use(express.json({ limit: '2mb' }));

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
app.use('/api/public', require('./routes/public'));

// Public funnel pages at pretty URLs (/f/<funnel>/<page>) and booking (/book/<slug>).
app.use('/f', (req, res, next) => {
  req.url = '/f' + req.url;
  require('./routes/public')(req, res, next);
});
app.use('/book', (req, res, next) => {
  req.url = '/book' + req.url;
  require('./routes/public')(req, res, next);
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback for the admin app.
app.get(/^\/(?!api|f\/|book\/).*/, (req, res) => {
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
}

module.exports = app;
