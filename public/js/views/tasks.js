import { api } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate, fullName } from '../ui.js';
import { t } from '../i18n.js';

export async function renderTasks(view) {
  let filter = 'open';

  async function load() {
    const tasks = await api(`/tasks?status=${filter}`);
    const now = new Date().toISOString();

    view.innerHTML = `
    <div class="page-header">
      <h1>${t('Tareas', 'Tasks')}</h1>
      <select class="input" id="task-filter" style="width:150px">
        <option value="open" ${filter === 'open' ? 'selected' : ''}>${t('Pendientes', 'Pending')}</option>
        <option value="done" ${filter === 'done' ? 'selected' : ''}>${t('Hechas', 'Done')}</option>
        <option value="all" ${filter === 'all' ? 'selected' : ''}>${t('Todas', 'All')}</option>
      </select>
      <div class="spacer"></div>
      <button class="btn" id="new-task">${t('+ Tarea', '+ Task')}</button>
    </div>
    <div class="card">
      ${
        tasks.length
          ? tasks
              .map((task) => {
                const overdue = task.status === 'open' && task.due_at && task.due_at.slice(0, 19) <= now;
                return `<div class="appt-row">
                  <input type="checkbox" class="toggle-task" data-id="${task.id}" ${task.status === 'done' ? 'checked' : ''}>
                  <div style="flex:1">
                    <strong style="${task.status === 'done' ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(task.title)}</strong>
                    <div class="muted" style="font-size:12px">
                      ${task.contact_id ? `<a href="#/contacts/${task.contact_id}">${esc(fullName(task))}</a> · ` : ''}
                      ${esc(task.user_name || '')}${task.notes ? ` · ${esc(task.notes)}` : ''}
                    </div>
                  </div>
                  ${task.due_at ? `<span class="badge ${overdue ? 'red' : 'gray'}">${overdue ? '' : ''}${fmtDate(task.due_at)}</span>` : ''}
                  <button class="btn ghost small del-task" data-id="${task.id}">✕</button>
                </div>`;
              })
              .join('')
          : `<div class="empty"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>${t('Sin tareas. Créalas a mano o desde automatizaciones (acción "Crear tarea").', 'No tasks. Create them manually or from automations ("Create task" action).')}</div>`
      }
    </div>`;

    view.querySelector('#task-filter').addEventListener('change', (e) => { filter = e.target.value; load(); });
    view.querySelectorAll('.toggle-task').forEach((cb) =>
      cb.addEventListener('change', async () => {
        try {
          await api(`/tasks/${cb.dataset.id}`, { method: 'PUT', body: { status: cb.checked ? 'done' : 'open' } });
          load();
        } catch (err) {
          toast(err.message, true);
        }
      })
    );
    view.querySelectorAll('.del-task').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm(t('¿Eliminar tarea?', 'Delete task?'))) return;
        try {
          await api(`/tasks/${b.dataset.id}`, { method: 'DELETE' });
          load();
        } catch (err) {
          toast(err.message, true);
        }
      })
    );
    view.querySelector('#new-task').addEventListener('click', () => {
      const modal = openModal(`
        <h2>${t('Nueva Tarea', 'New Task')}</h2>
        <form id="task-form">
          <label class="field"><span class="label">${t('Título', 'Title')}</span><input class="input" name="title" required placeholder="${t('Llamar a María', 'Call María')}"></label>
          <label class="field"><span class="label">${t('Notas', 'Notes')}</span><input class="input" name="notes"></label>
          <div class="form-row">
            <label class="field"><span class="label">${t('Vence', 'Due')}</span><input class="input" name="due_at" type="datetime-local"></label>
          </div>
          <label class="field"><span class="label">${t('Contacto (opcional)', 'Contact (optional)')}</span>
            <input class="input" id="t-search" placeholder="${t('buscar…', 'search…')}" autocomplete="off">
            <input type="hidden" name="contact_id"><div id="t-results"></div></label>
          <div class="modal-actions">
            <button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
            <button class="btn">${t('Crear', 'Create')}</button>
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
          toast(t('Tarea creada', 'Task created'));
          load();
        } catch (err) { toast(err.message, true); }
      });
    });
  }

  await load();
}
