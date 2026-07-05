import { api, state, setAgency } from '../api.js';
import { esc, toast, openModal, closeOverlay, formData } from '../ui.js';
import { t } from '../i18n.js';

// Clients console: the agencies directly below the current scope in the tenant
// tree. Upcross manages its clients here; a reseller client manages its own.
// "Entrar" drills into a client (X-Agency-Id) so every module scopes to it.
export async function renderClients(view) {
  if (state.user?.role !== 'admin') {
    view.innerHTML = `<div class="empty card" style="padding:40px">${t('Solo los administradores pueden gestionar clientes.', 'Only administrators can manage clients.')}</div>`;
    return;
  }
  const [clients, snaps] = await Promise.all([api('/clients'), api('/snapshots').catch(() => [])]);

  view.innerHTML = `
  <div class="page-header">
    <div><h1>${t('Clientes', 'Clients')}</h1><p class="muted" style="font-size:13px">${t('Las cuentas que gestionas. Entra en una para operar su marketing, o crea una nueva e instálale una plantilla.', 'The accounts you manage. Enter one to run its marketing, or create a new one and install a template.')}</p></div>
    <button class="btn" id="client-new">${t('+ Nuevo cliente', '+ New client')}</button>
  </div>

  ${clients.length
    ? `<div class="grid-2">${clients.map((c) => `
      <div class="card" style="margin-bottom:16px">
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <span class="avatar" style="background:${esc(c.brand_color || '#4f46e5')}">${esc((c.name || '?').slice(0, 2).toUpperCase())}</span>
            <div style="flex:1"><strong>${esc(c.name)}</strong>
              <div class="muted" style="font-size:12px">${c.admin ? esc(c.admin.email) : t('sin admin', 'no admin')}</div></div>
          </div>
          <div class="muted" style="font-size:12px;display:flex;gap:14px;margin-bottom:12px">
            <span><strong>${c.subaccounts}</strong> ${t('sub-cuentas', 'sub-accounts')}</span>
            <span><strong>${c.contacts}</strong> ${t('contactos', 'contacts')}</span>
            ${c.clients ? `<span><strong>${c.clients}</strong> ${t('clientes', 'clients')}</span>` : ''}
          </div>
          ${c.slug
            ? `<div class="access-link" style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
                 <code class="inline" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(location.origin)}/#/login/${esc(c.slug)}</code>
                 <button class="btn ghost small client-copy" data-link="${esc(location.origin)}/#/login/${esc(c.slug)}" title="${t('Copiar enlace de acceso del cliente', 'Copy the client access link')}">${t('Copiar', 'Copy')}</button>
               </div>`
            : ''}
          <div style="display:flex;gap:8px">
            <button class="btn small client-enter" data-id="${c.id}">${t('Entrar →', 'Enter →')}</button>
            <button class="btn secondary small client-edit" data-id="${c.id}" data-name="${esc(c.name)}" data-color="${esc(c.brand_color || '#4f46e5')}" data-slug="${esc(c.slug || '')}" data-logo="${esc(c.logo_url || '')}">${t('Editar', 'Edit')}</button>
            <button class="btn ghost small client-del" data-id="${c.id}" title="${t('Eliminar', 'Delete')}">✕</button>
          </div>
        </div>
      </div>`).join('')}</div>`
    : `<div class="empty card" style="padding:40px">${t('Aún no tienes clientes. Crea el primero y entra a montarle su marketing.', 'You don\'t have any clients yet. Create the first one and enter to set up its marketing.')}</div>`}`;

  // Drill into a client: switch scope and reload the whole app on that client.
  view.querySelectorAll('.client-enter').forEach((b) =>
    b.addEventListener('click', () => {
      setAgency(b.dataset.id);
      state.user = null; // force loadMe to refresh scope + locations
      toast(t('Has entrado en el cliente', 'You have entered the client'));
      location.hash = '#/dashboard';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    })
  );

  // Copy the client's branded login link to hand it over.
  view.querySelectorAll('.client-copy').forEach((b) =>
    b.addEventListener('click', async () => {
      const link = b.dataset.link;
      try {
        await navigator.clipboard.writeText(link);
        toast(t('Enlace de acceso copiado', 'Access link copied'));
      } catch {
        // Clipboard API can be unavailable (insecure context) — fall back.
        const ta = document.createElement('textarea');
        ta.value = link;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast(t('Enlace de acceso copiado', 'Access link copied')); } catch { toast(link); }
        ta.remove();
      }
    })
  );

  view.querySelectorAll('.client-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('¿Eliminar este cliente? Solo se puede si está vacío.', 'Delete this client? Only possible if it is empty.'))) return;
      try {
        await api(`/clients/${b.dataset.id}`, { method: 'DELETE' });
        toast(t('Cliente eliminado', 'Client deleted'));
        renderClients(view);
      } catch (err) {
        toast(err.message, true);
      }
    })
  );

  view.querySelectorAll('.client-edit').forEach((b) =>
    b.addEventListener('click', () => {
      const modal = openModal(`
        <h2>${t('Editar cliente', 'Edit client')}</h2>
        <p class="muted" style="font-size:12px;margin-bottom:12px">${t('Marca blanca del cliente: se aplica a su app y a su página de acceso.', 'Client white-label: applies to its app and its access page.')}</p>
        <form id="client-edit-form">
          <label class="field"><span class="label">${t('Nombre (marca)', 'Name (brand)')}</span><input class="input" name="name" value="${esc(b.dataset.name)}" required></label>
          <div class="form-row">
            <label class="field"><span class="label">${t('Color de marca', 'Brand color')}</span><input class="input" name="brand_color" type="color" value="${esc(b.dataset.color)}" style="height:38px;padding:3px"></label>
            <label class="field"><span class="label">${t('Identificador (URL)', 'Identifier (URL)')}</span><input class="input" name="slug" value="${esc(b.dataset.slug)}" placeholder="${t('mi-cliente', 'my-client')}"></label>
          </div>
          <label class="field"><span class="label">${t('Logo URL', 'Logo URL')}</span><input class="input" name="logo_url" value="${esc(b.dataset.logo)}" placeholder="https://…/logo.png"></label>
          <label class="field"><span class="label">${t('Titular en su página de acceso', 'Headline on its access page')}</span><input class="input" name="signup_headline" placeholder="${t('Accede a tu cuenta', 'Access your account')}"></label>
          <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Guardar', 'Save')}</button></div>
        </form>`);
      modal.querySelector('#cancel').addEventListener('click', closeOverlay);
      modal.querySelector('#client-edit-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api(`/clients/${b.dataset.id}`, { method: 'PUT', body: formData(e.target) });
          closeOverlay();
          toast(t('Cliente actualizado', 'Client updated'));
          renderClients(view);
        } catch (err) {
          toast(err.message, true);
        }
      });
    })
  );

  view.querySelector('#client-new').addEventListener('click', () => {
    const modal = openModal(`
      <h2>${t('Nuevo cliente', 'New client')}</h2>
      <p class="muted" style="font-size:12px;margin-bottom:12px">${t('Crea la cuenta del cliente y su administrador. Se le crea una primera sub-cuenta; si eliges una plantilla, se la instalamos con funnels, pipelines y automatizaciones listos.', 'Create the client account and its administrator. A first sub-account is created; if you choose a template, we install it with funnels, pipelines and automations ready.')}</p>
      <form id="client-form">
        <label class="field"><span class="label">${t('Nombre del cliente / negocio', 'Client / business name')}</span><input class="input" name="agency_name" required placeholder="${t('Clínica Dental Sonrisa', 'Smile Dental Clinic')}"></label>
        <div class="form-row">
          <label class="field"><span class="label">${t('Nombre del administrador', 'Administrator name')}</span><input class="input" name="admin_name" placeholder="${t('Dr. López', 'Dr. Smith')}"></label>
          <label class="field"><span class="label">${t('Primera sub-cuenta', 'First sub-account')}</span><input class="input" name="location_name" placeholder="${t('(por defecto: el nombre del cliente)', '(default: the client name)')}"></label>
        </div>
        <div class="form-row">
          <label class="field"><span class="label">${t('Email de acceso', 'Access email')}</span><input class="input" name="admin_email" type="email" required placeholder="cliente@email.com"></label>
          <label class="field"><span class="label">${t('Contraseña', 'Password')}</span><input class="input" name="admin_password" type="text" required placeholder="${t('mín. 6 caracteres', 'min. 6 characters')}"></label>
        </div>
        <label class="field"><span class="label">${t('Plantilla a instalar', 'Template to install')}</span>
          <select class="input" name="snapshot_id"><option value="">${t('— por defecto de la agencia —', '— agency default —')}</option>
          <option value="0">${t('— vacía —', '— empty —')}</option>
          ${snaps.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
        <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Crear cliente', 'Create client')}</button></div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#client-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      if (f.snapshot_id === '') delete f.snapshot_id; // let the server pick the agency default
      try {
        await api('/clients', { method: 'POST', body: f });
        closeOverlay();
        toast(t('Cliente creado con su acceso', 'Client created with its access'));
        renderClients(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}
