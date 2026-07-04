import { api } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate, fmtMoney, fullName, initials, icon } from '../ui.js';

const ICONS = { contact: 'contact', tag: 'tag', note: 'note', appointment: 'appointment', form: 'form', automation: 'automation', opportunity: 'opportunity' };

export async function renderContacts(view, rest = []) {
  if (rest[0]) return renderContactDetail(view, rest[0]);

  let q = '';
  let tag = '';

  async function load() {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    const [contacts, tags, smartLists] = await Promise.all([
      api(`/contacts?${params}`),
      api('/contacts/meta/tags'),
      api('/contacts/meta/smart-lists'),
    ]);

    view.innerHTML = `
    <div class="page-header">
      <h1>Contacts</h1><span class="badge gray">${contacts.length}</span>
      <div class="spacer"></div>
      <input class="input" id="search" placeholder="Search name, email, phone…" style="width:240px" value="${esc(q)}">
      <select class="input" id="tag-filter" style="width:160px">
        <option value="">All tags</option>
        ${tags.map((t) => `<option value="${esc(t.tag)}" ${t.tag === tag ? 'selected' : ''}>${esc(t.tag)} (${t.count})</option>`).join('')}
      </select>
      <button class="btn secondary" id="export-csv" title="Exportar CSV">CSV</button>
      <button class="btn secondary" id="import-csv" title="Importar CSV">CSV</button>
      <input type="file" id="csv-file" accept=".csv,text/csv" style="display:none">
      <button class="btn secondary" id="find-dupes" title="Buscar duplicados">²</button>
      <button class="btn" id="add-contact">+ Add Contact</button>
    </div>
    <div class="flex" style="margin-bottom:12px;flex-wrap:wrap">
      ${smartLists
        .map(
          (l) => `<span class="tag" style="cursor:pointer;padding:5px 12px" data-sl='${esc(JSON.stringify(l.filters))}'>${esc(l.name)}
            <a href="#" class="sl-del" data-id="${l.id}" style="color:inherit;margin-left:4px">×</a></span>`
        )
        .join('')}
      ${(q || tag) ? `<button class="btn secondary small" id="save-sl">Guardar filtro como lista</button>` : ''}
    </div>
    <div class="card">
      ${
        contacts.length
          ? `<table class="table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Tags</th><th>Source</th><th>Created</th></tr></thead>
          <tbody>${contacts
            .map(
              (c) => `<tr data-id="${c.id}">
                <td><div class="flex" style="gap:9px"><span class="avatar soft">${initials(c)}</span><strong>${esc(fullName(c))}</strong></div></td>
                <td>${esc(c.email)}</td><td>${esc(c.phone)}</td>
                <td>${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</td>
                <td><span class="badge gray">${esc(c.source)}</span></td>
                <td class="muted">${fmtDate(c.created_at)}</td></tr>`
            )
            .join('')}</tbody></table>`
          : `<div class="empty"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>No contacts yet. Add one or capture leads with a funnel.</div>`
      }
    </div>`;

    view.querySelectorAll('tbody tr').forEach((tr) =>
      tr.addEventListener('click', () => (location.hash = `#/contacts/${tr.dataset.id}`))
    );
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
        q = f.q || '';
        tag = f.tag || '';
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
      const name = prompt('Nombre de la lista:', tag || q);
      if (!name) return;
      await api('/contacts/meta/smart-lists', { method: 'POST', body: { name, filters: { q, tag } } });
      toast('Lista guardada');
      load();
    });
    view.querySelector('#find-dupes').addEventListener('click', async () => {
      const groups = await api('/contacts/meta/duplicates');
      const modal = openModal(`
        <h2>Contactos duplicados</h2>
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
                          ${ci > 0 ? `<button class="btn secondary small right merge-btn" data-keep="${g.contacts[0].id}" data-merge="${c.id}">Fusionar en #${g.contacts[0].id}</button>` : '<span class="badge green right">se conserva</span>'}
                        </div>`
                      )
                      .join('')}
                  </div>`
                )
                .join('')
            : '<div class="empty">No hay duplicados por email ni teléfono.</div>'
        }`);
      modal.querySelectorAll('.merge-btn').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('¿Fusionar? Se moverán mensajes, citas, notas y tags al contacto conservado.')) return;
          try {
            await api('/contacts/merge', { method: 'POST', body: { keep_id: Number(b.dataset.keep), merge_id: Number(b.dataset.merge) } });
            toast('Contactos fusionados');
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
        toast(`Importados: ${result.imported} · Omitidos (duplicados): ${result.skipped}`);
        load();
      } catch (err) {
        toast(err.message, true);
      }
      e.target.value = '';
    });
  }

  await load();
}

async function contactModal(onSaved, contact = null) {
  const [customFields, team] = await Promise.all([
    api('/custom-fields'),
    api('/locations/team/users'),
  ]);
  const cfValues = contact?.custom_fields || {};
  const modal = openModal(`
    <h2>${contact ? 'Edit' : 'New'} Contact</h2>
    <form id="contact-form">
      <div class="form-row">
        <label class="field"><span class="label">First name</span><input class="input" name="first_name" value="${esc(contact?.first_name || '')}"></label>
        <label class="field"><span class="label">Last name</span><input class="input" name="last_name" value="${esc(contact?.last_name || '')}"></label>
      </div>
      <label class="field"><span class="label">Email</span><input class="input" name="email" type="email" value="${esc(contact?.email || '')}"></label>
      <label class="field"><span class="label">Phone</span><input class="input" name="phone" value="${esc(contact?.phone || '')}"></label>
      ${contact ? '' : `<label class="field"><span class="label">Tags (comma separated)</span><input class="input" name="tags_raw" placeholder="lead, vip"></label>`}
      <label class="field"><span class="label">Responsable (owner)</span><select class="input" name="owner_user_id">
        <option value="">— sin asignar —</option>
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
        <button type="button" class="btn secondary" id="cancel">Cancel</button>
        <button class="btn">${contact ? 'Save' : 'Create Contact'}</button>
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
      toast(contact ? 'Contact updated' : 'Contact created');
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
    <a href="#/contacts" class="btn secondary small">← Contacts</a>
    <span class="avatar" style="width:40px;height:40px">${initials(c)}</span>
    <h1>${esc(fullName(c))}</h1>
    ${c.score >= 20 ? `<span class="badge amber">${c.score} pts</span>` : c.score > 0 ? `<span class="badge gray">${c.score} pts</span>` : ''}
    ${c.dnd ? '<span class="badge red">DND</span>' : ''}
    <div class="spacer"></div>
    <button class="btn secondary" id="msg-btn">Message</button>
    <button class="btn secondary" id="edit-btn">Edit</button>
    <button class="btn danger" id="del-btn">Delete</button>
  </div>
  <div class="grid-2">
    <div>
      <div class="card" style="margin-bottom:16px"><div class="card-title">Details</div><div class="card-body">
        <p><strong>Email:</strong> ${esc(c.email) || '<span class="muted">—</span>'}</p>
        <p><strong>Phone:</strong> ${esc(c.phone) || '<span class="muted">—</span>'}</p>
        <p><strong>Source:</strong> <span class="badge gray">${esc(c.source)}</span></p>
        ${c.owner_name ? `<p><strong>Responsable:</strong> ${esc(c.owner_name)}</p>` : ''}
        ${Object.entries(c.custom_fields || {}).filter(([, v]) => v !== '' && v != null)
          .map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(v)}</p>`).join('')}
        <p style="margin-top:8px"><strong>Tags:</strong> <span id="tags">${c.tags
          .map((t) => `<span class="tag">${esc(t)} <a href="#" data-tag="${esc(t)}" class="rm-tag" style="color:inherit">×</a></span>`)
          .join('')}</span>
          <button class="btn secondary small" id="add-tag">+ tag</button></p>
      </div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-title">Opportunities</div><div class="card-body">
        ${
          c.opportunities.length
            ? c.opportunities
                .map(
                  (o) => `<div class="timeline-item"><div class="t-icon"></div>
                  <div><strong>${esc(o.title)}</strong> · ${fmtMoney(o.value)} <span class="badge ${o.status === 'won' ? 'green' : o.status === 'lost' ? 'red' : 'indigo'}">${o.status}</span>
                  <div class="t-time">${esc(o.pipeline_name)} → ${esc(o.stage_name)}</div></div></div>`
                )
                .join('')
            : '<span class="muted">No opportunities</span>'
        }
      </div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-title">Tareas</div><div class="card-body">
        ${(c.tasks || []).length
          ? c.tasks.map((t) => `<div class="timeline-item"><div class="t-icon">${t.status === 'done' ? '' : ''}</div>
              <div style="${t.status === 'done' ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(t.title)}
              ${t.due_at ? `<div class="t-time">vence ${fmtDate(t.due_at)}</div>` : ''}</div></div>`).join('')
          : '<span class="muted">Sin tareas</span>'}
        <div style="margin-top:8px"><a href="#/tasks">Gestionar en Tareas →</a></div>
      </div></div>
      <div class="card"><div class="card-title">Notes</div><div class="card-body">
        <form id="note-form" class="flex" style="margin-bottom:12px">
          <input class="input" name="body" placeholder="Add a note…" required>
          <button class="btn">Add</button>
        </form>
        ${c.notes
          .map(
            (n) => `<div class="timeline-item"><div class="t-icon"></div>
            <div>${esc(n.body)}<div class="t-time">${esc(n.user_name || 'System')} · ${fmtDate(n.created_at)}</div></div></div>`
          )
          .join('')}
      </div></div>
    </div>
    <div class="card"><div class="card-title">Activity Timeline</div><div class="card-body">
      ${
        c.activities.length
          ? c.activities
              .map(
                (a) => `<div class="timeline-item"><div class="t-icon">${icon(ICONS[a.type] || 'note', 14)}</div>
                <div>${esc(a.description)}<div class="t-time">${fmtDate(a.created_at)}</div></div></div>`
              )
              .join('')
          : '<span class="muted">No activity yet</span>'
      }
    </div></div>
  </div>`;

  view.querySelector('#edit-btn').addEventListener('click', () =>
    contactModal(() => renderContactDetail(view, id), c)
  );
  view.querySelector('#del-btn').addEventListener('click', async () => {
    if (!confirm(`Delete ${fullName(c)}? This cannot be undone.`)) return;
    await api(`/contacts/${id}`, { method: 'DELETE' });
    toast('Contact deleted');
    location.hash = '#/contacts';
  });
  view.querySelector('#msg-btn').addEventListener('click', async () => {
    const conv = await api(`/conversations/start/${id}`, { method: 'POST' });
    location.hash = `#/conversations/${conv.id}`;
  });
  view.querySelector('#add-tag').addEventListener('click', async () => {
    const tag = prompt('Tag name:');
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
