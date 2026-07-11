// Empleado IA: global copilot endpoint. The client sends the running chat
// history plus the new message; the agent loop answers and/or executes tools.
const express = require('express');
const { requireAuth, requireLocation } = require('../auth');
const copilot = require('../services/copilot');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.post('/', async (req, res) => {
  const { message, history } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'Escribe un mensaje' });
  try {
    const result = await copilot.run({
      locationId: req.location.id,
      agencyId: req.user.agency_id,
      userId: req.user.id,
      locationName: req.location.name,
      userName: req.user.name,
      message: String(message),
      history: Array.isArray(history) ? history : [],
    });
    // SaaS rebilling: each real AI run debits the wallet like other AI usage.
    if (result.generated_by === 'claude') {
      try { await require('../services/billing').recordUsage(req.location.id, 'ai', 1); } catch { /* best effort */ }
    }
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
