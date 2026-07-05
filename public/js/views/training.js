import { api, state } from '../api.js';
import { esc, toast, openModal, closeOverlay, formData } from '../ui.js';

const isAdmin = () => state.user?.role === 'admin';

// Training / onboarding. Everyone consumes the courses their upper tenants
// publish (plus their own); admins can also author courses for the tenants
// below them. Videos are YouTube embeds.
export async function renderTraining(view) {
  const { available, authored } = await api('/training/courses');

  view.innerHTML = `
  <div class="page-header">
    <div><h1>Formación</h1><p class="muted" style="font-size:13px">Aprende a usar la plataforma${authored.length ? ' y crea formaciones para tus clientes' : ''}.</p></div>
    ${isAdmin() ? '<button class="btn" id="course-new">+ Crear curso</button>' : ''}
  </div>

  ${available.length
    ? `<div class="grid-2">${available.map((c) => {
        const pct = c.lesson_count ? Math.round((c.completed_count / c.lesson_count) * 100) : 0;
        return `<div class="card course-card" data-id="${c.id}" style="margin-bottom:16px;cursor:pointer">
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
              <strong>${esc(c.title)}</strong>
              ${c.owned ? '<span class="badge">Tuyo</span>' : `<span class="muted" style="font-size:11px">por ${esc(c.owner_name)}</span>`}
            </div>
            <p class="muted" style="font-size:13px;margin:6px 0 12px">${esc(c.description || '')}</p>
            <div style="height:6px;background:var(--border,#eee);border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:var(--primary)"></div></div>
            <div class="muted" style="font-size:12px;margin-top:6px">${c.completed_count}/${c.lesson_count} lecciones · ${pct}%</div>
          </div>
        </div>`;
      }).join('')}</div>`
    : `<div class="empty card" style="padding:40px">${isAdmin() ? 'Aún no hay cursos. Crea el primero para formar a tus clientes.' : 'Tu agencia todavía no ha publicado formación.'}</div>`}`;

  view.querySelectorAll('.course-card').forEach((el) =>
    el.addEventListener('click', () => openCourse(view, Number(el.dataset.id)))
  );

  view.querySelector('#course-new')?.addEventListener('click', () => {
    const modal = openModal(`
      <h2>Nuevo curso</h2>
      <form id="course-form">
        <label class="field"><span class="label">Título</span><input class="input" name="title" required placeholder="Cómo usar tu plataforma de marketing"></label>
        <label class="field"><span class="label">Descripción</span><input class="input" name="description" placeholder="Onboarding paso a paso"></label>
        <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">Cancelar</button><button class="btn">Crear</button></div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#course-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const c = await api('/training/courses', { method: 'POST', body: formData(e.target) });
        closeOverlay();
        toast('Curso creado');
        openCourse(view, c.id);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

async function openCourse(view, courseId) {
  const course = await api(`/training/courses/${courseId}`);
  const canEdit = isAdmin() && course.owned;
  let current = course.lessons[0] || null;

  const render = () => {
    view.innerHTML = `
    <div class="page-header">
      <div><button class="btn ghost small" id="back">← Formación</button>
        <h1 style="margin-top:6px">${esc(course.title)}</h1></div>
      ${canEdit ? '<button class="btn secondary" id="lesson-new">+ Lección</button>' : ''}
    </div>
    <div class="grid-2" style="align-items:start">
      <div class="card">
        <div class="card-title">Lecciones</div>
        <div class="card-body">
          ${course.lessons.length ? course.lessons.map((l) => `
            <div class="appt-row lesson-row ${current && l.id === current.id ? 'active' : ''}" data-id="${l.id}" style="cursor:pointer;${current && l.id === current.id ? 'background:var(--hover,#f5f5ff)' : ''}">
              <span style="width:18px">${l.completed ? '✅' : '⚪'}</span>
              <div style="flex:1">${esc(l.title)}</div>
              ${canEdit ? `<button class="btn ghost small lesson-edit" data-id="${l.id}">✎</button><button class="btn ghost small lesson-del" data-id="${l.id}">✕</button>` : ''}
            </div>`).join('') : '<p class="muted">Sin lecciones todavía.</p>'}
        </div>
      </div>
      <div class="card">
        <div class="card-body" id="lesson-pane">
          ${current ? lessonPane(current) : '<p class="muted">Selecciona o crea una lección.</p>'}
        </div>
      </div>
    </div>`;

    view.querySelector('#back').addEventListener('click', () => renderTraining(view));
    view.querySelectorAll('.lesson-row').forEach((r) =>
      r.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        current = course.lessons.find((l) => l.id === Number(r.dataset.id));
        render();
      })
    );
    const done = view.querySelector('#toggle-done');
    if (done)
      done.addEventListener('click', async () => {
        const method = current.completed ? 'DELETE' : 'POST';
        await api(`/training/lessons/${current.id}/complete`, { method });
        current.completed = !current.completed;
        const idx = course.lessons.findIndex((l) => l.id === current.id);
        if (idx >= 0) course.lessons[idx].completed = current.completed;
        render();
      });

    if (canEdit) {
      view.querySelector('#lesson-new')?.addEventListener('click', () => lessonModal(view, course, null));
      view.querySelectorAll('.lesson-edit').forEach((b) =>
        b.addEventListener('click', () => lessonModal(view, course, course.lessons.find((l) => l.id === Number(b.dataset.id))))
      );
      view.querySelectorAll('.lesson-del').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('¿Eliminar esta lección?')) return;
          await api(`/training/lessons/${b.dataset.id}`, { method: 'DELETE' });
          toast('Lección eliminada');
          openCourse(view, courseId);
        })
      );
    }
  };
  render();
}

function lessonPane(l) {
  return `
    ${l.youtube_id ? `<div style="position:relative;padding-bottom:56.25%;height:0;margin-bottom:14px;border-radius:8px;overflow:hidden">
      <iframe src="https://www.youtube.com/embed/${esc(l.youtube_id)}" title="${esc(l.title)}" frameborder="0" allowfullscreen
        style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe></div>` : ''}
    <h2 style="margin-bottom:8px">${esc(l.title)}</h2>
    <div style="white-space:pre-wrap;line-height:1.6">${esc(l.body || '')}</div>
    <button class="btn ${l.completed ? 'secondary' : ''}" id="toggle-done" style="margin-top:16px">${l.completed ? '✓ Completada — desmarcar' : 'Marcar como completada'}</button>`;
}

function lessonModal(view, course, lesson) {
  const modal = openModal(`
    <h2>${lesson ? 'Editar' : 'Nueva'} lección</h2>
    <form id="lesson-form">
      <label class="field"><span class="label">Título</span><input class="input" name="title" required value="${lesson ? esc(lesson.title) : ''}" placeholder="Bienvenida y primeros pasos"></label>
      <label class="field"><span class="label">Vídeo de YouTube (URL o ID)</span><input class="input" name="youtube_url" value="${lesson ? esc(lesson.youtube_id) : ''}" placeholder="https://youtu.be/…"></label>
      <label class="field"><span class="label">Contenido / notas</span><textarea class="input" name="body" rows="6" placeholder="Explica el paso…">${lesson ? esc(lesson.body || '') : ''}</textarea></label>
      <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">Cancelar</button><button class="btn">Guardar</button></div>
    </form>`);
  modal.querySelector('#cancel').addEventListener('click', closeOverlay);
  modal.querySelector('#lesson-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (lesson) await api(`/training/lessons/${lesson.id}`, { method: 'PUT', body: formData(e.target) });
      else await api(`/training/courses/${course.id}/lessons`, { method: 'POST', body: formData(e.target) });
      closeOverlay();
      toast('Lección guardada');
      openCourse(view, course.id);
    } catch (err) {
      toast(err.message, true);
    }
  });
}
