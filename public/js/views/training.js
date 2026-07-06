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
      ${course.all_completed && course.certificate ? `<button class="btn" id="get-cert" style="margin-left:8px">🎓 ${t('Descargar certificado', 'Get certificate')}</button>` : ''}
      ${canEdit ? `<div class="flex" style="gap:6px">
        ${course.is_public
          ? `<a class="btn ghost small" href="/course/${esc(course.public_token)}" target="_blank">${t('Ver público', 'View public')} ↗</a>
             <button class="btn ghost small" id="copy-course">${t('Copiar enlace', 'Copy link')}</button>
             <button class="btn secondary small" id="unpublish-course">${t('Despublicar', 'Unpublish')}</button>`
          : `<button class="btn secondary small" id="publish-course" title="${t('Publica este curso como academia para tus clientes finales', 'Publish this course as an academy for your end-customers')}">${t('Publicar para clientes', 'Publish for clients')}</button>`}
        <button class="btn ghost small" id="toggle-cert" title="${t('Emitir certificado al completar el curso', 'Issue a certificate on course completion')}">${course.certificate ? '🎓 ' + t('Certificado: ON', 'Certificate: ON') : t('🎓 Certificado: OFF', '🎓 Certificate: OFF')}</button>
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
        openCourse(view, courseId);
      });
    const quizBtn = view.querySelector('#quiz-submit');
    if (quizBtn)
      quizBtn.addEventListener('click', async () => {
        const answers = current.quiz.questions.map((q, i) => {
          const sel = view.querySelector(`input[name="q${i}"]:checked`);
          return sel ? Number(sel.value) : -1;
        });
        try {
          const r = await api(`/training/lessons/${current.id}/quiz`, { method: 'POST', body: { answers } });
          const box = view.querySelector('#quiz-result');
          if (r.passed) { toast(t(`¡Aprobado! ${r.score}%`, `Passed! ${r.score}%`)); openCourse(view, courseId); }
          else box.innerHTML = `<div class="empty" style="padding:10px;color:var(--danger)">${t(`${r.score}% — no alcanzaste el ${r.pass_score}%. Inténtalo de nuevo.`, `${r.score}% — below ${r.pass_score}%. Try again.`)}</div>`;
        } catch (err) { toast(err.message, true); }
      });
    view.querySelector('#get-cert')?.addEventListener('click', async () => {
      const res = await fetch(`/api/training/courses/${courseId}/certificate`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('lf_token')}` },
      });
      if (!res.ok) return toast(t('Completa todas las lecciones primero', 'Complete all lessons first'), true);
      const w = window.open('', '_blank');
      if (w) { w.document.write(await res.text()); w.document.close(); }
    });

    if (canEdit) {
      view.querySelector('#toggle-cert')?.addEventListener('click', async () => {
        await api(`/training/courses/${courseId}`, { method: 'PUT', body: { certificate: !course.certificate } });
        openCourse(view, courseId);
      });
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
  if (l.locked) {
    const when = l.unlock_at ? new Date(l.unlock_at).toLocaleDateString('es-ES') : '';
    return `<h2 style="margin-bottom:8px">🔒 ${esc(l.title)}</h2>
      <div class="empty" style="padding:30px">${t('Esta lección se desbloquea el', 'This lesson unlocks on')} <strong>${when}</strong> ${t('(contenido programado / drip).', '(drip-scheduled content).')}</div>`;
  }
  const quizHtml = (l.has_quiz && !l.completed) ? `
    <div class="card" style="margin-top:16px;padding:14px" id="quiz-box">
      <strong>${t('Cuestionario', 'Quiz')}</strong>
      <p class="muted" style="font-size:12px">${t('Apruébalo para completar la lección', 'Pass it to complete the lesson')} (${l.quiz.pass_score || 0}%)</p>
      ${l.quiz.questions.map((q, i) => `<div style="margin-top:10px"><div style="font-weight:600;font-size:14px">${i + 1}. ${esc(q.q)}</div>
        ${(q.options || []).map((o, j) => `<label class="flex" style="gap:6px;font-weight:400;margin:4px 0"><input type="radio" name="q${i}" value="${j}"> ${esc(o)}</label>`).join('')}</div>`).join('')}
      <button class="btn" id="quiz-submit" style="margin-top:12px">${t('Enviar respuestas', 'Submit answers')}</button>
      <div id="quiz-result" style="margin-top:10px"></div>
    </div>` : '';
  return `
    ${l.youtube_id ? `<div style="position:relative;padding-bottom:56.25%;height:0;margin-bottom:14px;border-radius:8px;overflow:hidden">
      <iframe src="https://www.youtube.com/embed/${esc(l.youtube_id)}" title="${esc(l.title)}" frameborder="0" allowfullscreen
        style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe></div>` : ''}
    <h2 style="margin-bottom:8px">${esc(l.title)}</h2>
    <div style="white-space:pre-wrap;line-height:1.6">${esc(l.body || '')}</div>
    ${quizHtml}
    ${!l.has_quiz || l.completed ? `<button class="btn ${l.completed ? 'secondary' : ''}" id="toggle-done" style="margin-top:16px">${l.completed ? t('✓ Completada — desmarcar', '✓ Completed — undo') : t('Marcar como completada', 'Mark as completed')}</button>` : ''}`;
}

function lessonModal(view, course, lesson) {
  let quiz = (lesson && lesson.quiz && lesson.quiz.questions) ? structuredClone(lesson.quiz) : { pass_score: 70, questions: [] };
  const modal = openModal(`
    <h2>${lesson ? t('Editar lección', 'Edit lesson') : t('Nueva lección', 'New lesson')}</h2>
    <form id="lesson-form">
      <label class="field"><span class="label">${t('Título', 'Title')}</span><input class="input" name="title" required value="${lesson ? esc(lesson.title) : ''}" placeholder="${t('Bienvenida y primeros pasos', 'Welcome and getting started')}"></label>
      <label class="field"><span class="label">${t('Módulo / sección (opcional)', 'Module / section (optional)')}</span><input class="input" name="section" value="${lesson ? esc(lesson.section || '') : ''}" placeholder="${t('Introducción', 'Introduction')}"></label>
      <label class="field"><span class="label">${t('Vídeo de YouTube (URL o ID)', 'YouTube video (URL or ID)')}</span><input class="input" name="youtube_url" value="${lesson ? esc(lesson.youtube_id) : ''}" placeholder="https://youtu.be/…"></label>
      <label class="field"><span class="label">${t('Contenido / notas', 'Content / notes')}</span><textarea class="input" name="body" rows="5" placeholder="${t('Explica el paso…', 'Explain the step…')}">${lesson ? esc(lesson.body || '') : ''}</textarea></label>
      <label class="field"><span class="label">${t('Liberar (drip) — días tras la inscripción (0 = inmediato)', 'Drip — days after enrollment (0 = immediate)')}</span><input class="input" name="drip_days" type="number" min="0" value="${lesson ? (lesson.drip_days || 0) : 0}"></label>
      <div class="card-title" style="padding:8px 0 4px">${t('Cuestionario (opcional)', 'Quiz (optional)')}</div>
      <label class="field" style="max-width:200px"><span class="label">${t('Nota mínima para aprobar (%)', 'Pass score (%)')}</span><input class="input" id="q-pass" type="number" min="0" max="100" value="${quiz.pass_score || 70}"></label>
      <div id="q-questions"></div>
      <button type="button" class="btn secondary small" id="q-add">${t('+ Añadir pregunta', '+ Add question')}</button>
      <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Guardar', 'Save')}</button></div>
    </form>`);

  const qBox = modal.querySelector('#q-questions');
  const drawQuiz = () => {
    qBox.innerHTML = quiz.questions.map((q, i) => `
      <div class="card" style="padding:10px;margin-bottom:8px" data-i="${i}">
        <label class="field"><span class="label">${t('Pregunta', 'Question')} ${i + 1}</span><input class="input q-q" value="${esc(q.q || '')}"></label>
        <label class="field"><span class="label">${t('Opciones (una por línea)', 'Options (one per line)')}</span><textarea class="input q-opts" rows="2">${esc((q.options || []).join('\n'))}</textarea></label>
        <label class="field" style="max-width:220px"><span class="label">${t('Nº de la opción correcta (empieza en 1)', 'Correct option number (starts at 1)')}</span><input class="input q-ans" type="number" min="1" value="${(Number(q.answer) || 0) + 1}"></label>
        <button type="button" class="btn ghost small q-rm" data-i="${i}">${t('Quitar', 'Remove')}</button>
      </div>`).join('');
    qBox.querySelectorAll('.q-rm').forEach((b) => b.addEventListener('click', () => { collectQuiz(); quiz.questions.splice(+b.dataset.i, 1); drawQuiz(); }));
  };
  const collectQuiz = () => {
    qBox.querySelectorAll('[data-i]').forEach((el) => {
      const i = +el.dataset.i; const q = quiz.questions[i]; if (!q) return;
      q.q = el.querySelector('.q-q').value;
      q.options = el.querySelector('.q-opts').value.split('\n').map((s) => s.trim()).filter(Boolean);
      q.answer = Math.max(0, (Number(el.querySelector('.q-ans').value) || 1) - 1);
    });
  };
  drawQuiz();
  modal.querySelector('#q-add').addEventListener('click', () => { collectQuiz(); quiz.questions.push({ q: '', options: [], answer: 0 }); drawQuiz(); });
  modal.querySelector('#cancel').addEventListener('click', closeOverlay);
  modal.querySelector('#lesson-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    collectQuiz();
    quiz.pass_score = Number(modal.querySelector('#q-pass').value) || 0;
    const fd = formData(e.target);
    const body = { ...fd, drip_days: Number(fd.drip_days) || 0, quiz: quiz.questions.length ? quiz : '' };
    try {
      if (lesson) await api(`/training/lessons/${lesson.id}`, { method: 'PUT', body });
      else await api(`/training/courses/${course.id}/lessons`, { method: 'POST', body });
      closeOverlay();
      toast(t('Lección guardada', 'Lesson saved'));
      openCourse(view, course.id);
    } catch (err) {
      toast(err.message, true);
    }
  });
}
