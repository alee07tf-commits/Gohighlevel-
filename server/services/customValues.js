// Account-level custom values ({{custom_values.KEY}} tokens). Filled in once
// per sub-account so a single snapshot template can be reused across clients.
const db = require('../db');

// Returns a plain { key: value } map for a location.
async function getMap(locationId) {
  const rows = await db.all('SELECT key, value FROM custom_values WHERE location_id = ?', [locationId]);
  const map = {};
  for (const r of rows) map[r.key] = r.value || '';
  return map;
}

// Resolves {{custom_values.KEY}} (and short alias {{cv.KEY}}) in any text.
// Unknown keys collapse to '' so half-filled templates never leak raw tokens.
function apply(text, map = {}) {
  if (!text) return text || '';
  return String(text).replace(/\{\{\s*(?:custom_values|cv)\.([a-z0-9_]+)\s*\}\}/gi, (_, key) =>
    map[key] !== undefined ? String(map[key]) : ''
  );
}

module.exports = { getMap, apply };
