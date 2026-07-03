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

// Server-side filters: sector goes in the query itself; the rest here.
// filters: { min_reviews, max_reviews, min_rating, website: any|with|without, ads: any|with|without }
function applyFilters(results, filters = {}) {
  return results.filter((r) => {
    if (filters.min_reviews != null && (r.reviews || 0) < Number(filters.min_reviews)) return false;
    if (filters.max_reviews != null && filters.max_reviews !== '' && (r.reviews || 0) > Number(filters.max_reviews)) return false;
    if (filters.min_rating != null && filters.min_rating !== '' && (r.rating || 0) < Number(filters.min_rating)) return false;
    if (filters.website === 'with' && !r.website) return false;
    if (filters.website === 'without' && r.website) return false;
    if (filters.ads === 'with' && r.runs_ads !== true) return false;
    if (filters.ads === 'without' && r.runs_ads !== false) return false;
    return true;
  });
}

module.exports = { provider, search, enrich, applyFilters, scanWebsite };
