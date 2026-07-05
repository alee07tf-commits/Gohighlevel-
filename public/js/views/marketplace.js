import { api, state } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate } from '../ui.js';
import { t } from '../i18n.js';

// Line-art badge per app (generic plug fallback for the long tail).
const FALLBACK = '<svg viewBox="0 0 24 24"><path d="M9 7V2M15 7V2M7 7h10v5a5 5 0 0 1-10 0z"/><path d="M12 17v5"/></svg>';
const APP_ICON = {
  meta: '<svg viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
  google: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>',
  google_ads: '<svg viewBox="0 0 24 24"><path d="M3 17 10 5l4 7-3 5z"/><circle cx="18" cy="17" r="3"/></svg>',
  google_analytics: '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="4" height="9"/><rect x="10" y="6" width="4" height="14"/><rect x="16" y="3" width="4" height="17"/></svg>',
  microsoft: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/></svg>',
  calendly: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  icloud: '<svg viewBox="0 0 24 24"><path d="M6 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A4.5 4.5 0 0 1 18 18z"/></svg>',
  shopify: '<svg viewBox="0 0 24 24"><path d="M6 7l-2 13 8 2 8-2-2-13z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
  zoom: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>',
  stripe: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  paypal: '<svg viewBox="0 0 24 24"><path d="M7 20l2-14h6a4 4 0 0 1 0 8H9"/></svg>',
  square: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>',
  quickbooks: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24"><path d="M3 21l1.6-4A8 8 0 1 1 8 19.4z"/></svg>',
  twilio: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1.6"/><circle cx="15" cy="9" r="1.6"/><circle cx="9" cy="15" r="1.6"/><circle cx="15" cy="15" r="1.6"/></svg>',
  messenger: '<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.1 2 11.2c0 2.9 1.4 5.4 3.7 7.1V22l3.4-1.9c.9.3 1.9.4 2.9.4 5.5 0 10-4.1 10-9.2S17.5 2 12 2z"/></svg>',
  instagram_dm: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 10v7M7 7v.01M11 17v-4a2 2 0 0 1 4 0v4M11 17v-7"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24"><path d="M15 4v9a4 4 0 1 1-4-4"/><path d="M15 7a5 5 0 0 0 5 3"/></svg>',
  tiktok_ads: '<svg viewBox="0 0 24 24"><path d="M15 4v9a4 4 0 1 1-4-4"/><path d="M15 7a5 5 0 0 0 5 3"/></svg>',
  twitter: '<svg viewBox="0 0 24 24"><path d="M4 4l7 9-7 7h2l6-6 5 6h4l-8-10 7-6h-2l-6 5-4-5z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z"/></svg>',
  pinterest: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7c-2 0-3.5 1.4-3.5 3.3 0 1 .5 1.9 1.2 2.2M12 7c2 0 3.5 1.2 3.5 3 0 2.3-1.4 4-3.2 4-.7 0-1.3-.4-1.3-1M11 17l-1 4"/></svg>',
  mailgun: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  sendgrid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/></svg>',
  smtp: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  wordpress: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M4 9l4 10 3-8M12 8l3 11 3-9"/></svg>',
  hubspot: '<svg viewBox="0 0 24 24"><circle cx="7" cy="12" r="3"/><circle cx="17" cy="7" r="2.5"/><path d="M10 12h4M17 9.5V15a3 3 0 1 1-3 3"/></svg>',
  zapier: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18"/></svg>',
  make: '<svg viewBox="0 0 24 24"><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="12" cy="17" r="3"/></svg>',
  n8n: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 7l3 3M14 17l3-3"/></svg>',
};

function badge(app, conn) {
  if (conn) return `<span class="tag" style="background:#e6f7ec;color:#137333">✓ ${t('Conectado', 'Connected')}</span>`;
  if (app.status === 'soon') return `<span class="tag muted">${t('Próximamente', 'Coming soon')}</span>`;
  if (app.auth === 'oauth' && !app.configured) return `<span class="tag" style="background:#fff4e5;color:#a15c00">${t('Config. pendiente', 'Setup pending')}</span>`;
  return `<span class="tag">${t('Disponible', 'Available')}</span>`;
}

export async function renderMarketplace(view) {
  const q = new URLSearchParams(location.search);
  if (q.get('connected')) { toast(`${t('Conectado', 'Connected')}: ${q.get('connected')}`); history.replaceState(null, '', location.pathname + location.hash); }
  if (q.get('integration_error')) { toast(`${t('Error al conectar', 'Connection error')}: ${q.get('integration_error')}`, true); history.replaceState(null, '', location.pathname + location.hash); }

  const { catalog, categories, connected } = await api('/apps');
  const isAdmin = state.user?.role === 'admin';
  const byKey = Object.fromEntries(catalog.map((a) => [a.key, a]));

  const groups = {};
  for (const app of catalog) (groups[app.category] ||= []).push(app);

  const connLabel = (conn) => {
    const parts = [];
    if (conn.data?.display) parts.push(...Object.values(conn.data.display).map(String));
    if (conn.data?.masked) parts.push(...Object.values(conn.data.masked).map(String));
    else if (conn.display_name) parts.push(conn.display_name);
    return parts.filter(Boolean).slice(0, 3).join(' · ');
  };

  const card = (app) => {
    const conn = connected[app.key];
    const disabled = app.status === 'soon';
    return `<div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div class="flex" style="align-items:flex-start;gap:10px">
        <span class="app-ic" style="width:34px;height:34px;flex:none;display:grid;place-items:center;border-radius:9px;background:var(--surface-2,#f3f4f6)">${APP_ICON[app.key] || FALLBACK}</span>
        <div style="flex:1;min-width:0">
          <div class="flex" style="gap:6px;align-items:center;flex-wrap:wrap"><strong>${esc(app.name)}</strong>${badge(app, conn)}</div>
          <p class="muted" style="font-size:12.5px;margin:4px 0 0">${esc(t(app.blurb[0], app.blurb[1]))}</p>
        </div>
      </div>
      ${conn ? `<div class="muted" style="font-size:11.5px">${t('Conectado', 'Connected')} ${conn.connected_at ? fmtDate(conn.connected_at) : ''}${connLabel(conn) ? ` · ${esc(connLabel(conn))}` : ''}</div>` : ''}
      <div class="flex" style="gap:6px;margin-top:auto">
        ${conn
          ? `<button class="btn ghost small app-disconnect" data-id="${conn.id}" ${isAdmin ? '' : 'disabled'}>${t('Desconectar', 'Disconnect')}</button>`
          : `<button class="btn small app-connect" data-key="${app.key}" ${disabled || !isAdmin ? 'disabled' : ''}>${app.auth === 'builtin' ? t('Cómo conectar', 'How to connect') : t('Conectar', 'Connect')}</button>`}
        ${app.auth === 'oauth' && !app.configured && app.status !== 'soon' && !conn ? `<span class="muted" style="font-size:11px;align-self:center">${t('El operador debe añadir las claves', 'Operator must add the keys')}</span>` : ''}
      </div>
    </div>`;
  };

  const order = Object.keys(categories);
  view.innerHTML = `
  <div class="page-header">
    <div><h1>${t('Marketplace de integraciones', 'Integrations marketplace')}</h1>
      <p class="muted" style="font-size:13px">${t('Conecta tus apps favoritas de forma nativa, igual que en GoHighLevel. Las de OAuth sin claves aparecen como “config. pendiente”; las de clave propia se conectan al momento.', 'Connect your favorite apps natively, just like GoHighLevel. OAuth apps without keys show as “setup pending”; API-key apps connect instantly.')}</p></div>
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
    const app = byKey[b.dataset.key];
    if (!app) return;
    if (app.auth === 'builtin') return showBuiltin(app);
    if (app.auth === 'apikey') return showApiKeyForm(app);
    if (app.needs_shop) return promptShop(app);
    startOAuth(app.key, {});
  }));

  view.querySelectorAll('.app-disconnect').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('¿Desconectar esta app? Dejará de sincronizar.', 'Disconnect this app? It will stop syncing.'))) return;
    try {
      await api(`/apps/connected/${b.dataset.id}`, { method: 'DELETE' });
      toast(t('Desconectado', 'Disconnected'));
      renderMarketplace(view);
    } catch (err) { toast(err.message, true); }
  }));

  function showBuiltin(app) {
    openModal(`<h2>${esc(app.name)}</h2>
      <p class="muted" style="font-size:13px">${t('Esta app se conecta usando tus API keys y webhooks, sin configuración extra.', 'This app connects using your API keys and webhooks, with no extra setup.')}</p>
      <ol style="font-size:13px;margin:10px 0;padding-left:18px">
        <li>${t('Crea una API key en', 'Create an API key in')} <a href="#/developers">${t('API y Webhooks', 'API & Webhooks')}</a>.</li>
        <li>${t('En', 'In')} ${esc(app.name)}, ${t('pega la key y la base de la API.', 'paste the key and the API base.')}</li>
        <li>${t('Añade un webhook entrante o saliente según lo que necesites.', 'Add an inbound or outbound webhook as needed.')}</li>
      </ol>
      <div class="modal-actions"><button class="btn secondary" id="c">${t('Cerrar', 'Close')}</button><a class="btn" href="#/developers" id="go">${t('Ir a API y Webhooks', 'Go to API & Webhooks')}</a></div>`);
    document.getElementById('c').addEventListener('click', closeOverlay);
    document.getElementById('go').addEventListener('click', closeOverlay);
  }

  function showApiKeyForm(app) {
    const fields = app.fields.map((f) => `<label class="field"><span class="label">${esc(t(f.label[0], f.label[1]))}</span>
      <input class="input" name="${esc(f.key)}" ${f.secret ? 'type="password"' : ''} autocomplete="off"></label>`).join('');
    const modal = openModal(`<h2>${t('Conectar', 'Connect')} ${esc(app.name)}</h2>
      <form id="ak-form">${fields}
        <div class="modal-actions"><button type="button" class="btn secondary" id="c">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Guardar', 'Save')}</button></div></form>`);
    modal.querySelector('#c').addEventListener('click', closeOverlay);
    modal.querySelector('#ak-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/apps/${app.key}/manual`, { method: 'POST', body: { fields: formData(e.target) } });
        closeOverlay();
        toast(t('Conectado', 'Connected'));
        renderMarketplace(view);
      } catch (err) { toast(err.message, true); }
    });
  }

  function promptShop(app) {
    const modal = openModal(`<h2>${t('Conectar tienda', 'Connect store')}</h2>
      <form id="shop-form"><label class="field"><span class="label">${t('Dominio de la tienda', 'Store domain')}</span>
        <input class="input" name="shop" required placeholder="mi-tienda.myshopify.com"></label>
        <div class="modal-actions"><button type="button" class="btn secondary" id="c">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Continuar', 'Continue')}</button></div></form>`);
    modal.querySelector('#c').addEventListener('click', closeOverlay);
    modal.querySelector('#shop-form').addEventListener('submit', (e) => { e.preventDefault(); closeOverlay(); startOAuth(app.key, formData(e.target)); });
  }

  async function startOAuth(key, body) {
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
