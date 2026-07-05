import { api, state } from '../api.js';
import { esc, toast, openModal, closeOverlay, formData } from '../ui.js';
import { t } from '../i18n.js';

const isAdmin = () => state.user?.role === 'admin';

// Training / onboarding. Everyone consumes the courses their upper tenants
// publish (plus their own); admins can also author courses for the tenants
// below them. Videos are YouTube embeds.
export async function renderTraining(view) {
  const { available, authored } = await api('/training/courses');

  view.innerHTML = `
  <div class="page-header">
    <div><h1>${t('Formación', 'Training')}</h1><p class="muted" style="font-size:13px">${t('Aprende a usar la plataforma', 'Learn how to use the platform')}${authored.length ? t(' y crea formaciones para tus clientes', ' and create training for your clients') : ''}.</p></div>
    ${isAdmin() ? `<button class="btn" id="course-new">${t('+ Crear curso', '+ Create course')}</button>` : ''}
  </div>

  ${available.length
    ? `<div class="grid-2">${available.map((c) => {
        const pct = c.lesson_count ? Math.round((c.completed_count / c.lesson_count) * 100) : 0;
        return `<div class="card course-card" data-id="${c.id}" style="margin-bottom:16px;cursor:pointer">
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
              <strong>${esc(c.title)}</strong>
              ${c.owned ? `<span class="badge">${t('Tuyo', 'Yours')}</span>` : `<span class="muted" style="font-size:11px">${t('por', 'by')} ${esc(c.owner_name)}</span>`}
            </div>
            <p class="muted" style="font-size:13px;margin:6px 0 12px">${esc(c.description || '')}</p>
            <div style="height:6px;background:var(--border,#eee);border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:var(--primary)"></div></div>
            <div class="muted" style="font-size:12px;margin-top:6px">${c.completed_count}/${c.lesson_count} ${t('lecciones', 'lessons')} · ${pct}%</div>
          </div>
        </div>`;
      }).join('')}</div>`
    : `<div class="empty card" style="padding:40px">${isAdmin() ? t('Aún no hay cursos. Crea el primero para formar a tus clientes.', 'No courses yet. Create the first one to train your clients.') : t('Tu agencia todavía no ha publicado formación.', 'Your agency has not published any training yet.')}</div>`}`;

  view.querySelectorAll('.course-card').forEach((el) =>
    el.addEventListener('click', () => openCourse(view, Number(el.dataset.id)))
  );

  view.querySelector('#course-new')?.addEventListener('click', () => {
    const modal = openModal(`
      <h2>${t('Nuevo curso', 'New course')}</h2>
      <form id="course-form">
        <label class="field"><span class="label">${t('Título', 'Title')}</span><input class="input" name="title" required placeholder="${t('Cómo usar tu plataforma de marketing', 'How to use your marketing platform')}"></label>
        <label class="field"><span class="label">${t('Descripción', 'Description')}</span><input class="input" name="description" placeholder="${t('Onboarding paso a paso', 'Step-by-step onboarding')}"></label>
        <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Crear', 'Create')}</button></div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#course-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const c = await api('/training/courses', { method: 'POST', body: formData(e.target) });
        closeOverlay();
        toast(t('Curso creado', 'Course created'));
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
      <div><button class="btn ghost small" id="back">${t('← Formación', '← Training')}</button>
        <h1 style="margin-top:6px">${esc(course.title)}</h1></div>
      ${canEdit ? `<div class="flex" style="gap:6px">
        ${course.is_public
          ? `<a class="btn ghost small" href="/course/${esc(course.public_token)}" target="_blank">${t('Ver público', 'View public')} ↗</a>
             <button class="btn ghost small" id="copy-course">${t('Copiar enlace', 'Copy link')}</button>
             <button class="btn secondary small" id="unpublish-course">${t('Despublicar', 'Unpublish')}</button>`
          : `<button class="btn secondary small" id="publish-course" title="${t('Publica este curso como academia para tus clientes finales', 'Publish this course as an academy for your end-customers')}">${t('Publicar para clientes', 'Publish for clients')}</button>`}
        <button class="btn secondary" id="lesson-new">${t('+ Lección', '+ Lesson')}</button>
      </div>` : ''}
    </div>
    <div class="grid-2" style="align-items:start">
      <div class="card">
        <div class="card-title">${t('Lecciones', 'Lessons')}</div>
        <div class="card-body">
          ${course.lessons.length ? course.lessons.map((l) => `
            <div class="appt-row lesson-row ${current && l.id === current.id ? 'active' : ''}" data-id="${l.id}" style="cursor:pointer;${current && l.id === current.id ? 'background:var(--hover,#f5f5ff)' : ''}">
              <span style="width:18px">${l.completed ? '✅' : '⚪'}</span>
              <div style="flex:1">${esc(l.title)}</div>
              ${canEdit ? `<button class="btn ghost small lesson-edit" data-id="${l.id}">✎</button><button class="btn ghost small lesson-del" data-id="${l.id}">✕</button>` : ''}
            </div>`).join('') : `<p class="muted">${t('Sin lecciones todavía.', 'No lessons yet.')}</p>`}
        </div>
      </div>
      <div class="card">
        <div class="card-body" id="lesson-pane">
          ${current ? lessonPane(current) : `<p class="muted">${t('Selecciona o crea una lección.', 'Select or create a lesson.')}</p>`}
        </div>
      </div>
    </div>`;

    view.querySelector('#back').addEventListener('click', () => renderTraining(view));
    view.querySelector('#publish-course')?.addEventListener('click', async () => {
      const r = await api(`/training/courses/${course.id}/publish`, { method: 'POST' });
      course.is_public = 1;
      course.public_token = r.public_token;
      toast(t('Curso publicado', 'Course published'));
      render();
    });
    view.querySelector('#unpublish-course')?.addEventListener('click', async () => {
      await api(`/training/courses/${course.id}/unpublish`, { method: 'POST' });
      course.is_public = 0;
      toast(t('Curso despublicado', 'Course unpublished'));
      render();
    });
    view.querySelector('#copy-course')?.addEventListener('click', () => {
      navigator.clipboard.writeText(`${location.origin}/course/${course.public_token}`).then(
        () => toast(t('Enlace copiado', 'Link copied')),
        () => toast(`${location.origin}/course/${course.public_token}`)
      );
    });
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
          if (!confirm(t('¿Eliminar esta lección?', 'Delete this lesson?'))) return;
          await api(`/training/lessons/${b.dataset.id}`, { method: 'DELETE' });
          toast(t('Lección eliminada', 'Lesson deleted'));
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
    <button class="btn ${l.completed ? 'secondary' : ''}" id="toggle-done" style="margin-top:16px">${l.completed ? t('✓ Completada — desmarcar', '✓ Completed — undo') : t('Marcar como completada', 'Mark as completed')}</button>`;
}

function lessonModal(view, course, lesson) {
  const modal = openModal(`
    <h2>${lesson ? t('Editar lección', 'Edit lesson') : t('Nueva lección', 'New lesson')}</h2>
    <form id="lesson-form">
      <label class="field"><span class="label">${t('Título', 'Title')}</span><input class="input" name="title" required value="${lesson ? esc(lesson.title) : ''}" placeholder="${t('Bienvenida y primeros pasos', 'Welcome and getting started')}"></label>
      <label class="field"><span class="label">${t('Módulo / sección (opcional)', 'Module / section (optional)')}</span><input class="input" name="section" value="${lesson ? esc(lesson.section || '') : ''}" placeholder="${t('Introducción', 'Introduction')}"></label>
      <label class="field"><span class="label">${t('Vídeo de YouTube (URL o ID)', 'YouTube video (URL or ID)')}</span><input class="input" name="youtube_url" value="${lesson ? esc(lesson.youtube_id) : ''}" placeholder="https://youtu.be/…"></label>
      <label class="field"><span class="label">${t('Contenido / notas', 'Content / notes')}</span><textarea class="input" name="body" rows="6" placeholder="${t('Explica el paso…', 'Explain the step…')}">${lesson ? esc(lesson.body || '') : ''}</textarea></label>
      <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Guardar', 'Save')}</button></div>
    </form>`);
  modal.querySelector('#cancel').addEventListener('click', closeOverlay);
  modal.querySelector('#lesson-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (lesson) await api(`/training/lessons/${lesson.id}`, { method: 'PUT', body: formData(e.target) });
      else await api(`/training/courses/${course.id}/lessons`, { method: 'POST', body: formData(e.target) });
      closeOverlay();
      toast(t('Lección guardada', 'Lesson saved'));
      openCourse(view, course.id);
    } catch (err) {
      toast(err.message, true);
    }
  });
}
