// Small UI helpers: escaping, modals, drawers, toasts, form serialization.

// Professional inline line-icons (no emoji). `icon(name)` returns an <svg> string.
const ICON_PATHS = {
  contact: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/>',
  tag: '<path d="M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M14 20v-4h4"/>',
  appointment: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  automation: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  opportunity: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  inbox: '<path d="M4 13h4l2 3h4l2-3h4"/><path d="M4 13 6 4h12l2 9v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
};
export function icon(name, size = 16) {
  const p = ICON_PATHS[name] || ICON_PATHS.note;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

export function esc(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function toast(message, isError = false) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function closeOverlay() {
  document.getElementById('modal-root').innerHTML = '';
}

// Renders html inside a modal (or drawer). Returns the container element.
// Clicking the backdrop closes it.
export function openModal(html, { drawer = false } = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="${drawer ? 'drawer' : 'modal'}-backdrop">
    <div class="${drawer ? 'drawer' : 'modal'}">${html}</div></div>`;
  const backdrop = root.firstElementChild;
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) closeOverlay();
  });
  return backdrop.firstElementChild;
}

export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export function fmtMoney(value) {
  return '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fullName(obj) {
  return [obj.first_name, obj.last_name].filter(Boolean).join(' ') || obj.email || obj.phone || 'Unknown';
}

export function initials(obj) {
  const name = fullName(obj);
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
