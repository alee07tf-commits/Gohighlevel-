// Stripe webhook helpers (v3.7). Signature verification for the Stripe-Signature
// header (t=…,v1=… HMAC-SHA256 hex over "<t>.<rawBody>") so subscription
// lifecycle events can be trusted without re-fetching. Checkout settlement keeps
// re-fetching the session (see routes/webhooks.js) for defence in depth.
const crypto = require('crypto');

function verifySignature(header, rawBody, secret) {
  if (!secret) return true; // not configured → skip (dev)
  if (!header || !rawBody) return false;
  const parts = Object.fromEntries(String(header).split(',').map((kv) => kv.split('=').map((s) => s.trim())));
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { verifySignature };
