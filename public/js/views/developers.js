import { api, state } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate } from '../ui.js';
import { t } from '../i18n.js';

function copy(text) {
  navigator.clipboard.writeText(text).then(
    () => toast(t('Copiado', 'Copied')),
    () => toast(text)
  );
}

export async function renderDevelopers(view) {
  if (state.user?.role !== 'admin') {
    view.innerHTML = `<div class="empty card" style="padding:40px">${t('Solo los administradores pueden gestionar la API y los webhooks.', 'Only administrators can manage the API and webhooks.')}</div>`;
    return;
  }
  const [keys, hooks] = await Promise.all([api('/api-keys'), api('/inbound-webhooks')]);
  const base = location.origin;

  view.innerHTML = `
  <div class="page-header">
    <div><h1>${t('API y Webhooks', 'API & Webhooks')}</h1>
      <p class="muted" style="font-size:13px">${t('Conecta tu cuenta con miles de apps vía Zapier, Make, n8n o tu propio código.', 'Connect your account to thousands of apps via Zapier, Make, n8n or your own code.')}</p></div>
  </div>

  <div class="grid-2">
    <div class="card" style="margin-bottom:16px"><div class="card-body">
      <div class="flex"><strong style="flex:1">${t('API keys', 'API keys')}</strong>
        <button class="btn small" id="new-key">${t('+ Nueva clave', '+ New key')}</button></div>
      <p class="muted" style="font-size:12px;margin:8px 0">${t('Úsala en la cabecera', 'Use it in the header')} <code class="inline">X-Api-Key</code> ${t('o como', 'or as')} <code class="inline">Authorization: Bearer</code>. ${t('Base de la API:', 'API base:')} <code class="inline">${esc(base)}/api</code></p>
      ${keys.length
        ? keys.map((k) => `<div class="appt-row"><div style="flex:1"><strong>${esc(k.name)}</strong>
            <div class="muted" style="font-size:12px"><code class="inline">${esc(k.masked)}</code> · ${k.last_used_at ? `${t('usada', 'used')} ${fmtDate(k.last_used_at)}` : t('sin usar', 'never used')}</div></div>
            <button class="btn ghost small key-del" data-id="${k.id}">✕</button></div>`).join('')
        : `<p class="muted" style="font-size:13px">${t('Aún no hay claves.', 'No keys yet.')}</p>`}
    </div></div>

    <div class="card" style="margin-bottom:16px"><div class="card-body">
      <div class="flex"><strong style="flex:1">${t('Webhooks entrantes', 'Inbound webhooks')}</strong>
        <button class="btn small" id="new-hook">${t('+ Nuevo webhook', '+ New webhook')}</button></div>
      <p class="muted" style="font-size:12px;margin:8px 0">${t('Cualquier app puede enviar un lead (POST con email/teléfono) a esta URL y entra en tu CRM.', 'Any app can POST a lead (email/phone) to this URL and it enters your CRM.')}</p>
      ${hooks.length
        ? hooks.map((h) => {
            const url = `${base}/api/public/inbound/${h.token}`;
            return `<div class="block-item"><div class="b-head"><span>${esc(h.name)}${h.tag ? ` <span class="tag">${esc(h.tag)}</span>` : ''}</span>
                <button class="btn ghost small hook-del" data-id="${h.id}">✕</button></div>
              <div class="flex" style="gap:6px;margin-top:4px"><code class="inline" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(url)}</code>
                <button class="btn ghost small hook-copy" data-url="${esc(url)}">${t('Copiar', 'Copy')}</button></div>
              <div class="muted" style="font-size:11px;margin-top:4px">${h.received_count || 0} ${t('recibidos', 'received')}${h.last_received_at ? ` · ${fmtDate(h.last_received_at)}` : ''}</div>
            </div>`;
          }).join('')
        : `<p class="muted" style="font-size:13px">${t('Aún no hay webhooks entrantes.', 'No inbound webhooks yet.')}</p>`}
    </div></div>
  </div>

  <div class="card"><div class="card-body">
    <strong>${t('Webhooks salientes y Zapier/Make', 'Outbound webhooks & Zapier/Make')}</strong>
    <p class="muted" style="font-size:13px;margin-top:6px">${t('Para avisar a otras apps cuando pasa algo (nuevo lead, cita, etiqueta…), añade una acción', 'To notify other apps when something happens (new lead, appointment, tag…), add a')} <strong>${t('Webhook saliente', 'Outgoing webhook')}</strong> ${t('en', 'in')} <a href="#/automations">${t('Automatizaciones', 'Automations')}</a>. ${t('Con las API keys y estos webhooks te conectas a Zapier, Make y n8n sin código.', 'With API keys and these webhooks you connect to Zapier, Make and n8n with no code.')}</p>
  </div></div>`;

  view.querySelector('#new-key').addEventListener('click', () => {
    const modal = openModal(`
      <h2>${t('Nueva API key', 'New API key')}</h2>
      <form id="key-form">
        <label class="field"><span class="label">${t('Nombre (para identificarla)', 'Name (to identify it)')}</span><input class="input" name="name" required placeholder="Zapier"></label>
        <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Crear', 'Create')}</button></div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#key-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api-keys', { method: 'POST', body: formData(e.target) });
        openModal(`<h2>${t('Copia tu API key ahora', 'Copy your API key now')}</h2>
          <p class="muted" style="font-size:13px;margin-bottom:10px">${t('No se volverá a mostrar. Guárdala en un lugar seguro.', 'It will not be shown again. Store it somewhere safe.')}</p>
          <textarea class="input" rows="2" readonly onclick="this.select()">${esc(r.key)}</textarea>
          <div class="modal-actions"><button class="btn secondary" id="c2">${t('Cerrar', 'Close')}</button><button class="btn" id="cp">${t('Copiar', 'Copy')}</button></div>`);
        document.getElementById('cp').addEventListener('click', () => copy(r.key));
        document.getElementById('c2').addEventListener('click', () => { closeOverlay(); renderDevelopers(view); });
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  view.querySelectorAll('.key-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('¿Revocar esta API key? Las apps que la usen dejarán de funcionar.', 'Revoke this API key? Apps using it will stop working.'))) return;
      try {
        await api(`/api-keys/${b.dataset.id}`, { method: 'DELETE' });
        toast(t('Clave revocada', 'Key revoked'));
        renderDevelopers(view);
      } catch (err) {
        toast(err.message, true);
      }
    })
  );

  view.querySelector('#new-hook').addEventListener('click', () => {
    const modal = openModal(`
      <h2>${t('Nuevo webhook entrante', 'New inbound webhook')}</h2>
      <form id="hook-form">
        <label class="field"><span class="label">${t('Nombre', 'Name')}</span><input class="input" name="name" required placeholder="${t('Landing externa', 'External landing')}"></label>
        <label class="field"><span class="label">${t('Etiqueta al recibir (opcional)', 'Tag on receive (optional)')}</span><input class="input" name="tag" placeholder="lead"></label>
        <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Crear', 'Create')}</button></div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#hook-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/inbound-webhooks', { method: 'POST', body: formData(e.target) });
        closeOverlay();
        toast(t('Webhook creado', 'Webhook created'));
        renderDevelopers(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  view.querySelectorAll('.hook-copy').forEach((b) => b.addEventListener('click', () => copy(b.dataset.url)));
  view.querySelectorAll('.hook-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('¿Eliminar este webhook?', 'Delete this webhook?'))) return;
      try {
        await api(`/inbound-webhooks/${b.dataset.id}`, { method: 'DELETE' });
        renderDevelopers(view);
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
}
