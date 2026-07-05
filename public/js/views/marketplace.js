import { api, state } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate } from '../ui.js';
import { t } from '../i18n.js';

// Simple line-art badge per app category (kept inline, no external assets).
const APP_ICON = {
  meta: '<svg viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
  google: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>',
  shopify: '<svg viewBox="0 0 24 24"><path d="M6 7l-2 13 8 2 8-2-2-13z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
  zoom: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>',
  stripe: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  paypal: '<svg viewBox="0 0 24 24"><path d="M7 20l2-14h6a4 4 0 0 1 0 8H9"/></svg>',
  quickbooks: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24"><path d="M3 21l1.6-4A8 8 0 1 1 8 19.4z"/></svg>',
};

function badge(app, conn) {
  if (conn) return `<span class="tag" style="background:var(--success-bg,#e6f7ec);color:var(--success,#137333)">✓ ${t('Conectado', 'Connected')}</span>`;
  if (app.status === 'soon') return `<span class="tag muted">${t('Próximamente', 'Coming soon')}</span>`;
  if (!app.configured) return `<span class="tag" style="background:#fff4e5;color:#a15c00">${t('Config. pendiente', 'Setup pending')}</span>`;
  return `<span class="tag">${t('Disponible', 'Available')}</span>`;
}

export async function renderMarketplace(view) {
  // Surface the OAuth round-trip result (callback redirects with a query param).
  const q = new URLSearchParams(location.search);
  if (q.get('connected')) { toast(`${t('Conectado', 'Connected')}: ${q.get('connected')}`); history.replaceState(null, '', location.pathname + location.hash); }
  if (q.get('integration_error')) { toast(`${t('Error al conectar', 'Connection error')}: ${q.get('integration_error')}`, true); history.replaceState(null, '', location.pathname + location.hash); }

  const { catalog, categories, connected } = await api('/apps');
  const isAdmin = state.user?.role === 'admin';

  const groups = {};
  for (const app of catalog) (groups[app.category] ||= []).push(app);

  const lang = 0; // blurb index handled by t via array
  const card = (app) => {
    const conn = connected[app.key];
    const disabled = app.status === 'soon' || (!app.configured && !conn);
    return `<div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div class="flex" style="align-items:flex-start;gap:10px">
        <span class="app-ic" style="width:34px;height:34px;flex:none;display:grid;place-items:center;border-radius:9px;background:var(--surface-2,#f3f4f6)">${APP_ICON[app.key] || ''}</span>
        <div style="flex:1;min-width:0">
          <div class="flex" style="gap:6px;align-items:center"><strong>${esc(app.name)}</strong>${badge(app, conn)}</div>
          <p class="muted" style="font-size:12.5px;margin:4px 0 0">${esc(t(app.blurb[0], app.blurb[1]))}</p>
        </div>
      </div>
      ${conn ? `<div class="muted" style="font-size:11.5px">${t('Conectado', 'Connected')} ${conn.connected_at ? fmtDate(conn.connected_at) : ''}${conn.display_name ? ` · ${esc(conn.display_name)}` : ''}</div>` : ''}
      <div class="flex" style="gap:6px;margin-top:auto">
        ${conn
          ? `<button class="btn ghost small app-disconnect" data-id="${conn.id}" ${isAdmin ? '' : 'disabled'}>${t('Desconectar', 'Disconnect')}</button>`
          : `<button class="btn small app-connect" data-key="${app.key}" data-shop="${app.needs_shop ? 1 : 0}" ${disabled || !isAdmin ? 'disabled' : ''}>${t('Conectar', 'Connect')}</button>`}
        ${!app.configured && app.status !== 'soon' && !conn ? `<span class="muted" style="font-size:11px;align-self:center">${t('El operador debe añadir las claves', 'Operator must add the keys')}</span>` : ''}
      </div>
    </div>`;
  };

  const order = Object.keys(categories);
  view.innerHTML = `
  <div class="page-header">
    <div><h1>${t('Marketplace de integraciones', 'Integrations marketplace')}</h1>
      <p class="muted" style="font-size:13px">${t('Conecta tus apps favoritas de forma nativa. Las que aún no tienen claves configuradas aparecen como “config. pendiente”.', 'Connect your favorite apps natively. Those without configured keys show as “setup pending”.')}</p></div>
  </div>
  ${!isAdmin ? `<div class="card" style="margin-bottom:12px"><div class="card-body muted" style="font-size:13px">${t('Solo los administradores pueden conectar o desconectar apps.', 'Only administrators can connect or disconnect apps.')}</div></div>` : ''}
  ${order.map((cat) => {
    const list = groups[cat] || [];
    if (!list.length) return '';
    const label = t(categories[cat][0], categories[cat][1]);
    return `<div class="nav-section" style="margin:14px 0 8px">${esc(label)}</div>
      <div class="grid-cards">${list.map(card).join('')}</div>`;
  }).join('')}`;

  view.querySelectorAll('.app-connect').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.shop === '1') {
      const modal = openModal(`<h2>${t('Conectar tienda', 'Connect store')}</h2>
        <form id="shop-form"><label class="field"><span class="label">${t('Dominio de la tienda', 'Store domain')}</span>
          <input class="input" name="shop" required placeholder="mi-tienda.myshopify.com"></label>
          <div class="modal-actions"><button type="button" class="btn secondary" id="c">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Continuar', 'Continue')}</button></div></form>`);
      modal.querySelector('#c').addEventListener('click', closeOverlay);
      modal.querySelector('#shop-form').addEventListener('submit', (e) => { e.preventDefault(); closeOverlay(); startConnect(b.dataset.key, formData(e.target)); });
    } else {
      startConnect(b.dataset.key, {});
    }
  }));

  view.querySelectorAll('.app-disconnect').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('¿Desconectar esta app? Dejará de sincronizar.', 'Disconnect this app? It will stop syncing.'))) return;
    try {
      await api(`/apps/connected/${b.dataset.id}`, { method: 'DELETE' });
      toast(t('Desconectado', 'Disconnected'));
      renderMarketplace(view);
    } catch (err) { toast(err.message, true); }
  }));

  async function startConnect(key, body) {
    try {
      const r = await api(`/apps/${key}/connect`, { method: 'POST', body });
      if (r.needs_config) {
        openModal(`<h2>${t('Configuración pendiente', 'Setup pending')}</h2>
          <p class="muted" style="font-size:13px">${t('Esta integración necesita que el operador de la plataforma añada estas credenciales OAuth en el servidor:', 'This integration needs the platform operator to add these OAuth credentials on the server:')}</p>
          <ul style="font-size:13px;margin:8px 0">${r.missing.map((m) => `<li><code class="inline">${esc(m)}</code></li>`).join('')}</ul>
          <div class="modal-actions"><button class="btn" id="ok">${t('Entendido', 'Got it')}</button></div>`);
        document.getElementById('ok').addEventListener('click', closeOverlay);
        return;
      }
      if (r.authorize_url) { window.location.href = r.authorize_url; return; }
      toast(t('No se pudo iniciar la conexión', 'Could not start the connection'), true);
    } catch (err) { toast(err.message, true); }
  }
}
