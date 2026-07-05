import { api, state, setAgency } from '../api.js';
import { esc, toast, openModal, closeOverlay, formData } from '../ui.js';

// Clients console: the agencies directly below the current scope in the tenant
// tree. Upcross manages its clients here; a reseller client manages its own.
// "Entrar" drills into a client (X-Agency-Id) so every module scopes to it.
export async function renderClients(view) {
  if (state.user?.role !== 'admin') {
    view.innerHTML = '<div class="empty card" style="padding:40px">Solo los administradores pueden gestionar clientes.</div>';
    return;
  }
  const [clients, snaps] = await Promise.all([api('/clients'), api('/snapshots').catch(() => [])]);

  view.innerHTML = `
  <div class="page-header">
    <div><h1>Clientes</h1><p class="muted" style="font-size:13px">Las cuentas que gestionas. Entra en una para operar su marketing, o crea una nueva e instálale una plantilla.</p></div>
    <button class="btn" id="client-new">+ Nuevo cliente</button>
  </div>

  ${clients.length
    ? `<div class="grid-2">${clients.map((c) => `
      <div class="card" style="margin-bottom:16px">
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <span class="avatar" style="background:${esc(c.brand_color || '#4f46e5')}">${esc((c.name || '?').slice(0, 2).toUpperCase())}</span>
            <div style="flex:1"><strong>${esc(c.name)}</strong>
              <div class="muted" style="font-size:12px">${c.admin ? esc(c.admin.email) : 'sin admin'}</div></div>
          </div>
          <div class="muted" style="font-size:12px;display:flex;gap:14px;margin-bottom:12px">
            <span><strong>${c.subaccounts}</strong> sub-cuentas</span>
            <span><strong>${c.contacts}</strong> contactos</span>
            ${c.clients ? `<span><strong>${c.clients}</strong> clientes</span>` : ''}
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn small client-enter" data-id="${c.id}">Entrar →</button>
            <button class="btn secondary small client-edit" data-id="${c.id}" data-name="${esc(c.name)}" data-color="${esc(c.brand_color || '#4f46e5')}">Editar</button>
            <button class="btn ghost small client-del" data-id="${c.id}" title="Eliminar">✕</button>
          </div>
        </div>
      </div>`).join('')}</div>`
    : '<div class="empty card" style="padding:40px">Aún no tienes clientes. Crea el primero y entra a montarle su marketing.</div>'}`;

  // Drill into a client: switch scope and reload the whole app on that client.
  view.querySelectorAll('.client-enter').forEach((b) =>
    b.addEventListener('click', () => {
      setAgency(b.dataset.id);
      state.user = null; // force loadMe to refresh scope + locations
      toast('Has entrado en el cliente');
      location.hash = '#/dashboard';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    })
  );

  view.querySelectorAll('.client-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este cliente? Solo se puede si está vacío.')) return;
      try {
        await api(`/clients/${b.dataset.id}`, { method: 'DELETE' });
        toast('Cliente eliminado');
        renderClients(view);
      } catch (err) {
        toast(err.message, true);
      }
    })
  );

  view.querySelectorAll('.client-edit').forEach((b) =>
    b.addEventListener('click', () => {
      const modal = openModal(`
        <h2>Editar cliente</h2>
        <form id="client-edit-form">
          <label class="field"><span class="label">Nombre</span><input class="input" name="name" value="${esc(b.dataset.name)}" required></label>
          <label class="field"><span class="label">Color de marca</span><input class="input" name="brand_color" type="color" value="${esc(b.dataset.color)}" style="height:38px;padding:3px"></label>
          <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">Cancelar</button><button class="btn">Guardar</button></div>
        </form>`);
      modal.querySelector('#cancel').addEventListener('click', closeOverlay);
      modal.querySelector('#client-edit-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api(`/clients/${b.dataset.id}`, { method: 'PUT', body: formData(e.target) });
          closeOverlay();
          toast('Cliente actualizado');
          renderClients(view);
        } catch (err) {
          toast(err.message, true);
        }
      });
    })
  );

  view.querySelector('#client-new').addEventListener('click', () => {
    const modal = openModal(`
      <h2>Nuevo cliente</h2>
      <p class="muted" style="font-size:12px;margin-bottom:12px">Crea la cuenta del cliente y su administrador. Se le crea una primera sub-cuenta; si eliges una plantilla, se la instalamos con funnels, pipelines y automatizaciones listos.</p>
      <form id="client-form">
        <label class="field"><span class="label">Nombre del cliente / negocio</span><input class="input" name="agency_name" required placeholder="Clínica Dental Sonrisa"></label>
        <div class="form-row">
          <label class="field"><span class="label">Nombre del administrador</span><input class="input" name="admin_name" placeholder="Dr. López"></label>
          <label class="field"><span class="label">Primera sub-cuenta</span><input class="input" name="location_name" placeholder="(por defecto: el nombre del cliente)"></label>
        </div>
        <div class="form-row">
          <label class="field"><span class="label">Email de acceso</span><input class="input" name="admin_email" type="email" required placeholder="cliente@email.com"></label>
          <label class="field"><span class="label">Contraseña</span><input class="input" name="admin_password" type="text" required placeholder="mín. 6 caracteres"></label>
        </div>
        <label class="field"><span class="label">Plantilla a instalar</span>
          <select class="input" name="snapshot_id"><option value="">— por defecto de la agencia —</option>
          <option value="0">— vacía —</option>
          ${snaps.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
        <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">Cancelar</button><button class="btn">Crear cliente</button></div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#client-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      if (f.snapshot_id === '') delete f.snapshot_id; // let the server pick the agency default
      try {
        await api('/clients', { method: 'POST', body: f });
        closeOverlay();
        toast('Cliente creado con su acceso');
        renderClients(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}
