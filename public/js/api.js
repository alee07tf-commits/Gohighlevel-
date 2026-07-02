// API client + session state.
export const state = {
  token: localStorage.getItem('lf_token') || null,
  user: null,
  agency: null,
  locations: [],
  locationId: Number(localStorage.getItem('lf_location')) || null,
};

export function setSession(token) {
  state.token = token;
  localStorage.setItem('lf_token', token);
}

export function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('lf_token');
  localStorage.removeItem('lf_location');
}

export function setLocation(id) {
  state.locationId = Number(id);
  localStorage.setItem('lf_location', String(id));
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (state.token) opts.headers.Authorization = `Bearer ${state.token}`;
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
  const me = await api('/auth/me');
  state.user = me.user;
  state.agency = me.agency;
  state.locations = me.locations;
  if (!state.locationId || !me.locations.some((l) => l.id === state.locationId)) {
    if (me.locations[0]) setLocation(me.locations[0].id);
  }
  return me;
}
