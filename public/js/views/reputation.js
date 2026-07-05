import { api, state } from '../api.js';
import { esc, openModal, closeOverlay, toast, fmtDate, fullName } from '../ui.js';
import { t } from '../i18n.js';

export async function renderReputation(view) {
  const data = await api('/reputation');
  const { requests, stats, links } = data;
  const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—');
  const statusLabel = (s) =>
    s === 'reviewed' ? t('reseñada', 'reviewed') : s === 'opened' ? t('abierta', 'opened') : s === 'sent' ? t('enviada', 'sent') : s;

  view.innerHTML = `
  <div class="page-header">
    <h1>${t('Reputación', 'Reputation')}</h1>
    <div class="spacer"></div>
    <button class="btn secondary" id="edit-links">${t('Links de reseña', 'Review links')}</button>
    <button class="btn secondary" id="bulk-request">${t('Pedir en masa', 'Bulk request')}</button>
    <button class="btn" id="new-request">${t('+ Pedir reseña', '+ Request review')}</button>
  </div>
  <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
    <div class="stat"><div class="stat-label">${t('Solicitudes', 'Requests')}</div><div class="stat-value">${stats.total}</div></div>
    <div class="stat"><div class="stat-label">${t('Respuestas', 'Responses')}</div><div class="stat-value">${stats.responded}</div></div>
    <div class="stat"><div class="stat-label">${t('Nota media', 'Average rating')}</div><div class="stat-value">${stats.avg_rating ? stats.avg_rating.toFixed(1) + '★' : '—'}</div></div>
    <div class="stat"><div class="stat-label">${t('Promotores (4-5★)', 'Promoters (4-5★)')}</div><div class="stat-value" style="color:var(--success)">${stats.promoters}</div></div>
    <div class="stat"><div class="stat-label">${t('A mejorar (1-3★)', 'Needs improvement (1-3★)')}</div><div class="stat-value" style="color:var(--danger)">${stats.detractors}</div></div>
  </div>
  ${!links.google ? `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--warning)"><div class="card-body">
   <strong>${t('Configura tu link de reseñas de Google', 'Set up your Google reviews link')}</strong> ${t('para que los clientes contentos (4-5★) sean redirigidos automáticamente a dejar la reseña pública.', 'so happy customers (4-5★) are automatically redirected to leave the public review.')} <a href="#" id="cfg-now">${t('Configurar ahora', 'Set up now')}</a></div></div>` : ''}
  <div class="card">
    ${
      requests.length
        ? `<table class="table"><thead><tr><th>${t('Contacto', 'Contact')}</th><th>${t('Enviada', 'Sent')}</th><th>${t('Estado', 'Status')}</th><th>${t('Valoración', 'Rating')}</th><th>${t('Comentario', 'Comment')}</th></tr></thead>
          <tbody>${requests
            .map(
              (r) => `<tr>
                <td><strong>${esc(fullName(r))}</strong></td>
                <td class="muted">${fmtDate(r.created_at)}</td>
                <td><span class="badge ${r.status === 'reviewed' ? 'green' : r.status === 'opened' ? 'amber' : 'gray'}">${statusLabel(r.status)}</span></td>
                <td style="color:#f59e0b;font-size:15px">${stars(r.rating)}</td>
                <td class="muted" style="max-width:260px">${esc(r.comment || '')}
                  ${r.rating ? `<div><button class="btn secondary small suggest-reply" data-id="${r.id}" style="margin-top:4px">${t('Sugerir respuesta', 'Suggest reply')}</button></div>` : ''}</td></tr>`
            )
            .join('')}</tbody></table>`
        : `<div class="empty"><div class="big">★</div>${t('Aún no has pedido reseñas. Pídelas manualmente o automatiza con el workflow "Pedir reseña tras la cita".', 'You haven\'t requested any reviews yet. Request them manually or automate with the "Request review after appointment" workflow.')}</div>`
    }
  </div>`;

  async function linksModal() {
    const modal = openModal(`
      <h2>${t('Links de reseña', 'Review links')}</h2>
      <p class="muted" style="margin-bottom:12px">${t('Los clientes que puntúen 4-5★ serán redirigidos a tu página de reseñas de Google. Los de 1-3★ dejan feedback privado que solo ves tú.', 'Customers who rate 4-5★ will be redirected to your Google reviews page. Those rating 1-3★ leave private feedback only you can see.')}</p>
      <label class="field"><span class="label">${t('Link de reseñas de Google', 'Google reviews link')}</span>
        <input class="input" id="g-link" placeholder="https://g.page/r/.../review" value="${esc(links.google)}"></label>
      <label class="field"><span class="label">${t('Link de Facebook (opcional)', 'Facebook link (optional)')}</span>
        <input class="input" id="f-link" placeholder="https://facebook.com/.../reviews" value="${esc(links.facebook)}"></label>
      <div class="modal-actions">
        <button class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
        <button class="btn" id="save">${t('Guardar', 'Save')}</button>
      </div>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#save').addEventListener('click', async () => {
      await api(`/locations/${state.locationId}`, {
        method: 'PUT',
        body: {
          review_link_google: modal.querySelector('#g-link').value.trim(),
          review_link_facebook: modal.querySelector('#f-link').value.trim(),
        },
      });
      closeOverlay();
      toast(t('Links guardados', 'Links saved'));
      renderReputation(view);
    });
  }

  view.querySelectorAll('.suggest-reply').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = t('Generando…', 'Generating…');
      try {
        const r = await api(`/reputation/${b.dataset.id}/suggest-reply`, { method: 'POST' });
        const modal = openModal(`
          <h2>${t('Respuesta sugerida', 'Suggested reply')}</h2>
          <textarea class="input" id="sr-text" rows="5">${esc(r.reply)}</textarea>
          <p class="muted" style="font-size:11px;margin-top:6px">${t('Cópiala y publícala en Google/Facebook, o úsala como mensaje directo al cliente.', 'Copy and post it on Google/Facebook, or use it as a direct message to the customer.')}</p>
          <div class="modal-actions">
            <button class="btn secondary" onclick="document.getElementById('modal-root').innerHTML=''">${t('Cerrar', 'Close')}</button>
            <button class="btn" id="sr-copy">${t('Copiar', 'Copy')}</button>
          </div>`);
        modal.querySelector('#sr-copy').addEventListener('click', () => {
          navigator.clipboard.writeText(modal.querySelector('#sr-text').value);
          toast(t('Respuesta copiada', 'Reply copied'));
        });
      } catch (err) { toast(err.message, true); }
      b.disabled = false;
      b.textContent = t('Sugerir respuesta', 'Suggest reply');
    })
  );
  view.querySelector('#edit-links').addEventListener('click', linksModal);
  view.querySelector('#cfg-now')?.addEventListener('click', (e) => { e.preventDefault(); linksModal(); });

  view.querySelector('#bulk-request').addEventListener('click', async () => {
    const tags = await api('/contacts/meta/tags').catch(() => []);
    const modal = openModal(`<h2>${t('Pedir reseñas en masa', 'Bulk review requests')}</h2>
      <label class="field"><span class="label">${t('A contactos con la etiqueta (vacío = todos)', 'To contacts with tag (empty = all)')}</span>
        <select class="input" id="bq-tag"><option value="">${t('— todos —', '— everyone —')}</option>${tags.map((tg) => `<option value="${esc(tg.tag)}">${esc(tg.tag)} (${tg.count})</option>`).join('')}</select></label>
      <label class="field"><span class="label">${t('Canal', 'Channel')}</span><select class="input" id="bq-channel"><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></label>
      <div class="modal-actions"><button class="btn secondary" id="c">${t('Cancelar', 'Cancel')}</button><button class="btn" id="bq-send">${t('Enviar', 'Send')}</button></div>`);
    modal.querySelector('#c').addEventListener('click', closeOverlay);
    modal.querySelector('#bq-send').addEventListener('click', async () => {
      try {
        const r = await api('/reputation/request-bulk', { method: 'POST', body: { tag: modal.querySelector('#bq-tag').value, channel: modal.querySelector('#bq-channel').value } });
        closeOverlay();
        toast(t(`Enviadas ${r.sent} de ${r.total}`, `Sent ${r.sent} of ${r.total}`));
        renderReputation(view);
      } catch (err) { toast(err.message, true); }
    });
  });

  view.querySelector('#new-request').addEventListener('click', () => {
    const modal = openModal(`
      <h2>${t('Pedir reseña', 'Request review')}</h2>
      <label class="field"><span class="label">${t('Contacto', 'Contact')}</span>
        <input class="input" id="rq-search" placeholder="${t('buscar por nombre o email', 'search by name or email')}" autocomplete="off">
        <input type="hidden" id="rq-contact"><div id="rq-results"></div></label>
      <label class="field"><span class="label">${t('Canal', 'Channel')}</span><select class="input" id="rq-channel">
        <option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option>
      </select></label>
      <div class="modal-actions">
        <button class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
        <button class="btn" id="send">${t('Enviar solicitud', 'Send request')}</button>
      </div>`);
    let timer;
    modal.querySelector('#rq-search').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const results = await api(`/contacts?q=${encodeURIComponent(e.target.value)}&limit=5`);
        const div = modal.querySelector('#rq-results');
        div.innerHTML = results.map((c) => `<a href="#" data-id="${c.id}" class="tag">${esc(fullName(c))}</a>`).join(' ');
        div.querySelectorAll('a').forEach((a) =>
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            modal.querySelector('#rq-contact').value = a.dataset.id;
            modal.querySelector('#rq-search').value = a.textContent;
            div.innerHTML = '';
          })
        );
      }, 250);
    });
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#send').addEventListener('click', async () => {
      const contact_id = Number(modal.querySelector('#rq-contact').value);
      if (!contact_id) return toast(t('Selecciona un contacto', 'Select a contact'), true);
      try {
        await api('/reputation/request', {
          method: 'POST',
          body: { contact_id, channel: modal.querySelector('#rq-channel').value },
        });
        closeOverlay();
        toast(t('Solicitud enviada', 'Request sent'));
        renderReputation(view);
      } catch (err) { toast(err.message, true); }
    });
  });
}
