// API client + session state.
export const state = {
  token: localStorage.getItem('lf_token') || null,
  user: null,
  agency: null, // effective scope (may be a client we've drilled into)
  homeAgency: null, // the tenant the logged-in user belongs to
  parentAgency: null, // set when acting inside a child → enables "← back"
  actingAsChild: false,
  clientCount: 0,
  canManageClients: false,
  locations: [],
  locationId: Number(localStorage.getItem('lf_location')) || null,
  // The agency scope we operate on (X-Agency-Id). null → the user's home agency.
  agencyId: Number(localStorage.getItem('lf_agency')) || null,
};

export function setSession(token) {
  state.token = token;
  localStorage.setItem('lf_token', token);
  // A fresh login always starts in the user's own home scope.
  localStorage.removeItem('lf_agency');
  localStorage.removeItem('lf_location');
  state.agencyId = null;
  state.locationId = null;
}

export function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('lf_token');
  localStorage.removeItem('lf_location');
  localStorage.removeItem('lf_agency');
  state.agencyId = null;
  state.locationId = null;
}

export function setLocation(id) {
  state.locationId = Number(id);
  localStorage.setItem('lf_location', String(id));
}

// Switch the agency scope (drill into a client, or go back up). Locations are
// scoped per-agency, so clear the current sub-account and let loadMe re-pick.
export function setAgency(id) {
  if (id) {
    state.agencyId = Number(id);
    localStorage.setItem('lf_agency', String(id));
  } else {
    state.agencyId = null;
    localStorage.removeItem('lf_agency');
  }
  state.locationId = null;
  localStorage.removeItem('lf_location');
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (state.token) opts.headers.Authorization = `Bearer ${state.token}`;
  if (state.agencyId) opts.headers['X-Agency-Id'] = String(state.agencyId);
  if (state.locationId) opts.headers['X-Location-Id'] = String(state.locationId);
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    clearSession();
    location.hash = '#/login';
    throw new Error('Session expired');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function loadMe() {
  let me;
  try {
    me = await api('/auth/me');
  } catch (err) {
    // A stale drilled-in agency scope (e.g. the client was removed) → drop it
    // and retry in the home scope so the app still loads.
    if (state.agencyId) {
      setAgency(null);
      me = await api('/auth/me');
    } else throw err;
  }
  state.user = me.user;
  state.agency = me.agency;
  state.homeAgency = me.homeAgency || me.agency;
  state.parentAgency = me.parentAgency || null;
  state.actingAsChild = !!me.actingAsChild;
  state.clientCount = me.clientCount || 0;
  state.canManageClients = !!me.canManageClients;
  state.locations = me.locations;
  // Keep agencyId in sync with the effective scope the server resolved.
  state.agencyId = me.agency ? me.agency.id : state.agencyId;
  if (!state.locationId || !me.locations.some((l) => l.id === state.locationId)) {
    if (me.locations[0]) setLocation(me.locations[0].id);
    else state.locationId = null;
  }
  return me;
}
