// Small UI helpers: escaping, modals, drawers, toasts, form serialization.
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
