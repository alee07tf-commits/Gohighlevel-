import { api } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate, fmtMoney, fullName, initials } from '../ui.js';

const ICONS = { contact: '👤', tag: '🏷️', note: '📝', appointment: '📅', form: '📩', automation: '⚙️', opportunity: '🎯' };

export async function renderContacts(view, rest = []) {
  if (rest[0]) return renderContactDetail(view, rest[0]);

  let q = '';
  let tag = '';

  async function load() {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    const [contacts, tags] = await Promise.all([
      api(`/contacts?${params}`),
      api('/contacts/meta/tags'),
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
      <button class="btn secondary" id="export-csv" title="Exportar CSV">⬇ CSV</button>
      <button class="btn secondary" id="import-csv" title="Importar CSV">⬆ CSV</button>
      <input type="file" id="csv-file" accept=".csv,text/csv" style="display:none">
      <button class="btn" id="add-contact">+ Add Contact</button>
    </div>
    <div class="card">
      ${
        contacts.length
          ? `<table class="table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Tags</th><th>Source</th><th>Created</th></tr></thead>
          <tbody>${contacts
            .map(
              (c) => `<tr data-id="${c.id}">
                <td><strong>${esc(fullName(c))}</strong></td>
                <td>${esc(c.email)}</td><td>${esc(c.phone)}</td>
                <td>${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</td>
                <td><span class="badge gray">${esc(c.source)}</span></td>
                <td class="muted">${fmtDate(c.created_at)}</td></tr>`
            )
            .join('')}</tbody></table>`
          : `<div class="empty"><div class="big">👥</div>No contacts yet. Add one or capture leads with a funnel.</div>`
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

function contactModal(onSaved, contact = null) {
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
    ${c.score >= 20 ? `<span class="badge amber">🔥 ${c.score} pts</span>` : c.score > 0 ? `<span class="badge gray">${c.score} pts</span>` : ''}
    ${c.dnd ? '<span class="badge red">DND</span>' : ''}
    <div class="spacer"></div>
    <button class="btn secondary" id="msg-btn">💬 Message</button>
    <button class="btn secondary" id="edit-btn">Edit</button>
    <button class="btn danger" id="del-btn">Delete</button>
  </div>
  <div class="grid-2">
    <div>
      <div class="card" style="margin-bottom:16px"><div class="card-title">Details</div><div class="card-body">
        <p><strong>Email:</strong> ${esc(c.email) || '<span class="muted">—</span>'}</p>
        <p><strong>Phone:</strong> ${esc(c.phone) || '<span class="muted">—</span>'}</p>
        <p><strong>Source:</strong> <span class="badge gray">${esc(c.source)}</span></p>
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
                  (o) => `<div class="timeline-item"><div class="t-icon">🎯</div>
                  <div><strong>${esc(o.title)}</strong> · ${fmtMoney(o.value)} <span class="badge ${o.status === 'won' ? 'green' : o.status === 'lost' ? 'red' : 'indigo'}">${o.status}</span>
                  <div class="t-time">${esc(o.pipeline_name)} → ${esc(o.stage_name)}</div></div></div>`
                )
                .join('')
            : '<span class="muted">No opportunities</span>'
        }
      </div></div>
      <div class="card"><div class="card-title">Notes</div><div class="card-body">
        <form id="note-form" class="flex" style="margin-bottom:12px">
          <input class="input" name="body" placeholder="Add a note…" required>
          <button class="btn">Add</button>
        </form>
        ${c.notes
          .map(
            (n) => `<div class="timeline-item"><div class="t-icon">📝</div>
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
                (a) => `<div class="timeline-item"><div class="t-icon">${ICONS[a.type] || '•'}</div>
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
