import { api, state } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate } from '../ui.js';
import { t } from '../i18n.js';
import { BRAND_LOGOS, CUSTOM_LOGOS } from './app-logos.js';

// Generic plug fallback for anything without an official logo.
const FALLBACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 7V2M15 7V2M7 7h10v5a5 5 0 0 1-10 0z"/><path d="M12 17v5"/></svg>';

// Official brand logo for an app: hand-crafted multicolor SVG, else the
// Simple Icons monochrome mark in its brand color, else the plug fallback.
function logoHtml(key) {
  if (CUSTOM_LOGOS[key]) return CUSTOM_LOGOS[key];
  const b = BRAND_LOGOS[key];
  if (b) return `<svg viewBox="0 0 24 24" fill="${b.c}"><path d="${b.p}"/></svg>`;
  return FALLBACK;
}

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

  const { catalog, categories, connected, managed = [] } = await api('/apps');
  const isAdmin = state.user?.role === 'admin';
  const byKey = Object.fromEntries(catalog.map((a) => [a.key, a]));

  const SOURCE_LABEL = {
    plataforma: t('incluido en la plataforma', 'included in the platform'),
    agencia: t('activado por tu agencia', 'enabled by your agency'),
    estancia: t('configurado en esta sub-cuenta', 'set for this sub-account'),
  };

  // A managed service is provided centrally: the API is wired by the agency and
  // the plan grants access; the client just uses it (and tunes the surface).
  const managedBadge = (m) => {
    if (m.active) return `<span class="tag" style="background:#e6f7ec;color:#137333">✓ ${t('Activo', 'Active')}</span>`;
    if (!m.included) return `<span class="tag muted">${t('No incluido en tu plan', 'Not in your plan')}</span>`;
    return `<span class="tag" style="background:#fff4e5;color:#a15c00">${t('Lo activa tu agencia', 'Your agency enables it')}</span>`;
  };
  const managedFoot = (m) => {
    if (m.active) return `${t('Listo para usar', 'Ready to use')} · ${esc(SOURCE_LABEL[m.source] || t('gestionado', 'managed'))}`;
    if (!m.included) return isAdmin
      ? t('No está en el plan de este cliente. Añádelo al plan en Agencia › Planes.', 'Not in this client’s plan. Add it to the plan in Agency › Plans.')
      : t('Mejora tu plan para activar esta función.', 'Upgrade your plan to unlock this feature.');
    return isAdmin
      ? t('Incluido en el plan. Conéctalo en Ajustes › Integraciones para toda tu cuenta.', 'Included in the plan. Connect it in Settings › Integrations for your whole account.')
      : t('Tu agencia lo activará; no necesitas hacer nada.', 'Your agency will enable it; you don’t need to do anything.');
  };
  const managedCard = (m) => `<div class="card" style="display:flex;flex-direction:column;gap:8px${m.included ? '' : ';opacity:.72'}">
      <div class="flex" style="align-items:flex-start;gap:10px">
        <span class="app-ic">${logoHtml(m.key)}</span>
        <div style="flex:1;min-width:0">
          <div class="flex" style="gap:6px;align-items:center;flex-wrap:wrap"><strong>${esc(m.name)}</strong>${managedBadge(m)}</div>
          <p class="muted" style="font-size:12.5px;margin:4px 0 0">${esc(t(m.blurb[0], m.blurb[1]))}</p>
        </div>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:auto">${managedFoot(m)}</div>
    </div>`;

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
        <span class="app-ic">${logoHtml(app.key)}</span>
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
    <div><h1>${t('Integraciones', 'Integrations')}</h1>
      <p class="muted" style="font-size:13px">${t('Dos tipos, como en GoHighLevel: los servicios incluidos que provee tu agencia y usas sin configurar nada, y el marketplace donde conectas tus propias apps.', 'Two kinds, like GoHighLevel: included services your agency provides that you use with no setup, and the marketplace where you connect your own apps.')}</p></div>
  </div>

  <div class="nav-section" style="margin:6px 0 8px">${t('Servicios incluidos', 'Included services')} <span class="muted" style="font-weight:400">· ${t('los gestiona tu agencia, sin claves', 'managed by your agency, no keys')}</span></div>
  <div class="grid-cards">${managed.map(managedCard).join('')}</div>

  <div class="nav-section" style="margin:22px 0 4px">${t('Marketplace · conecta tus apps', 'Marketplace · connect your apps')}</div>
  <p class="muted" style="font-size:12.5px;margin:0 0 6px">${t('Cada cliente conecta sus propias cuentas. Las de OAuth sin claves aparecen como “config. pendiente”; las de clave propia se conectan al momento.', 'Each client connects their own accounts. OAuth apps without keys show as “setup pending”; API-key apps connect instantly.')}</p>
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
