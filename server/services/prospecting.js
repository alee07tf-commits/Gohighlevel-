// Prospecting: find local businesses on Google and turn them into contacts +
// opportunities. Providers (connector pattern like everything else):
//   GOOGLE_PLACES_API_KEY → official Google Places API (recommended, legal,
//                           ~$200/month free tier)
//   SERPER_API_KEY        → serper.dev Google Maps search (cheap alternative)
//   (none)                → clearly-labeled simulated results so the module
//                           is explorable before connecting a key
function provider() {
  if (process.env.GOOGLE_PLACES_API_KEY) return 'google_places';
  if (process.env.SERPER_API_KEY) return 'serper';
  return 'simulated';
}

function simulatedResults(query) {
  const base = query.replace(/en .+$/i, '').trim() || 'Negocio';
  const zone = (query.match(/en (.+)$/i) || [])[1] || 'tu zona';
  const names = ['Centro', 'Clínica', 'Estudio', 'Grupo', 'Espacio', 'Casa', 'Taller', 'Instituto'];
  return names.map((n, i) => ({
    name: `${n} ${base.charAt(0).toUpperCase() + base.slice(1)} ${['Plus', 'Pro', 'Premium', zone, 'Central', 'Express', '24h', '& Co'][i]}`.slice(0, 60),
    address: `Calle Ejemplo ${10 + i * 7}, ${zone}`,
    phone: `+34 6${String(10000000 + i * 1234567).slice(0, 8)}`,
    website: i % 3 === 0 ? '' : `https://ejemplo-${i}.com`,
    rating: Math.round((3.4 + (i % 5) * 0.4) * 10) / 10,
    reviews: 12 + i * 23,
    maps_url: '',
    demo: true,
  }));
}

async function searchGooglePlaces(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask':
        'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri',
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 20 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Google Places ${res.status}`);
  return (data.places || []).map((p) => ({
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    phone: p.nationalPhoneNumber || '',
    website: p.websiteUri || '',
    rating: p.rating || null,
    reviews: p.userRatingCount || 0,
    maps_url: p.googleMapsUri || '',
  }));
}

async function searchSerper(query) {
  const res = await fetch('https://google.serper.dev/maps', {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Serper ${res.status}`);
  return (data.places || []).map((p) => ({
    name: p.title || '',
    address: p.address || '',
    phone: p.phoneNumber || '',
    website: p.website || '',
    rating: p.rating || null,
    reviews: p.ratingCount || 0,
    maps_url: p.placeId ? `https://www.google.com/maps/place/?q=place_id:${p.placeId}` : '',
  }));
}

async function search(query) {
  const p = provider();
  if (p === 'google_places') return { provider: p, results: await searchGooglePlaces(query) };
  if (p === 'serper') return { provider: p, results: await searchSerper(query) };
  return { provider: p, results: simulatedResults(query) };
}

// ---- Ads/tech detection ----
// Fetches each prospect's website (best effort, short timeout) and scans the
// HTML for advertising & tracking signals — the same heuristic BuiltWith-style
// tools use. A Google Ads conversion tag (AW-…) or Meta Pixel on the site is
// the standard signal that the business is actively running paid ads.
const SIGNALS = [
  { key: 'google_ads', re: /(AW-\d{6,})|googleadservices\.com|googleads\.g\.doubleclick|google_conversion_id/i },
  { key: 'meta_pixel', re: /fbq\s*\(|connect\.facebook\.net\/[a-z_]+\/fbevents/i },
  { key: 'tag_manager', re: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/ },
  { key: 'analytics', re: /googletagmanager\.com\/gtag|google-analytics\.com|gtag\s*\(/i },
  { key: 'tiktok_pixel', re: /analytics\.tiktok\.com|ttq\.load/i },
];

async function scanWebsite(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url.startsWith('http') ? url : `https://${url}`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadFlowBot/1.0)' },
    });
    const html = (await res.text()).slice(0, 400_000);
    const tech = {};
    for (const s of SIGNALS) tech[s.key] = s.re.test(html);
    return { ok: true, tech, runs_ads: tech.google_ads || tech.meta_pixel || tech.tiktok_pixel };
  } catch {
    return { ok: false, tech: {}, runs_ads: null }; // unknown (site unreachable)
  } finally {
    clearTimeout(timer);
  }
}

// Enrich all prospects that have a website, with bounded concurrency.
async function enrich(results, concurrency = 6) {
  const queue = [...results.entries()];
  async function worker() {
    while (queue.length) {
      const [i, r] = queue.shift();
      if (r.demo) {
        // Deterministic demo flags so the filters are testable without keys.
        const ads = Boolean(r.website) && i % 2 === 0;
        results[i] = {
          ...r,
          enriched: true,
          runs_ads: r.website ? ads : false,
          tech: { google_ads: ads, meta_pixel: ads && i % 4 === 0, analytics: Boolean(r.website), tag_manager: i % 3 === 0, tiktok_pixel: false },
        };
        continue;
      }
      if (!r.website) {
        results[i] = { ...r, enriched: true, runs_ads: false, tech: {} };
        continue;
      }
      const scan = await scanWebsite(r.website);
      results[i] = { ...r, enriched: scan.ok, runs_ads: scan.runs_ads, tech: scan.tech };
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// Server-side filters. `active_ads` = running ads right now on Meta
// (Facebook/Instagram), the only real-time source we trust.
function applyFilters(results, filters = {}) {
  return results.filter((r) => {
    if (filters.min_reviews != null && (r.reviews || 0) < Number(filters.min_reviews)) return false;
    if (filters.max_reviews != null && filters.max_reviews !== '' && (r.reviews || 0) > Number(filters.max_reviews)) return false;
    if (filters.min_rating != null && filters.min_rating !== '' && (r.rating || 0) < Number(filters.min_rating)) return false;
    if (filters.website === 'with' && !r.website) return false;
    if (filters.website === 'without' && r.website) return false;
    if (filters.active_ads === 'with' && r.active_ads !== true) return false;
    if (filters.active_ads === 'without' && r.active_ads !== false) return false;
    return true;
  });
}

module.exports = { provider, search, enrich, applyFilters, scanWebsite };

// ===================================================================
// Real-time active-ads detection (NOT pixels).
// We report whether a business is running ads RIGHT NOW on Meta
// (Facebook/Instagram) using the official Meta Ad Library API
// [META_AD_LIBRARY_TOKEN] — the one source that is free, official and
// accurate enough to sell on. Google Ads/Maps have no reliable free source,
// so we deliberately do NOT claim ad status for them; Google Places/Maps is
// used only for normal business discovery (see provider() above).
// Meta returns null = "unknown" when unreachable — never a false no.
// ===================================================================
function adsProvider() {
  return process.env.META_AD_LIBRARY_TOKEN ? 'meta' : 'simulated';
}
function adsEnabled() {
  return Boolean(process.env.META_AD_LIBRARY_TOKEN);
}

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(clinica|dental|centro|grupo|estudio|the|de|la|el|los|las|and|y)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// True when a Facebook page name plausibly IS this business (not just a text
// match), so we only count ads that really belong to it.
function pageMatchesBusiness(business, pageName) {
  const b = normName(business);
  const p = normName(pageName);
  if (!b || !p) return false;
  if (p.includes(b) || b.includes(p)) return true;
  const bt = new Set(b.split(' ').filter((w) => w.length > 2));
  const pt = new Set(p.split(' ').filter((w) => w.length > 2));
  if (!bt.size) return false;
  let hit = 0;
  for (const w of bt) if (pt.has(w)) hit++;
  return hit / bt.size >= 0.6; // most distinctive words shared
}

// ---- Meta Ad Library (official) → currently ACTIVE ads that really belong
// to this business (filtered by page-name match for accuracy). Returns
// { count, pages } or null when unavailable. ----
async function checkMetaActiveAds(name, country = process.env.ADS_COUNTRY || 'ES') {
  if (!process.env.META_AD_LIBRARY_TOKEN) return null;
  const params = new URLSearchParams({
    access_token: process.env.META_AD_LIBRARY_TOKEN,
    search_terms: name,
    ad_active_status: 'ACTIVE',
    ad_reached_countries: `["${country}"]`,
    ad_type: 'ALL',
    fields: 'id,page_name',
    limit: '100',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/ads_archive?${params}`, { signal: controller.signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Meta ${res.status}`);
    const rows = Array.isArray(data.data) ? data.data : [];
    const matched = rows.filter((a) => pageMatchesBusiness(name, a.page_name));
    const pages = [...new Set(matched.map((a) => a.page_name).filter(Boolean))];
    return { count: matched.length, pages };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Adds real-time Meta ad status to prospects (bounded concurrency).
// Demo rows get deterministic values so filters stay testable without a token.
async function checkActiveAds(results, concurrency = 5) {
  const queue = [...results.entries()];
  async function worker() {
    while (queue.length) {
      const [i, r] = queue.shift();
      if (r.demo) {
        const count = i % 3 === 0 ? (i % 2) + 1 : 0;
        results[i] = {
          ...r,
          ads_live: true,
          meta_active_ads: count,
          meta_pages: count ? [`${r.name}`] : [],
          live: { meta: count > 0, meta_count: count },
          active_ads: count > 0,
        };
        continue;
      }
      const meta = await checkMetaActiveAds(r.name);
      const known = meta !== null;
      results[i] = {
        ...r,
        ads_live: known,
        meta_active_ads: known ? meta.count : null,
        meta_pages: known ? meta.pages : [],
        live: {
          meta: known ? meta.count > 0 : null,
          meta_count: known ? meta.count : null,
        },
        active_ads: known ? meta.count > 0 : null,
      };
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

module.exports.adsProvider = adsProvider;
module.exports.adsEnabled = adsEnabled;
module.exports.checkActiveAds = checkActiveAds;
module.exports.checkMetaActiveAds = checkMetaActiveAds;
