// Outbound app sync (v3.8). When a CRM event fires, push it to the connected
// apps that react to it, using each connection's stored OAuth token. Best-effort
// and non-blocking: a failure here never breaks an automation. The request
// builders are pure (unit-tested); the live HTTP calls run only when a real
// token is present, so this stays dormant until an account is actually connected.
const db = require('../db');
const secretbox = require('./secretbox');

// CRM event → apps that handle it.
const HANDLERS = {
  appointment_booked: ['google', 'zoom'],
  contact_created: ['hubspot'],
};

function tokenOf(acct) {
  try { return (secretbox.decrypt(acct.access_token) || {}).v || ''; } catch { return ''; }
}

// ---- Pure request builders ----
function googleEventBody(event = {}, contact = {}) {
  const who = `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
  return {
    summary: event.title || 'Cita',
    description: [who, contact.email, contact.phone].filter(Boolean).join(' · '),
    start: { dateTime: event.start_time || event.starts_at },
    end: { dateTime: event.end_time || event.ends_at },
    attendees: contact.email ? [{ email: contact.email }] : [],
  };
}
function zoomMeetingBody(event = {}) {
  return { topic: event.title || 'Cita', type: 2, start_time: event.start_time || event.starts_at, settings: { join_before_host: true } };
}
function hubspotContactBody(contact = {}) {
  return { properties: { email: contact.email || '', firstname: contact.first_name || '', lastname: contact.last_name || '', phone: contact.phone || '' } };
}

const ENDPOINTS = {
  google: { url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events', body: googleEventBody },
  zoom: { url: 'https://api.zoom.us/v2/users/me/meetings', body: (e) => zoomMeetingBody(e) },
  hubspot: { url: 'https://api.hubapi.com/crm/v3/objects/contacts', body: (e, c) => hubspotContactBody(c) },
};

async function callProvider(appKey, acct, event, contact) {
  const token = tokenOf(acct);
  const def = ENDPOINTS[appKey];
  if (!token || !def) return { skipped: true };
  const resp = await fetch(def.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(def.body(event, contact)),
  });
  return { ok: resp.ok, status: resp.status };
}

// Dispatch a CRM event to every connected handler for this sub-account. Always
// resolves; logs and swallows any error so callers can fire-and-forget.
async function dispatch(locationId, eventType, contact, event = {}) {
  try {
    const apps = HANDLERS[eventType];
    if (!apps || !contact) return [];
    const ph = apps.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT * FROM connected_accounts WHERE location_id = ? AND app IN (${ph}) AND status = 'connected'`,
      [locationId, ...apps]
    );
    const out = [];
    for (const acct of rows) {
      try { out.push({ app: acct.app, ...(await callProvider(acct.app, acct, event, contact)) }); }
      catch (err) { out.push({ app: acct.app, error: err.message }); }
    }
    return out;
  } catch (err) {
    console.error('appsync dispatch failed:', err.message);
    return [];
  }
}

module.exports = { dispatch, HANDLERS, googleEventBody, zoomMeetingBody, hubspotContactBody, callProvider };
