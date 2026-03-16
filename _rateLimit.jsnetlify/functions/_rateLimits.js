// netlify/functions/_rateLimit.js
// Shared rate limiter — same architecture as production-proven Aura app

const store = new Map();
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function maybeCleanup(windowMs) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  const expiry = now - windowMs * 2;
  for (const [ip, data] of store) {
    if (!data.timestamps.length || data.timestamps[data.timestamps.length - 1] < expiry) {
      store.delete(ip);
    }
  }
}

function checkRateLimit(ip, maxReqs, windowMs, blockMs = 15 * 60 * 1000) {
  const now = Date.now();
  maybeCleanup(windowMs);

  const entry = store.get(ip) || { timestamps: [], blockedUntil: 0 };

  if (entry.blockedUntil && now < entry.blockedUntil) {
    return { limited: true, retryAfterSec: Math.ceil((entry.blockedUntil - now) / 1000) };
  }

  const windowStart = now - windowMs;
  entry.timestamps = entry.timestamps.filter(t => t > windowStart);

  if (entry.timestamps.length >= maxReqs) {
    entry.blockedUntil = now + blockMs;
    store.set(ip, entry);
    return { limited: true, retryAfterSec: Math.ceil(blockMs / 1000) };
  }

  entry.timestamps.push(now);
  store.set(ip, entry);
  return { limited: false, retryAfterSec: 0 };
}

function getClientIP(headers) {
  return (headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

module.exports = { checkRateLimit, getClientIP };
