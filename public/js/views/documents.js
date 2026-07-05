import { api } from '../api.js';
import { esc, openModal, closeOverlay, toast, fmtDate, fullName } from '../ui.js';
import { t } from '../i18n.js';

const STATUS = {
  draft: ['gray', () => t('Borrador', 'Draft')],
  sent: ['amber', () => t('Enviado', 'Sent')],
  signed: ['green', () => t('Firmado', 'Signed')],
};

export async function renderDocuments(view) {
  const docs = await api('/documents');

  view.innerHTML = `
  <div class="page-header">
    <h1>${t('Documentos y Contratos', 'Documents & Contracts')}</h1>
    <div class="spacer"></div>
    <button class="btn" id="new-doc">${t('+ Nuevo documento', '+ New document')}</button>
  </div>
  <p class="muted" style="font-size:13px;margin-bottom:14px">${t('Crea contratos y documentos, envíalos al cliente y recíbelos firmados con firma electrónica — como GoHighLevel.', 'Create contracts and documents, send them to the client and get them back e-signed — like GoHighLevel.')}</p>
  <div class="card">
    ${
      docs.length
        ? `<table class="table"><thead><tr><th>${t('Título', 'Title')}</th><th>${t('Cliente', 'Client')}</th><th>${t('Estado', 'Status')}</th><th>${t('Firmado', 'Signed')}</th><th></th></tr></thead>
          <tbody>${docs.map((d) => {
            const [color, label] = STATUS[d.status] || STATUS.draft;
            return `<tr>
              <td><strong>${esc(d.title)}</strong><div class="muted" style="font-size:11px">${fmtDate(d.created_at)}</div></td>
              <td>${d.contact_id ? esc(fullName(d)) : '<span class="muted">—</span>'}</td>
              <td><span class="badge ${color}">${label()}</span></td>
              <td>${d.signed_at ? `${esc(d.signer_name)}<div class="muted" style="font-size:11px">${fmtDate(d.signed_at)}</div>` : '<span class="muted">—</span>'}</td>
              <td style="text-align:right;white-space:nowrap">
                <a class="btn secondary small" href="/sign/${esc(d.token)}" target="_blank">${t('Ver ↗', 'View ↗')}</a>
                ${d.status !== 'signed' ? `<button class="btn secondary small edit-doc" data-id="${d.id}">${t('Editar', 'Edit')}</button>
                  <button class="btn small send-doc" data-id="${d.id}" ${d.contact_id ? '' : `disabled title="${t('Asigna un contacto', 'Assign a contact')}"`}>${t('Enviar', 'Send')}</button>` : ''}
                <button class="btn ghost small del-doc" data-id="${d.id}">✕</button>
              </td></tr>`;
          }).join('')}</tbody></table>`
        : `<div class="empty" style="padding:50px"><div class="big">✍️</div>${t('Sin documentos todavía. Crea tu primer contrato para firmar.', 'No documents yet. Create your first contract to sign.')}</div>`
    }
  </div>`;

  view.querySelector('#new-doc').addEventListener('click', () => docModal());
  view.querySelectorAll('.edit-doc').forEach((b) => b.addEventListener('click', async () => {
    docModal(await api(`/documents/${b.dataset.id}`));
  }));
  view.querySelectorAll('.del-doc').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('¿Eliminar este documento?', 'Delete this document?'))) return;
    await api(`/documents/${b.dataset.id}`, { method: 'DELETE' });
    renderDocuments(view);
  }));
  view.querySelectorAll('.send-doc').forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await api(`/documents/${b.dataset.id}/send`, { method: 'POST' });
      const msg = r.delivery === 'sent' ? t('Enviado por email al cliente', 'Emailed to the client')
        : r.delivery === 'simulated' ? t('Marcado como enviado (configura email real para envío)', 'Marked as sent (set up real email to deliver)')
        : t('Marcado como enviado', 'Marked as sent');
      toast(msg);
      prompt(t('Link de firma (cópialo para el cliente):', 'Sign link (copy for the client):'), location.origin + '/sign/' + (await api(`/documents/${b.dataset.id}`)).token);
      renderDocuments(view);
    } catch (err) { toast(err.message, true); }
  }));

  async function docModal(doc = null) {
    const contacts = await api('/contacts?limit=200');
    const list = Array.isArray(contacts) ? contacts : (contacts.contacts || contacts.items || []);
    const modal = openModal(`
      <h2>${doc ? t('Editar documento', 'Edit document') : t('Nuevo documento', 'New document')}</h2>
      <form id="doc-form">
        <label class="field"><span class="label">${t('Título', 'Title')}</span><input class="input" name="title" required value="${doc ? esc(doc.title) : ''}" placeholder="${t('Contrato de servicios', 'Service agreement')}"></label>
        <label class="field"><span class="label">${t('Cliente', 'Client')}</span>
          <select class="input" name="contact_id"><option value="">${t('— sin asignar —', '— unassigned —')}</option>
          ${list.map((c) => `<option value="${c.id}" ${doc && doc.contact_id === c.id ? 'selected' : ''}>${esc(fullName(c))}${c.email ? ` · ${esc(c.email)}` : ''}</option>`).join('')}</select></label>
        <label class="field"><span class="label">${t('Contenido del documento', 'Document content')}</span>
          <textarea class="input" name="body" rows="10" placeholder="${t('Escribe aquí el contrato o documento. El cliente lo verá y lo firmará al final.', 'Write the contract or document here. The client will read and sign it at the end.')}">${doc ? esc(doc.body || '') : ''}</textarea></label>
        <div class="modal-actions">
          <button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
          <button class="btn">${t('Guardar', 'Save')}</button>
        </div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#doc-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const body = { title: f.title, body: f.body, contact_id: f.contact_id ? Number(f.contact_id) : null };
      try {
        if (doc) await api(`/documents/${doc.id}`, { method: 'PUT', body });
        else await api('/documents', { method: 'POST', body });
        closeOverlay();
        toast(t('Documento guardado', 'Document saved'));
        renderDocuments(view);
      } catch (err) { toast(err.message, true); }
    });
  }
}
