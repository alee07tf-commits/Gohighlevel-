// Content AI endpoints (Claude). Enabled with ANTHROPIC_API_KEY; the UI
// shows a friendly message otherwise.
const express = require('express');
const { requireAuth, requireLocation } = require('../auth');
const ai = require('../services/ai');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/status', (req, res) => res.json({ enabled: ai.enabled() }));

// kind: email | sms | whatsapp | funnel
router.post('/generate', async (req, res) => {
  const { kind = 'email', prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  try {
    const business = `${req.location.name}${req.location.company ? ` (${req.location.company})` : ''}`;
    const result = await ai.generateCopy({ kind, prompt, business });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
