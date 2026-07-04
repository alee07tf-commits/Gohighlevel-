import { api } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate, fullName } from '../ui.js';

export async function renderTasks(view) {
  let filter = 'open';

  async function load() {
    const tasks = await api(`/tasks?status=${filter}`);
    const now = new Date().toISOString();

    view.innerHTML = `
    <div class="page-header">
      <h1>Tareas</h1>
      <select class="input" id="task-filter" style="width:150px">
        <option value="open" ${filter === 'open' ? 'selected' : ''}>Pendientes</option>
        <option value="done" ${filter === 'done' ? 'selected' : ''}>Hechas</option>
        <option value="all" ${filter === 'all' ? 'selected' : ''}>Todas</option>
      </select>
      <div class="spacer"></div>
      <button class="btn" id="new-task">+ Tarea</button>
    </div>
    <div class="card">
      ${
        tasks.length
          ? tasks
              .map((t) => {
                const overdue = t.status === 'open' && t.due_at && t.due_at.slice(0, 19) <= now;
                return `<div class="appt-row">
                  <input type="checkbox" class="toggle-task" data-id="${t.id}" ${t.status === 'done' ? 'checked' : ''}>
                  <div style="flex:1">
                    <strong style="${t.status === 'done' ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(t.title)}</strong>
                    <div class="muted" style="font-size:12px">
                      ${t.contact_id ? `<a href="#/contacts/${t.contact_id}">${esc(fullName(t))}</a> · ` : ''}
                      ${esc(t.user_name || '')}${t.notes ? ` · ${esc(t.notes)}` : ''}
                    </div>
                  </div>
                  ${t.due_at ? `<span class="badge ${overdue ? 'red' : 'gray'}">${overdue ? '' : ''}${fmtDate(t.due_at)}</span>` : ''}
                  <button class="btn ghost small del-task" data-id="${t.id}">✕</button>
                </div>`;
              })
              .join('')
          : '<div class="empty"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>Sin tareas. Créalas a mano o desde automatizaciones (acción "Crear tarea").</div>'
      }
    </div>`;

    view.querySelector('#task-filter').addEventListener('change', (e) => { filter = e.target.value; load(); });
    view.querySelectorAll('.toggle-task').forEach((cb) =>
      cb.addEventListener('change', async () => {
        await api(`/tasks/${cb.dataset.id}`, { method: 'PUT', body: { status: cb.checked ? 'done' : 'open' } });
        load();
      })
    );
    view.querySelectorAll('.del-task').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('¿Eliminar tarea?')) return;
        await api(`/tasks/${b.dataset.id}`, { method: 'DELETE' });
        load();
      })
    );
    view.querySelector('#new-task').addEventListener('click', () => {
      const modal = openModal(`
        <h2>Nueva Tarea</h2>
        <form id="task-form">
          <label class="field"><span class="label">Título</span><input class="input" name="title" required placeholder="Llamar a María"></label>
          <label class="field"><span class="label">Notas</span><input class="input" name="notes"></label>
          <div class="form-row">
            <label class="field"><span class="label">Vence</span><input class="input" name="due_at" type="datetime-local"></label>
          </div>
          <label class="field"><span class="label">Contacto (opcional)</span>
            <input class="input" id="t-search" placeholder="buscar…" autocomplete="off">
            <input type="hidden" name="contact_id"><div id="t-results"></div></label>
          <div class="modal-actions">
            <button type="button" class="btn secondary" id="cancel">Cancelar</button>
            <button class="btn">Crear</button>
          </div>
        </form>`);
      let timer;
      modal.querySelector('#t-search').addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const results = await api(`/contacts?q=${encodeURIComponent(e.target.value)}&limit=5`);
          const div = modal.querySelector('#t-results');
          div.innerHTML = results.map((c) => `<a href="#" data-id="${c.id}" class="tag">${esc(fullName(c))}</a>`).join(' ');
          div.querySelectorAll('a').forEach((a) =>
            a.addEventListener('click', (ev) => {
              ev.preventDefault();
              modal.querySelector('[name=contact_id]').value = a.dataset.id;
              modal.querySelector('#t-search').value = a.textContent;
              div.innerHTML = '';
            })
          );
        }, 250);
      });
      modal.querySelector('#cancel').addEventListener('click', closeOverlay);
      modal.querySelector('#task-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = formData(e.target);
        data.contact_id = Number(data.contact_id) || null;
        data.due_at = data.due_at ? data.due_at + ':00' : null;
        try {
          await api('/tasks', { method: 'POST', body: data });
          closeOverlay();
          toast('Tarea creada');
          load();
        } catch (err) { toast(err.message, true); }
      });
    });
  }

  await load();
}
