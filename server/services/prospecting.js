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

module.exports = { provider, search };
