import { api, state } from '../api.js';
import { esc, openModal, closeOverlay, toast, fmtDate, fullName } from '../ui.js';

export async function renderReputation(view) {
  const data = await api('/reputation');
  const { requests, stats, links } = data;
  const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—');

  view.innerHTML = `
  <div class="page-header">
    <h1>Reputación</h1>
    <div class="spacer"></div>
    <button class="btn secondary" id="edit-links">⚙ Links de reseña</button>
    <button class="btn" id="new-request">+ Pedir reseña</button>
  </div>
  <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
    <div class="stat"><div class="stat-label">Solicitudes</div><div class="stat-value">${stats.total}</div></div>
    <div class="stat"><div class="stat-label">Respuestas</div><div class="stat-value">${stats.responded}</div></div>
    <div class="stat"><div class="stat-label">Nota media</div><div class="stat-value">${stats.avg_rating ? stats.avg_rating.toFixed(1) + '★' : '—'}</div></div>
    <div class="stat"><div class="stat-label">Promotores (4-5★)</div><div class="stat-value" style="color:var(--success)">${stats.promoters}</div></div>
    <div class="stat"><div class="stat-label">A mejorar (1-3★)</div><div class="stat-value" style="color:var(--danger)">${stats.detractors}</div></div>
  </div>
  ${!links.google ? `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--warning)"><div class="card-body">
    ⚠️ <strong>Configura tu link de reseñas de Google</strong> para que los clientes contentos (4-5★) sean redirigidos
    automáticamente a dejar la reseña pública. <a href="#" id="cfg-now">Configurar ahora</a></div></div>` : ''}
  <div class="card">
    ${
      requests.length
        ? `<table class="table"><thead><tr><th>Contacto</th><th>Enviada</th><th>Estado</th><th>Valoración</th><th>Comentario</th></tr></thead>
          <tbody>${requests
            .map(
              (r) => `<tr>
                <td><strong>${esc(fullName(r))}</strong></td>
                <td class="muted">${fmtDate(r.created_at)}</td>
                <td><span class="badge ${r.status === 'reviewed' ? 'green' : r.status === 'opened' ? 'amber' : 'gray'}">${r.status}</span></td>
                <td style="color:#f59e0b;font-size:15px">${stars(r.rating)}</td>
                <td class="muted" style="max-width:260px">${esc(r.comment || '')}
                  ${r.rating ? `<div><button class="btn secondary small suggest-reply" data-id="${r.id}" style="margin-top:4px">✨ Sugerir respuesta</button></div>` : ''}</td></tr>`
            )
            .join('')}</tbody></table>`
        : '<div class="empty"><div class="big">⭐</div>Aún no has pedido reseñas. Pídelas manualmente o automatiza con el workflow "Pedir reseña tras la cita".</div>'
    }
  </div>`;

  async function linksModal() {
    const modal = openModal(`
      <h2>Links de reseña</h2>
      <p class="muted" style="margin-bottom:12px">Los clientes que puntúen 4-5★ serán redirigidos a tu página de reseñas de Google. Los de 1-3★ dejan feedback privado que solo ves tú.</p>
      <label class="field"><span class="label">Link de reseñas de Google</span>
        <input class="input" id="g-link" placeholder="https://g.page/r/.../review" value="${esc(links.google)}"></label>
      <label class="field"><span class="label">Link de Facebook (opcional)</span>
        <input class="input" id="f-link" placeholder="https://facebook.com/.../reviews" value="${esc(links.facebook)}"></label>
      <div class="modal-actions">
        <button class="btn secondary" id="cancel">Cancelar</button>
        <button class="btn" id="save">Guardar</button>
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
      toast('Links guardados');
      renderReputation(view);
    });
  }

  view.querySelectorAll('.suggest-reply').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Generando…';
      try {
        const r = await api(`/reputation/${b.dataset.id}/suggest-reply`, { method: 'POST' });
        const modal = openModal(`
          <h2>✨ Respuesta sugerida</h2>
          <textarea class="input" id="sr-text" rows="5">${esc(r.reply)}</textarea>
          <p class="muted" style="font-size:11px;margin-top:6px">Cópiala y publícala en Google/Facebook, o úsala como mensaje directo al cliente.</p>
          <div class="modal-actions">
            <button class="btn secondary" onclick="document.getElementById('modal-root').innerHTML=''">Cerrar</button>
            <button class="btn" id="sr-copy">Copiar</button>
          </div>`);
        modal.querySelector('#sr-copy').addEventListener('click', () => {
          navigator.clipboard.writeText(modal.querySelector('#sr-text').value);
          toast('Respuesta copiada');
        });
      } catch (err) { toast(err.message, true); }
      b.disabled = false;
      b.textContent = '✨ Sugerir respuesta';
    })
  );
  view.querySelector('#edit-links').addEventListener('click', linksModal);
  view.querySelector('#cfg-now')?.addEventListener('click', (e) => { e.preventDefault(); linksModal(); });

  view.querySelector('#new-request').addEventListener('click', () => {
    const modal = openModal(`
      <h2>Pedir reseña</h2>
      <label class="field"><span class="label">Contacto</span>
        <input class="input" id="rq-search" placeholder="buscar por nombre o email" autocomplete="off">
        <input type="hidden" id="rq-contact"><div id="rq-results"></div></label>
      <label class="field"><span class="label">Canal</span><select class="input" id="rq-channel">
        <option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option>
      </select></label>
      <div class="modal-actions">
        <button class="btn secondary" id="cancel">Cancelar</button>
        <button class="btn" id="send">Enviar solicitud</button>
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
      if (!contact_id) return toast('Selecciona un contacto', true);
      try {
        await api('/reputation/request', {
          method: 'POST',
          body: { contact_id, channel: modal.querySelector('#rq-channel').value },
        });
        closeOverlay();
        toast('Solicitud enviada');
        renderReputation(view);
      } catch (err) { toast(err.message, true); }
    });
  });
}
