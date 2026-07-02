// Scheduler tick endpoint for Vercel Cron or any external pinger
// (e.g. cron-job.org hitting it every 5 minutes).
// If CRON_SECRET is set, requests must carry it:
//   Authorization: Bearer <CRON_SECRET>   (Vercel Cron does this automatically)
//   or ?secret=<CRON_SECRET>
const express = require('express');
const scheduler = require('../services/scheduler');

const router = express.Router();

router.get('/tick', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = (req.headers.authorization || '').replace('Bearer ', '') || req.query.secret;
    if (provided !== secret) return res.status(401).json({ error: 'Invalid cron secret' });
  }
  const processed = await scheduler.tick();
  res.json({ ok: true, processed });
});

module.exports = router;
