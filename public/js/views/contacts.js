import { api } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate, fmtMoney, fullName, initials, icon } from '../ui.js';
import { t } from '../i18n.js';

export async function renderContacts(view, rest = []) {
  if (rest[0]) return renderContactDetail(view, rest[0]);

  let q = '';
  let tag = '';
  let advFilters = null; // array of {field,value} when advanced filtering
  let advMatch = 'all';

  async function load() {
    const selected = new Set();
    let contacts;
    if (advFilters && advFilters.length) {
      contacts = await api('/contacts/search', { method: 'POST', body: { filters: advFilters, match: advMatch } });
    } else {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (tag) params.set('tag', tag);
      contacts = await api(`/contacts?${params}`);
    }
    const [tags, smartLists] = await Promise.all([api('/contacts/meta/tags'), api('/contacts/meta/smart-lists')]);

    view.innerHTML = `
    <div class="page-header">
      <h1>${t('Contactos', 'Contacts')}</h1><span class="badge gray">${contacts.length}</span>
      <div class="spacer"></div>
      <input class="input" id="search" placeholder="${t('Buscar nombre, email, teléfono…', 'Search name, email, phone…')}" style="width:220px" value="${esc(q)}" ${advFilters ? 'disabled' : ''}>
      <select class="input" id="tag-filter" style="width:150px" ${advFilters ? 'disabled' : ''}>
        <option value="">${t('Todas las etiquetas', 'All tags')}</option>
        ${tags.map((tg) => `<option value="${esc(tg.tag)}" ${tg.tag === tag ? 'selected' : ''}>${esc(tg.tag)} (${tg.count})</option>`).join('')}
      </select>
      <button class="btn secondary ${advFilters ? 'active' : ''}" id="adv-filter">${t('Filtros', 'Filters')}${advFilters ? ` (${advFilters.length})` : ''}</button>
      <button class="btn secondary" id="export-csv" title="${t('Exportar CSV', 'Export CSV')}">CSV</button>
      <button class="btn secondary" id="import-csv" title="${t('Importar CSV', 'Import CSV')}">CSV</button>
      <button class="btn secondary" id="find-dupes" title="${t('Buscar duplicados', 'Find duplicates')}">²</button>
      <input type="file" id="csv-file" accept=".csv,text/csv" style="display:none">
      <button class="btn" id="add-contact">+ ${t('Añadir contacto', 'Add Contact')}</button>
    </div>
    <div class="flex" style="margin-bottom:12px;flex-wrap:wrap;gap:6px">
      ${smartLists
        .map(
          (l) => `<span class="tag" style="cursor:pointer;padding:5px 12px" data-sl='${esc(JSON.stringify(l.filters))}'>${esc(l.name)}
            <a href="#" class="sl-del" data-id="${l.id}" style="color:inherit;margin-left:4px">×</a></span>`
        )
        .join('')}
      ${(q || tag || advFilters) ? `<button class="btn secondary small" id="save-sl">${t('Guardar filtro como lista', 'Save filter as list')}</button>` : ''}
      ${advFilters ? `<button class="btn secondary small" id="clear-adv">${t('Quitar filtros', 'Clear filters')}</button>` : ''}
    </div>
    <div class="bulk-bar" id="bulk-bar" style="display:none;align-items:center;gap:8px;margin-bottom:10px;padding:8px 12px;background:var(--surface-2,#f3f4f6);border-radius:10px">
      <strong id="bulk-count"></strong>
      <button class="btn small" data-bulk="tag-add">+ ${t('Etiqueta', 'Tag')}</button>
      <button class="btn small secondary" data-bulk="tag-remove">− ${t('Etiqueta', 'Tag')}</button>
      <button class="btn small secondary" data-bulk="message">${t('Enviar mensaje', 'Send message')}</button>
      <button class="btn small secondary" data-bulk="workflow">${t('A workflow', 'To workflow')}</button>
      <button class="btn small danger" data-bulk="delete">${t('Eliminar', 'Delete')}</button>
      <div class="spacer"></div>
      <a href="#" id="bulk-clear" class="muted" style="font-size:12px">${t('Deseleccionar', 'Clear')}</a>
    </div>
    <div class="card">
      ${
        contacts.length
          ? `<table class="table"><thead><tr><th style="width:34px"><input type="checkbox" id="sel-all"></th><th>${t('Nombre', 'Name')}</th><th>${t('Email', 'Email')}</th><th>${t('Teléfono', 'Phone')}</th><th>${t('Etiquetas', 'Tags')}</th><th>${t('Origen', 'Source')}</th><th>${t('Creado', 'Created')}</th></tr></thead>
          <tbody>${contacts
            .map(
              (c) => `<tr data-id="${c.id}">
                <td class="sel-cell"><input type="checkbox" class="row-sel" data-id="${c.id}"></td>
                <td><div class="flex" style="gap:9px"><span class="avatar soft">${initials(c)}</span><strong>${esc(fullName(c))}</strong></div></td>
                <td>${esc(c.email)}</td><td>${esc(c.phone)}</td>
                <td>${c.tags.map((tg) => `<span class="tag">${esc(tg)}</span>`).join('')}</td>
                <td><span class="badge gray">${esc(c.source)}</span></td>
                <td class="muted">${fmtDate(c.created_at)}</td></tr>`
            )
            .join('')}</tbody></table>`
          : `<div class="empty"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>${t('Sin resultados. Ajusta los filtros o añade un contacto.', 'No results. Adjust the filters or add a contact.')}</div>`
      }
    </div>`;

    // ---- Bulk selection ----
    const bar = view.querySelector('#bulk-bar');
    const updateBar = () => {
      if (!bar) return;
      bar.style.display = selected.size ? 'flex' : 'none';
      const cnt = view.querySelector('#bulk-count');
      if (cnt) cnt.textContent = t(`${selected.size} seleccionados`, `${selected.size} selected`);
    };
    view.querySelectorAll('.row-sel').forEach((cb) =>
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(cb.dataset.id);
        if (cb.checked) selected.add(id); else selected.delete(id);
        updateBar();
      })
    );
    view.querySelector('#sel-all')?.addEventListener('change', (e) => {
      view.querySelectorAll('.row-sel').forEach((cb) => { cb.checked = e.target.checked; const id = Number(cb.dataset.id); if (e.target.checked) selected.add(id); else selected.delete(id); });
      updateBar();
    });
    view.querySelector('#bulk-clear')?.addEventListener('click', (e) => { e.preventDefault(); selected.clear(); view.querySelectorAll('.row-sel,#sel-all').forEach((cb) => (cb.checked = false)); updateBar(); });
    view.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', () => bulkAction(b.dataset.bulk, [...selected], load)));

    view.querySelectorAll('tbody tr').forEach((tr) =>
      tr.addEventListener('click', (e) => { if (e.target.closest('.sel-cell')) return; location.hash = `#/contacts/${tr.dataset.id}`; })
    );
    view.querySelector('#adv-filter').addEventListener('click', () => filterBuilder(tags, advFilters, advMatch, (f, m) => { advFilters = f; advMatch = m; q = ''; tag = ''; load(); }));
    view.querySelector('#clear-adv')?.addEventListener('click', () => { advFilters = null; load(); });
    let searchTimer;
    view.querySelector('#search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { q = e.target.value; load(); }, 300);
    });
    view.querySelector('#tag-filter').addEventListener('change', (e) => { tag = e.target.value; load(); });
    view.querySelector('#add-contact').addEventListener('click', () => contactModal(load));
    view.querySelectorAll('[data-sl]').forEach((chip) =>
      chip.addEventListener('click', (e) => {
        if (e.target.classList.contains('sl-del')) return;
        const f = JSON.parse(chip.dataset.sl);
        if (f.advanced) { advFilters = f.advanced.filters || []; advMatch = f.advanced.match || 'all'; q = ''; tag = ''; }
        else { advFilters = null; q = f.q || ''; tag = f.tag || ''; }
        load();
      })
    );
    view.querySelectorAll('.sl-del').forEach((a) =>
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await api(`/contacts/meta/smart-lists/${a.dataset.id}`, { method: 'DELETE' });
        load();
      })
    );
    view.querySelector('#save-sl')?.addEventListener('click', async () => {
      const name = prompt(t('Nombre de la lista:', 'List name:'), tag || q || t('Filtro', 'Filter'));
      if (!name) return;
      const filters = advFilters ? { advanced: { filters: advFilters, match: advMatch } } : { q, tag };
      await api('/contacts/meta/smart-lists', { method: 'POST', body: { name, filters } });
      toast(t('Lista guardada', 'List saved'));
      load();
    });
    view.querySelector('#find-dupes').addEventListener('click', async () => {
      const groups = await api('/contacts/meta/duplicates');
      const modal = openModal(`
        <h2>${t('Contactos duplicados', 'Duplicate contacts')}</h2>
        ${
          groups.length
            ? groups
                .map(
                  (g, gi) => `<div class="block-item">
                    <div class="b-head"><span>${g.kind === 'email' ? '' : ''} ${esc(g.value)}</span></div>
                    ${g.contacts
                      .map(
                        (c, ci) => `<div class="flex" style="margin:4px 0">
                          <span>${esc(fullName(c))} <span class="muted" style="font-size:11px">#${c.id} · ${esc(c.source)}</span></span>
                          ${ci > 0 ? `<button class="btn secondary small right merge-btn" data-keep="${g.contacts[0].id}" data-merge="${c.id}">${t(`Fusionar en #${g.contacts[0].id}`, `Merge into #${g.contacts[0].id}`)}</button>` : `<span class="badge green right">${t('se conserva', 'kept')}</span>`}
                        </div>`
                      )
                      .join('')}
                  </div>`
                )
                .join('')
            : `<div class="empty">${t('No hay duplicados por email ni teléfono.', 'No duplicates by email or phone.')}</div>`
        }`);
      modal.querySelectorAll('.merge-btn').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm(t('¿Fusionar? Se moverán mensajes, citas, notas y etiquetas al contacto conservado.', 'Merge? Messages, appointments, notes and tags will be moved to the kept contact.'))) return;
          try {
            await api('/contacts/merge', { method: 'POST', body: { keep_id: Number(b.dataset.keep), merge_id: Number(b.dataset.merge) } });
            toast(t('Contactos fusionados', 'Contacts merged'));
            document.getElementById('modal-root').innerHTML = '';
            load();
          } catch (err) { toast(err.message, true); }
        })
      );
    });
    view.querySelector('#export-csv').addEventListener('click', async () => {
      const { state } = await import('../api.js');
      const res = await fetch('/api/contacts/export/csv', {
        headers: { Authorization: `Bearer ${state.token}`, 'X-Location-Id': String(state.locationId) },
      });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'contacts.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    view.querySelector('#import-csv').addEventListener('click', () => view.querySelector('#csv-file').click());
    view.querySelector('#csv-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const csv = await file.text();
      try {
        const result = await api('/contacts/import/csv', { method: 'POST', body: { csv } });
        toast(t(`Importados: ${result.imported} · Omitidos (duplicados): ${result.skipped}`, `Imported: ${result.imported} · Skipped (duplicates): ${result.skipped}`));
        load();
      } catch (err) {
        toast(err.message, true);
      }
      e.target.value = '';
    });
  }

  await load();
}

// Runs a bulk action over the selected contact ids, then reloads.
async function bulkAction(action, ids, reload) {
  if (!ids.length) return;
  try {
    if (action === 'tag-add' || action === 'tag-remove') {
      const tag = prompt(t('Nombre de la etiqueta:', 'Tag name:'));
      if (!tag) return;
      const r = await api('/contacts/bulk/tags', { method: 'POST', body: { ids, tag, op: action === 'tag-remove' ? 'remove' : 'add' } });
      toast(t(`Etiqueta actualizada en ${r.affected}`, `Tag updated on ${r.affected}`));
      reload();
    } else if (action === 'delete') {
      if (!confirm(t(`¿Eliminar ${ids.length} contactos? No se puede deshacer.`, `Delete ${ids.length} contacts? This cannot be undone.`))) return;
      const r = await api('/contacts/bulk/delete', { method: 'POST', body: { ids } });
      toast(t(`${r.affected} eliminados`, `${r.affected} deleted`));
      reload();
    } else if (action === 'message') {
      const modal = openModal(`<h2>${t('Enviar mensaje a', 'Send message to')} ${ids.length}</h2>
        <form id="bm-form">
          <label class="field"><span class="label">${t('Canal', 'Channel')}</span><select class="input" name="channel"><option value="sms">SMS</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select></label>
          <label class="field email-only" style="display:none"><span class="label">${t('Asunto', 'Subject')}</span><input class="input" name="subject"></label>
          <label class="field"><span class="label">${t('Mensaje (usa {{first_name}})', 'Message (use {{first_name}})')}</span><textarea class="input" name="body" rows="4" required></textarea></label>
          <div class="modal-actions"><button type="button" class="btn secondary" id="c">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Enviar', 'Send')}</button></div>
        </form>`);
      const chan = modal.querySelector('[name=channel]');
      const toggle = () => { modal.querySelector('.email-only').style.display = chan.value === 'email' ? 'block' : 'none'; };
      chan.addEventListener('change', toggle); toggle();
      modal.querySelector('#c').addEventListener('click', closeOverlay);
      modal.querySelector('#bm-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const r = await api('/contacts/bulk/message', { method: 'POST', body: { ids, ...formData(e.target) } });
          closeOverlay();
          toast(t(`Enviados: ${r.sent} · Omitidos (DND): ${r.skipped}`, `Sent: ${r.sent} · Skipped (DND): ${r.skipped}`));
          reload();
        } catch (err) { toast(err.message, true); }
      });
    } else if (action === 'workflow') {
      const workflows = await api('/workflows').catch(() => []);
      if (!workflows.length) { toast(t('No hay workflows. Crea uno en Automatizaciones.', 'No workflows. Create one in Automations.'), true); return; }
      const modal = openModal(`<h2>${t('Añadir a workflow', 'Add to workflow')}</h2>
        <form id="wf-form"><label class="field"><span class="label">Workflow</span><select class="input" name="workflow_id">${workflows.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></label>
          <div class="modal-actions"><button type="button" class="btn secondary" id="c">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Añadir', 'Add')}</button></div></form>`);
      modal.querySelector('#c').addEventListener('click', closeOverlay);
      modal.querySelector('#wf-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const r = await api('/contacts/bulk/workflow', { method: 'POST', body: { ids, workflow_id: Number(formData(e.target).workflow_id) } });
          closeOverlay();
          toast(t(`${r.enrolled} añadidos al workflow`, `${r.enrolled} enrolled`));
          reload();
        } catch (err) { toast(err.message, true); }
      });
    }
  } catch (err) { toast(err.message, true); }
}

// Advanced multi-condition filter builder.
function filterBuilder(tags, current, curMatch, onApply) {
  const FIELDS = [
    ['name', t('Nombre contiene', 'Name contains'), 'text'],
    ['email', t('Email contiene', 'Email contains'), 'text'],
    ['phone', t('Teléfono contiene', 'Phone contains'), 'text'],
    ['tag', t('Tiene etiqueta', 'Has tag'), 'tag'],
    ['no_tag', t('No tiene etiqueta', 'Does not have tag'), 'tag'],
    ['source', t('Origen es', 'Source is'), 'text'],
    ['dnd', t('DND activado', 'DND enabled'), 'bool'],
    ['has_opportunity', t('Tiene oportunidad', 'Has opportunity'), 'none'],
    ['score_gte', t('Puntuación ≥', 'Score ≥'), 'number'],
    ['created_after', t('Creado después de', 'Created after'), 'date'],
    ['created_before', t('Creado antes de', 'Created before'), 'date'],
  ];
  const rowHtml = (cond = { field: 'name', value: '' }) => {
    const def = FIELDS.find((f) => f[0] === cond.field) || FIELDS[0];
    const valInput = () => {
      if (def[2] === 'none') return '<span class="muted" style="flex:1;align-self:center;font-size:12px">—</span>';
      if (def[2] === 'bool') return `<select class="input fb-val" style="flex:1"><option value="true">${t('Sí', 'Yes')}</option><option value="">No</option></select>`;
      if (def[2] === 'tag') return `<select class="input fb-val" style="flex:1"><option value="">—</option>${tags.map((tg) => `<option value="${esc(tg.tag)}" ${cond.value === tg.tag ? 'selected' : ''}>${esc(tg.tag)}</option>`).join('')}</select>`;
      const type = def[2] === 'number' ? 'number' : def[2] === 'date' ? 'date' : 'text';
      return `<input class="input fb-val" style="flex:1" type="${type}" value="${esc(cond.value ?? '')}">`;
    };
    return `<div class="flex fb-row" style="gap:6px;margin-bottom:6px">
      <select class="input fb-field" style="flex:0 0 190px">${FIELDS.map((f) => `<option value="${f[0]}" ${f[0] === cond.field ? 'selected' : ''}>${esc(f[1])}</option>`).join('')}</select>
      ${valInput()}
      <button type="button" class="btn ghost small fb-del">×</button>
    </div>`;
  };
  const modal = openModal(`<h2>${t('Filtros avanzados', 'Advanced filters')}</h2>
    <div class="flex" style="gap:12px;margin-bottom:10px;font-size:13px">
      <label class="flex" style="gap:4px"><input type="radio" name="match" value="all" ${curMatch !== 'any' ? 'checked' : ''}> ${t('Cumplen todas', 'Match all')}</label>
      <label class="flex" style="gap:4px"><input type="radio" name="match" value="any" ${curMatch === 'any' ? 'checked' : ''}> ${t('Cumplen alguna', 'Match any')}</label>
    </div>
    <div id="fb-rows">${(current && current.length ? current : [{ field: 'name', value: '' }]).map(rowHtml).join('')}</div>
    <button type="button" class="btn secondary small" id="fb-add">+ ${t('Añadir condición', 'Add condition')}</button>
    <div class="modal-actions"><button type="button" class="btn secondary" id="c">${t('Cancelar', 'Cancel')}</button><button type="button" class="btn" id="fb-apply">${t('Aplicar', 'Apply')}</button></div>`);

  const rebindRow = (row) => {
    row.querySelector('.fb-field').addEventListener('change', function () {
      const def = FIELDS.find((f) => f[0] === this.value) || FIELDS[0];
      row.outerHTML = rowHtml({ field: def[0], value: '' });
      modal.querySelectorAll('.fb-row').forEach(rebindRow);
    });
    row.querySelector('.fb-del').addEventListener('click', () => { row.remove(); });
  };
  modal.querySelectorAll('.fb-row').forEach(rebindRow);
  modal.querySelector('#fb-add').addEventListener('click', () => {
    modal.querySelector('#fb-rows').insertAdjacentHTML('beforeend', rowHtml());
    rebindRow(modal.querySelector('#fb-rows').lastElementChild);
  });
  modal.querySelector('#c').addEventListener('click', closeOverlay);
  modal.querySelector('#fb-apply').addEventListener('click', () => {
    const filters = [];
    modal.querySelectorAll('.fb-row').forEach((row) => {
      const field = row.querySelector('.fb-field').value;
      const valEl = row.querySelector('.fb-val');
      const def = FIELDS.find((f) => f[0] === field);
      let value = valEl ? valEl.value : '';
      if (def[2] === 'bool') value = value === 'true';
      if (def[2] === 'none') value = true;
      if (def[2] !== 'none' && def[2] !== 'bool' && value === '') return; // skip empty
      filters.push({ field, value });
    });
    const match = modal.querySelector('[name=match]:checked').value;
    closeOverlay();
    onApply(filters, match);
  });
}

async function contactModal(onSaved, contact = null) {
  const [customFields, team] = await Promise.all([
    api('/custom-fields'),
    api('/locations/team/users'),
  ]);
  const cfValues = contact?.custom_fields || {};
  const modal = openModal(`
    <h2>${contact ? t('Editar contacto', 'Edit Contact') : t('Nuevo contacto', 'New Contact')}</h2>
    <form id="contact-form">
      <div class="form-row">
        <label class="field"><span class="label">${t('Nombre', 'First name')}</span><input class="input" name="first_name" value="${esc(contact?.first_name || '')}"></label>
        <label class="field"><span class="label">${t('Apellido', 'Last name')}</span><input class="input" name="last_name" value="${esc(contact?.last_name || '')}"></label>
      </div>
      <label class="field"><span class="label">${t('Email', 'Email')}</span><input class="input" name="email" type="email" value="${esc(contact?.email || '')}"></label>
      <label class="field"><span class="label">${t('Teléfono', 'Phone')}</span><input class="input" name="phone" value="${esc(contact?.phone || '')}"></label>
      ${contact ? '' : `<label class="field"><span class="label">${t('Etiquetas (separadas por comas)', 'Tags (comma separated)')}</span><input class="input" name="tags_raw" placeholder="lead, vip"></label>`}
      <label class="field"><span class="label">${t('Responsable', 'Owner')}</span><select class="input" name="owner_user_id">
        <option value="">${t('— sin asignar —', '— unassigned —')}</option>
        ${team.map((u) => `<option value="${u.id}" ${contact?.owner_user_id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
      </select></label>
      ${customFields
        .map(
          (f) => `<label class="field"><span class="label">${esc(f.name)}</span>
            <input class="input" data-cf="${esc(f.key)}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}"
              value="${esc(cfValues[f.key] ?? '')}"></label>`
        )
        .join('')}
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
        <button class="btn">${contact ? t('Guardar', 'Save') : t('Crear contacto', 'Create Contact')}</button>
      </div>
    </form>`);
  modal.querySelector('#cancel').addEventListener('click', closeOverlay);
  modal.querySelector('#contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    const tags = (data.tags_raw || '').split(',').map((t) => t.trim()).filter(Boolean);
    delete data.tags_raw;
    data.owner_user_id = Number(data.owner_user_id) || null;
    const custom_fields = { ...(contact?.custom_fields || {}) };
    modal.querySelectorAll('[data-cf]').forEach((inp) => { custom_fields[inp.dataset.cf] = inp.value; });
    data.custom_fields = custom_fields;
    try {
      if (contact) await api(`/contacts/${contact.id}`, { method: 'PUT', body: data });
      else await api('/contacts', { method: 'POST', body: { ...data, tags } });
      closeOverlay();
      toast(contact ? t('Contacto actualizado', 'Contact updated') : t('Contacto creado', 'Contact created'));
      onSaved();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function renderContactDetail(view, id) {
  const c = await api(`/contacts/${id}`);

  view.innerHTML = `
  <div class="page-header">
    <a href="#/contacts" class="btn secondary small">← ${t('Contactos', 'Contacts')}</a>
    <span class="avatar" style="width:40px;height:40px">${initials(c)}</span>
    <h1>${esc(fullName(c))}</h1>
    ${c.score >= 20 ? `<span class="badge amber">${c.score} pts</span>` : c.score > 0 ? `<span class="badge gray">${c.score} pts</span>` : ''}
    ${c.dnd ? '<span class="badge red">DND</span>' : ''}
    <div class="spacer"></div>
    <button class="btn secondary" id="send-btn">${t('Enviar', 'Send')}</button>
    <button class="btn secondary" id="wf-btn">Workflow</button>
    <button class="btn secondary" id="msg-btn">${t('Inbox', 'Inbox')}</button>
    <button class="btn secondary" id="edit-btn">${t('Editar', 'Edit')}</button>
    <button class="btn danger" id="del-btn">${t('Eliminar', 'Delete')}</button>
  </div>
  <div class="grid-2">
    <div>
      <div class="card" style="margin-bottom:16px"><div class="card-title">${t('Detalles', 'Details')}</div><div class="card-body">
        <p><strong>${t('Email', 'Email')}:</strong> ${esc(c.email) || '<span class="muted">—</span>'}</p>
        <p><strong>${t('Teléfono', 'Phone')}:</strong> ${esc(c.phone) || '<span class="muted">—</span>'}</p>
        <p><strong>${t('Origen', 'Source')}:</strong> <span class="badge gray">${esc(c.source)}</span></p>
        ${c.owner_name ? `<p><strong>${t('Responsable', 'Owner')}:</strong> ${esc(c.owner_name)}</p>` : ''}
        ${Object.entries(c.custom_fields || {}).filter(([, v]) => v !== '' && v != null)
          .map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(v)}</p>`).join('')}
        <p style="margin-top:8px"><strong>${t('Etiquetas', 'Tags')}:</strong> <span id="tags">${c.tags
          .map((tg) => `<span class="tag">${esc(tg)} <a href="#" data-tag="${esc(tg)}" class="rm-tag" style="color:inherit">×</a></span>`)
          .join('')}</span>
          <button class="btn secondary small" id="add-tag">+ ${t('etiqueta', 'tag')}</button></p>
      </div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-title">${t('Oportunidades', 'Opportunities')}</div><div class="card-body">
        ${
          c.opportunities.length
            ? c.opportunities
                .map(
                  (o) => `<div class="timeline-item"><div class="t-icon"></div>
                  <div><strong>${esc(o.title)}</strong> · ${fmtMoney(o.value)} <span class="badge ${o.status === 'won' ? 'green' : o.status === 'lost' ? 'red' : 'indigo'}">${o.status}</span>
                  <div class="t-time">${esc(o.pipeline_name)} → ${esc(o.stage_name)}</div></div></div>`
                )
                .join('')
            : `<span class="muted">${t('Sin oportunidades', 'No opportunities')}</span>`
        }
      </div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-title">${t('Tareas', 'Tasks')}</div><div class="card-body">
        ${(c.tasks || []).length
          ? c.tasks.map((tk) => `<div class="timeline-item"><div class="t-icon">${tk.status === 'done' ? '' : ''}</div>
              <div style="${tk.status === 'done' ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(tk.title)}
              ${tk.due_at ? `<div class="t-time">${t(`vence ${fmtDate(tk.due_at)}`, `due ${fmtDate(tk.due_at)}`)}</div>` : ''}</div></div>`).join('')
          : `<span class="muted">${t('Sin tareas', 'No tasks')}</span>`}
        <div style="margin-top:8px"><a href="#/tasks">${t('Gestionar en Tareas →', 'Manage in Tasks →')}</a></div>
      </div></div>
      <div class="card"><div class="card-title">${t('Notas', 'Notes')}</div><div class="card-body">
        <form id="note-form" class="flex" style="margin-bottom:12px">
          <input class="input" name="body" placeholder="${t('Añadir una nota…', 'Add a note…')}" required>
          <button class="btn">${t('Añadir', 'Add')}</button>
        </form>
        ${c.notes
          .map(
            (n) => `<div class="timeline-item"><div class="t-icon"></div>
            <div>${esc(n.body)}<div class="t-time">${esc(n.user_name || t('Sistema', 'System'))} · ${fmtDate(n.created_at)}</div></div></div>`
          )
          .join('')}
      </div></div>
    </div>
    <div class="card"><div class="card-title">${t('Cronología de actividad', 'Activity Timeline')}</div><div class="card-body">
      ${
        c.activities.length
          ? c.activities
              .map(
                (a) => `<div class="timeline-item"><div class="t-icon">${icon(a.type || 'note', 14)}</div>
                <div>${esc(a.description)}<div class="t-time">${fmtDate(a.created_at)}</div></div></div>`
              )
              .join('')
          : `<span class="muted">${t('Sin actividad todavía', 'No activity yet')}</span>`
      }
    </div></div>
  </div>`;

  view.querySelector('#edit-btn').addEventListener('click', () =>
    contactModal(() => renderContactDetail(view, id), c)
  );
  view.querySelector('#del-btn').addEventListener('click', async () => {
    if (!confirm(t(`¿Eliminar a ${fullName(c)}? Esta acción no se puede deshacer.`, `Delete ${fullName(c)}? This cannot be undone.`))) return;
    await api(`/contacts/${id}`, { method: 'DELETE' });
    toast(t('Contacto eliminado', 'Contact deleted'));
    location.hash = '#/contacts';
  });
  view.querySelector('#msg-btn').addEventListener('click', async () => {
    const conv = await api(`/conversations/start/${id}`, { method: 'POST' });
    location.hash = `#/conversations/${conv.id}`;
  });
  view.querySelector('#send-btn').addEventListener('click', () => {
    if (c.dnd) return toast(t('El contacto tiene DND activado', 'Contact has DND enabled'), true);
    const modal = openModal(`<h2>${t('Enviar mensaje', 'Send message')}</h2>
      <form id="qs-form">
        <label class="field"><span class="label">${t('Canal', 'Channel')}</span><select class="input" name="channel"><option value="sms">SMS</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select></label>
        <label class="field email-only" style="display:none"><span class="label">${t('Asunto', 'Subject')}</span><input class="input" name="subject"></label>
        <label class="field"><span class="label">${t('Mensaje', 'Message')}</span><textarea class="input" name="body" rows="4" required></textarea></label>
        <div class="modal-actions"><button type="button" class="btn secondary" id="c">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Enviar', 'Send')}</button></div>
      </form>`);
    const chan = modal.querySelector('[name=channel]');
    const toggle = () => { modal.querySelector('.email-only').style.display = chan.value === 'email' ? 'block' : 'none'; };
    chan.addEventListener('change', toggle);
    modal.querySelector('#c').addEventListener('click', closeOverlay);
    modal.querySelector('#qs-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(`/contacts/${id}/message`, { method: 'POST', body: formData(e.target) }); closeOverlay(); toast(t('Mensaje enviado', 'Message sent')); renderContactDetail(view, id); }
      catch (err) { toast(err.message, true); }
    });
  });
  view.querySelector('#wf-btn').addEventListener('click', async () => {
    const workflows = await api('/workflows').catch(() => []);
    if (!workflows.length) return toast(t('No hay workflows. Crea uno en Automatizaciones.', 'No workflows. Create one in Automations.'), true);
    const modal = openModal(`<h2>${t('Añadir a workflow', 'Add to workflow')}</h2>
      <form id="qw-form"><label class="field"><span class="label">Workflow</span><select class="input" name="workflow_id">${workflows.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></label>
        <div class="modal-actions"><button type="button" class="btn secondary" id="c">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Añadir', 'Add')}</button></div></form>`);
    modal.querySelector('#c').addEventListener('click', closeOverlay);
    modal.querySelector('#qw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(`/contacts/${id}/workflow`, { method: 'POST', body: { workflow_id: Number(formData(e.target).workflow_id) } }); closeOverlay(); toast(t('Añadido al workflow', 'Added to workflow')); }
      catch (err) { toast(err.message, true); }
    });
  });
  view.querySelector('#add-tag').addEventListener('click', async () => {
    const tag = prompt(t('Nombre de la etiqueta:', 'Tag name:'));
    if (!tag) return;
    await api(`/contacts/${id}/tags`, { method: 'POST', body: { tag } });
    renderContactDetail(view, id);
  });
  view.querySelectorAll('.rm-tag').forEach((a) =>
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      await api(`/contacts/${id}/tags/${encodeURIComponent(a.dataset.tag)}`, { method: 'DELETE' });
      renderContactDetail(view, id);
    })
  );
  view.querySelector('#note-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api(`/contacts/${id}/notes`, { method: 'POST', body: formData(e.target) });
    renderContactDetail(view, id);
  });
}
