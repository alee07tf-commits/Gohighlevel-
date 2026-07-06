import { api, state } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate } from '../ui.js';
import { t } from '../i18n.js';
import { openEmailBuilder } from '../email-builder.js';

export async function renderMarketing(view) {
  const [templates, campaigns, tags, links] = await Promise.all([
    api('/marketing/templates'),
    api('/marketing/campaigns'),
    api('/contacts/meta/tags'),
    api('/marketing/links'),
  ]);

  view.innerHTML = `
  <div class="page-header">
    <h1>Marketing</h1>
    <div class="spacer"></div>
    <button class="btn secondary" id="new-template">${t('+ Plantilla de Email', '+ Email Template')}</button>
    <button class="btn" id="new-campaign">${t('+ Campaña', '+ Campaign')}</button>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-title">${t('Campañas', 'Campaigns')}</div>
      <div class="card-body" style="padding:0">
        ${
          campaigns.length
            ? `<table class="table"><thead><tr><th>${t('Nombre', 'Name')}</th><th>${t('Canal', 'Channel')}</th><th>${t('Audiencia', 'Audience')}</th><th>${t('Estado', 'Status')}</th><th></th></tr></thead><tbody>
              ${campaigns
                .map(
                  (c) => `<tr>
                    <td><strong>${esc(c.name)}</strong><div class="muted" style="font-size:11px">${esc(c.subject)}</div></td>
                    <td><span class="badge gray">${c.channel}</span></td>
                    <td>${c.tag_filter ? `<span class="tag">${esc(c.tag_filter)}</span>` : `<span class="muted">${t('Todos', 'Everyone')}</span>`}</td>
                    <td>${c.status === 'sent' ? `<span class="badge green">${t(`enviada a ${c.recipient_count}`, `sent to ${c.recipient_count}`)}</span>${c.channel === 'email' && c.recipient_count ? `<div class="muted" style="font-size:10px">${c.opened_count || 0} ${t('abiertos', 'opened')} (${Math.round(100 * (c.opened_count || 0) / c.recipient_count)}%)</div>` : ''}<div class="muted" style="font-size:10px">${fmtDate(c.sent_at)}</div>` : c.status === 'scheduled' ? `<span class="badge indigo">${fmtDate(c.send_at)}</span>` : `<span class="badge amber">${t('Borrador', 'Draft')}</span>`}</td>
                    <td style="text-align:right">
                      ${c.status === 'draft' ? `<button class="btn small send-camp" data-id="${c.id}">${t('Enviar', 'Send')}</button>` : ''}
                      <button class="btn ghost small del-camp" data-id="${c.id}">✕</button></td>
                  </tr>`
                )
                .join('')}</tbody></table>`
            : `<div class="empty"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>${t('Aún no hay campañas', 'No campaigns yet')}</div>`
        }
      </div>
    </div>
    <div class="card">
      <div class="card-title">${t('Plantillas de Email', 'Email Templates')}</div>
      <div class="card-body">
        <p class="muted" style="margin-bottom:10px">${t('Campos de combinación:', 'Merge fields:')} <code class="inline">{{first_name}}</code> <code class="inline">{{last_name}}</code> <code class="inline">{{email}}</code> <code class="inline">{{phone}}</code></p>
        ${
          templates.length
            ? templates
                .map(
                  (tpl) => `<div class="block-item">
                    <div class="b-head"><span>${esc(tpl.name)}</span>
                      <span><button class="btn secondary small edit-tpl" data-id="${tpl.id}">${t('Editar', 'Edit')}</button>
                      <button class="btn ghost small del-tpl" data-id="${tpl.id}">✕</button></span></div>
                    <div><strong style="font-size:13px">${esc(tpl.subject)}</strong></div>
                    <div class="muted" style="font-size:12px;white-space:pre-wrap">${esc(tpl.body.slice(0, 140))}${tpl.body.length > 140 ? '…' : ''}</div>
                  </div>`
                )
                .join('')
            : `<div class="empty">${t('Aún no hay plantillas', 'No templates yet')}</div>`
        }
      </div>
    </div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-title">${t('Trigger Links (con QR)', 'Trigger Links (with QR)')}</div>
    <div class="card-body">
      <p class="muted" style="font-size:12px;margin-bottom:10px">${t('Enlaces con seguimiento: cuentan clics, etiquetan al contacto (disparando automatizaciones) y redirigen. En mensajes usa', 'Tracked links: they count clicks, tag the contact (triggering automations), and redirect. In messages use')} <code class="inline">{{link:slug}}</code> ${t('para personalizarlo por contacto.', 'to personalize it per contact.')}</p>
      <div class="flex" style="margin-bottom:12px">
        <input class="input" id="tl-name" placeholder="${t('Nombre (ej. Promo Junio)', 'Name (e.g. June Promo)')}">
        <input class="input" id="tl-url" placeholder="https://destino.com/oferta" style="flex:2">
        <input class="input" id="tl-tag" placeholder="${t('tag (opcional)', 'tag (optional)')}" style="width:130px">
        <button class="btn secondary" id="tl-add">${t('+ Crear', '+ Create')}</button>
      </div>
      ${
        links.length
          ? `<table class="table"><thead><tr><th>${t('Nombre', 'Name')}</th><th>${t('Link', 'Link')}</th><th>${t('Tag', 'Tag')}</th><th>${t('Clics', 'Clicks')}</th><th>${t('QR', 'QR')}</th><th></th></tr></thead><tbody>
            ${links
              .map(
                (l) => `<tr>
                  <td><strong>${esc(l.name)}</strong></td>
                  <td><code class="inline">/l/${esc(l.slug)}</code></td>
                  <td>${l.tag ? `<span class="tag">${esc(l.tag)}</span>` : '<span class="muted">—</span>'}</td>
                  <td><span class="badge indigo">${l.clicks}</span></td>
                  <td><a href="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(location.origin + '/l/' + l.slug)}" target="_blank" class="btn secondary small">QR ↗</a></td>
                  <td><button class="btn ghost small tl-del" data-id="${l.id}">✕</button></td>
                </tr>`
              )
              .join('')}</tbody></table>`
          : `<p class="muted">${t('Sin trigger links aún.', 'No trigger links yet.')}</p>`
      }
    </div>
  </div>`;

  function templateModal(tpl = null) {
    const brand = (state.agency && state.agency.brand_color) || '#4f46e5';
    openEmailBuilder(tpl, async (payload) => {
      if (tpl) await api(`/marketing/templates/${tpl.id}`, { method: 'PUT', body: payload });
      else await api('/marketing/templates', { method: 'POST', body: payload });
      renderMarketing(view);
    }, brand);
  }

  view.querySelector('#tl-add').addEventListener('click', async () => {
    const name = view.querySelector('#tl-name').value.trim();
    const target_url = view.querySelector('#tl-url').value.trim();
    if (!name || !target_url) return toast(t('Nombre y URL de destino requeridos', 'Name and target URL required'), true);
    try {
      await api('/marketing/links', { method: 'POST', body: { name, target_url, tag: view.querySelector('#tl-tag').value.trim() } });
      toast(t('Trigger link creado', 'Trigger link created'));
      renderMarketing(view);
    } catch (err) { toast(err.message, true); }
  });
  view.querySelectorAll('.tl-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('¿Eliminar link?', 'Delete link?'))) return;
      await api(`/marketing/links/${b.dataset.id}`, { method: 'DELETE' });
      renderMarketing(view);
    })
  );
  view.querySelector('#new-template').addEventListener('click', () => templateModal());
  view.querySelectorAll('.edit-tpl').forEach((b) =>
    b.addEventListener('click', () => templateModal(templates.find((t) => t.id === Number(b.dataset.id))))
  );
  view.querySelectorAll('.del-tpl').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('¿Eliminar plantilla?', 'Delete template?'))) return;
      await api(`/marketing/templates/${b.dataset.id}`, { method: 'DELETE' });
      renderMarketing(view);
    })
  );

  view.querySelector('#new-campaign').addEventListener('click', () => {
    const modal = openModal(`
      <h2>${t('Nueva campaña', 'New Campaign')}</h2>
      <form id="camp-form">
        <label class="field"><span class="label">${t('Nombre', 'Name')}</span><input class="input" name="name" required placeholder="${t('Promo de junio', 'June Promo')}"></label>
        <div class="form-row">
          <label class="field"><span class="label">${t('Canal', 'Channel')}</span><select class="input" name="channel" id="channel-sel">
            <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select></label>
          <label class="field"><span class="label">${t('Audiencia', 'Audience')}</span><select class="input" name="tag_filter">
            <option value="">${t('Todos los contactos', 'All contacts')}</option>
            ${tags.map((tg) => `<option value="${esc(tg.tag)}">${t(`etiqueta: ${esc(tg.tag)} (${tg.count})`, `tag: ${esc(tg.tag)} (${tg.count})`)}</option>`).join('')}
          </select></label>
        </div>
        ${templates.length ? `<label class="field"><span class="label">${t('Partir de una plantilla', 'Start from a template')}</span><select class="input" id="tpl-sel">
          <option value="">${t('— ninguna —', '— none —')}</option>
          ${templates.map((tpl) => `<option value="${tpl.id}">${esc(tpl.name)}</option>`).join('')}
        </select></label>` : ''}
        <label class="field" id="subject-field"><span class="label">${t('Asunto', 'Subject')}</span><input class="input" name="subject"></label>
        <label class="field"><span class="label">${t('Mensaje', 'Message')}
          <button type="button" class="btn secondary small" id="ai-gen" style="margin-left:8px">${t('Generar con IA', 'Generate with AI')}</button></span>
          <textarea class="input" name="body" rows="7" required placeholder="${t('Hola {{first_name}}, …', 'Hi {{first_name}}, …')}"></textarea></label>
        <label class="field"><span class="label">${t('Programar envío (opcional)', 'Schedule send (optional)')}</span>
          <input class="input" name="send_at" type="datetime-local">
          <span class="muted" style="font-size:11px">${t('Déjalo vacío para guardar como borrador y enviar manualmente.', 'Leave empty to save as a draft and send manually.')}</span></label>
        <div class="modal-actions">
          <button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
          <button class="btn">${t('Guardar', 'Save')}</button>
        </div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#channel-sel').addEventListener('change', (e) => {
      modal.querySelector('#subject-field').style.display = e.target.value === 'email' ? 'block' : 'none';
    });
    modal.querySelector('#ai-gen').addEventListener('click', async () => {
      const desc = prompt(t('Describe la campaña (ej: "promo 20% blanqueamiento dental este mes, urgencia, cita gratis"):', 'Describe the campaign (e.g. "20% off teeth whitening this month, urgency, free appointment"):'));
      if (!desc) return;
      const btn = modal.querySelector('#ai-gen');
      btn.disabled = true;
      btn.textContent = t('Generando…', 'Generating…');
      try {
        const kind = modal.querySelector('#channel-sel').value === 'email' ? 'email' : modal.querySelector('#channel-sel').value;
        const gen = await api('/ai/generate', { method: 'POST', body: { kind, prompt: desc } });
        if (gen.subject) modal.querySelector('[name=subject]').value = gen.subject;
        modal.querySelector('[name=body]').value = gen.body || '';
        toast(t('Copy generado — revísalo y ajusta', 'Copy generated — review and adjust it'));
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = t('Generar con IA', 'Generate with AI');
      }
    });
    modal.querySelector('#tpl-sel')?.addEventListener('change', (e) => {
      const tpl = templates.find((tp) => tp.id === Number(e.target.value));
      if (tpl) {
        modal.querySelector('[name=subject]').value = tpl.subject;
        modal.querySelector('[name=body]').value = tpl.body;
      }
    });
    modal.querySelector('#camp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = formData(e.target);
        if (data.send_at) data.send_at = new Date(data.send_at).toISOString();
        else delete data.send_at;
        await api('/marketing/campaigns', { method: 'POST', body: data });
        closeOverlay();
        toast(data.send_at ? t('Campaña programada', 'Campaign scheduled') : t('Campaña guardada como borrador', 'Campaign saved as draft'));
        renderMarketing(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  view.querySelectorAll('.send-camp').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('¿Enviar esta campaña ahora a todos los contactos coincidentes?', 'Send this campaign now to all matching contacts?'))) return;
      try {
        const res = await api(`/marketing/campaigns/${b.dataset.id}/send`, { method: 'POST' });
        toast(t(`Campaña enviada a ${res.recipient_count} contacto(s)`, `Campaign sent to ${res.recipient_count} contact(s)`));
        renderMarketing(view);
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
  view.querySelectorAll('.del-camp').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('¿Eliminar campaña?', 'Delete campaign?'))) return;
      await api(`/marketing/campaigns/${b.dataset.id}`, { method: 'DELETE' });
      renderMarketing(view);
    })
  );
}
