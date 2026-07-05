// Lightweight security hardening with no extra dependencies.
//  - securityHeaders: sensible defaults (clickjacking, MIME sniffing, referrer).
//  - rateLimit: in-memory sliding-window limiter per IP+bucket, to blunt
//    brute-force on auth endpoints. On serverless each instance keeps its own
//    window — good enough to slow attacks; a shared store (Redis) is a later
//    upgrade if needed.

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .toString().split(',')[0].trim();
}

// rateLimit({ windowMs, max, bucket }) → middleware.
function rateLimit({ windowMs = 60_000, max = 30, bucket = 'g' } = {}) {
  const hits = new Map(); // key -> [timestamps]
  return (req, res, next) => {
    const now = Date.now();
    const key = `${bucket}:${clientIp(req)}`;
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    // Opportunistic cleanup so the map can't grow unbounded.
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    if (arr.length > max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' });
    }
    next();
  };
}

module.exports = { securityHeaders, rateLimit, clientIp };
