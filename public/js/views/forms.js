import { api } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate, fullName } from '../ui.js';
import { t } from '../i18n.js';

const FIELDS = [
  ['first_name', () => t('Nombre', 'First name')],
  ['last_name', () => t('Apellidos', 'Last name')],
  ['email', () => t('Email', 'Email')],
  ['phone', () => t('Teléfono', 'Phone')],
  ['message', () => t('Mensaje', 'Message')],
];

export async function renderForms(view) {
  const forms = await api('/forms');

  view.innerHTML = `
  <div class="page-header">
    <div><h1>${t('Formularios', 'Forms')}</h1>
      <p class="muted" style="font-size:13px">${t('Formularios de captación embebibles que entran directo a tu CRM y disparan automatizaciones.', 'Embeddable lead-capture forms that flow straight into your CRM and fire automations.')}</p></div>
    <button class="btn" id="new-form">${t('+ Nuevo formulario', '+ New form')}</button>
  </div>
  ${
    forms.length
      ? `<div class="grid-2">${forms
          .map((f) => {
            const url = `${location.origin}/form/${f.slug}`;
            return `<div class="card" style="margin-bottom:16px"><div class="card-body">
              <div class="flex"><strong style="font-size:15px">${esc(f.name)}</strong>
                <div class="right">
                  <button class="btn secondary small form-subs" data-id="${f.id}" data-name="${esc(f.name)}">${t('Envíos', 'Submissions')}</button>
                  <button class="btn secondary small form-edit" data-id="${f.id}">${t('Editar', 'Edit')}</button>
                  <button class="btn ghost small form-del" data-id="${f.id}">✕</button></div></div>
              <div class="access-link" style="display:flex;align-items:center;gap:6px;margin:10px 0">
                <code class="inline" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(url)}</code>
                <a class="btn ghost small" href="${esc(url)}" target="_blank">${t('Abrir', 'Open')} ↗</a>
                <button class="btn ghost small form-embed" data-url="${esc(url)}">${t('Incrustar', 'Embed')}</button>
              </div>
              ${f.tag ? `<span class="tag">${esc(f.tag)}</span>` : ''}
            </div></div>`;
          })
          .join('')}</div>`
      : `<div class="empty card" style="padding:50px">${t('Aún no hay formularios. Crea uno y compártelo o incrústalo en tu web.', 'No forms yet. Create one and share it or embed it on your site.')}</div>`
  }`;

  view.querySelector('#new-form').addEventListener('click', () => formModal());
  view.querySelectorAll('.form-edit').forEach((b) =>
    b.addEventListener('click', () => formModal(forms.find((f) => f.id === Number(b.dataset.id))))
  );
  view.querySelectorAll('.form-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('¿Eliminar este formulario?', 'Delete this form?'))) return;
      await api(`/forms/${b.dataset.id}`, { method: 'DELETE' });
      toast(t('Formulario eliminado', 'Form deleted'));
      renderForms(view);
    })
  );
  view.querySelectorAll('.form-embed').forEach((b) =>
    b.addEventListener('click', () => {
      const snippet = `<iframe src="${b.dataset.url}" style="width:100%;max-width:480px;height:520px;border:0" title="form"></iframe>`;
      openModal(`<h2>${t('Incrustar formulario', 'Embed form')}</h2>
        <p class="muted" style="font-size:12px;margin-bottom:8px">${t('Pega este código en tu web:', 'Paste this code on your website:')}</p>
        <textarea class="input" rows="4" readonly onclick="this.select()">${esc(snippet)}</textarea>
        <div class="modal-actions"><button class="btn" id="close-embed">${t('Cerrar', 'Close')}</button></div>`)
        .querySelector('#close-embed').addEventListener('click', closeOverlay);
    })
  );
  view.querySelectorAll('.form-subs').forEach((b) =>
    b.addEventListener('click', async () => {
      const subs = await api(`/forms/${b.dataset.id}/submissions`);
      openModal(`<h2>${t('Envíos', 'Submissions')} — ${esc(b.dataset.name)}</h2>
        ${
          subs.length
            ? `<div style="max-height:60vh;overflow:auto">${subs
                .map(
                  (s) => `<div class="appt-row"><div style="flex:1"><strong>${esc(fullName(s))}</strong>
                    <div class="muted" style="font-size:12px">${esc(s.email || s.phone || '')}</div></div>
                    <div class="muted" style="font-size:11px">${fmtDate(s.created_at)}</div>
                    <a class="btn ghost small" href="#/contacts/${s.contact_id}">${t('Ver', 'View')} →</a></div>`
                )
                .join('')}</div>`
            : `<p class="muted">${t('Aún no hay envíos.', 'No submissions yet.')}</p>`
        }
        <div class="modal-actions"><button class="btn" id="close-subs">${t('Cerrar', 'Close')}</button></div>`)
        .querySelector('#close-subs').addEventListener('click', closeOverlay);
    })
  );

  async function formModal(form = null) {
    const selected = (() => { try { return JSON.parse(form?.fields || '["first_name","email","phone"]'); } catch { return ['email']; } })();
    const required = (() => { try { return JSON.parse(form?.required_fields || '[]'); } catch { return []; } })();
    const customFields = await api('/custom-fields').catch(() => []);
    const allFields = [...FIELDS, ...customFields.map((cf) => [cf.key, () => cf.name])];
    const fieldRow = ([k, label]) => `<div class="flex" style="gap:8px;font-size:13px;align-items:center">
        <label class="flex" style="gap:5px;flex:1"><input type="checkbox" class="fld-cb" value="${esc(k)}" ${selected.includes(k) ? 'checked' : ''} ${k === 'email' ? 'disabled checked' : ''}> ${esc(label())}</label>
        <label class="flex muted" style="gap:4px;font-size:11px"><input type="checkbox" class="req-cb" value="${esc(k)}" ${required.includes(k) ? 'checked' : ''} ${k === 'email' ? 'disabled checked' : ''}> ${t('obligatorio', 'required')}</label>
      </div>`;
    const modal = openModal(`
      <h2>${form ? t('Editar formulario', 'Edit form') : t('Nuevo formulario', 'New form')}</h2>
      <form id="form-form">
        <label class="field"><span class="label">${t('Nombre', 'Name')}</span><input class="input" name="name" required value="${esc(form?.name || '')}" placeholder="${t('Contacto rápido', 'Quick contact')}"></label>
        <label class="field"><span class="label">${t('Titular', 'Headline')}</span><input class="input" name="headline" value="${esc(form?.headline || '')}" placeholder="${t('Déjanos tus datos', 'Leave us your details')}"></label>
        <div class="field"><span class="label">${t('Campos (marca cuáles y si son obligatorios)', 'Fields (pick which and whether required)')}</span>
          <div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow:auto">${allFields.map(fieldRow).join('')}</div></div>
        <div class="form-row">
          <label class="field"><span class="label">${t('Etiqueta al enviar', 'Tag on submit')}</span><input class="input" name="tag" value="${esc(form?.tag || '')}" placeholder="lead"></label>
          <label class="field"><span class="label">${t('Avisar por email a (opcional)', 'Notify by email (optional)')}</span><input class="input" name="notify_email" value="${esc(form?.notify_email || '')}" placeholder="equipo@agencia.com"></label>
        </div>
        <div class="form-row">
          <label class="field"><span class="label">${t('Redirección tras enviar (opcional)', 'Redirect after submit (optional)')}</span><input class="input" name="redirect_url" value="${esc(form?.redirect_url || '')}" placeholder="https://…/gracias"></label>
          <label class="field"><span class="label">${t('Mensaje de éxito', 'Success message')}</span><input class="input" name="success_message" value="${esc(form?.success_message || '')}" placeholder="${t('¡Gracias!', 'Thanks!')}"></label>
        </div>
        <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Guardar', 'Save')}</button></div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#form-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      body.fields = [...modal.querySelectorAll('.fld-cb:checked')].map((c) => c.value);
      body.required_fields = [...modal.querySelectorAll('.req-cb:checked')].map((c) => c.value).filter((k) => body.fields.includes(k));
      try {
        if (form) await api(`/forms/${form.id}`, { method: 'PUT', body });
        else await api('/forms', { method: 'POST', body });
        closeOverlay();
        toast(t('Formulario guardado', 'Form saved'));
        renderForms(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  }
}
