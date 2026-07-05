import { api } from '../api.js';
import { esc, openModal, closeOverlay, toast, fmtDate, fullName } from '../ui.js';
import { t } from '../i18n.js';

const TYPES = [
  ['text', () => t('Texto corto', 'Short text')],
  ['textarea', () => t('Texto largo', 'Long text')],
  ['choice', () => t('Opción múltiple', 'Multiple choice')],
  ['yesno', () => t('Sí / No', 'Yes / No')],
  ['rating', () => t('Valoración (1-5)', 'Rating (1-5)')],
  ['email', 'Email'],
  ['phone', () => t('Teléfono', 'Phone')],
];

export async function renderSurveys(view, rest = []) {
  if (rest[0] === 'responses' && rest[1]) return renderResponses(view, Number(rest[1]));
  const surveys = await api('/surveys');

  view.innerHTML = `
  <div class="page-header">
    <h1>${t('Encuestas', 'Surveys')}</h1>
    <div class="spacer"></div>
    <button class="btn" id="new-survey">${t('+ Nueva encuesta', '+ New survey')}</button>
  </div>
  <p class="muted" style="font-size:13px;margin-bottom:14px">${t('Encuestas de varias preguntas con lógica condicional. Captura respuestas y leads directamente en el CRM.', 'Multi-question surveys with conditional logic. Capture responses and leads straight into the CRM.')}</p>
  ${
    surveys.length
      ? `<div class="grid-2">${surveys.map((s) => `
        <div class="card"><div class="card-body">
          <div class="flex"><strong style="font-size:15px">${esc(s.name)}</strong>
            <div class="right"><span class="badge indigo">${s.responses} ${t('resp.', 'resp.')}</span>
              <button class="btn ghost small del-s" data-id="${s.id}">✕</button></div></div>
          <div class="muted" style="font-size:12px;margin:8px 0">${s.questions.length} ${t('preguntas', 'questions')} · <a href="/s/${esc(s.slug)}" target="_blank"><code class="inline">/s/${esc(s.slug)}</code> ↗</a></div>
          <div class="flex" style="gap:6px">
            <button class="btn secondary small edit-s" data-id="${s.id}">${t('Editar', 'Edit')}</button>
            <a class="btn secondary small" href="#/surveys/responses/${s.id}">${t('Respuestas', 'Responses')}</a>
            <button class="btn ghost small copy-s" data-slug="${esc(s.slug)}">${t('Copiar link', 'Copy link')}</button>
          </div>
        </div></div>`).join('')}</div>`
      : `<div class="empty card" style="padding:50px"><div class="big">📋</div>${t('Sin encuestas todavía.', 'No surveys yet.')}</div>`
  }`;

  view.querySelector('#new-survey').addEventListener('click', () => editor());
  view.querySelectorAll('.edit-s').forEach((b) => b.addEventListener('click', async () => editor(await api(`/surveys/${b.dataset.id}`))));
  view.querySelectorAll('.del-s').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('¿Eliminar esta encuesta y sus respuestas?', 'Delete this survey and its responses?'))) return;
    await api(`/surveys/${b.dataset.id}`, { method: 'DELETE' }); renderSurveys(view);
  }));
  view.querySelectorAll('.copy-s').forEach((b) => b.addEventListener('click', () => {
    navigator.clipboard.writeText(location.origin + '/s/' + b.dataset.slug); toast(t('Link copiado', 'Link copied'));
  }));

  function editor(survey = null) {
    let questions = survey ? structuredClone(survey.questions || []) : [];
    const modal = openModal(`
      <h2>${survey ? t('Editar encuesta', 'Edit survey') : t('Nueva encuesta', 'New survey')}</h2>
      <label class="field"><span class="label">${t('Nombre', 'Name')}</span><input class="input" id="s-name" value="${survey ? esc(survey.name) : ''}" placeholder="${t('Encuesta de satisfacción', 'Satisfaction survey')}"></label>
      <label class="field"><span class="label">${t('Etiqueta para los leads (opcional)', 'Tag for captured leads (optional)')}</span><input class="input" id="s-tag" value="${survey ? esc(survey.tag || '') : ''}" placeholder="encuesta"></label>
      <div class="card-title" style="padding:10px 0 4px">${t('Preguntas', 'Questions')}</div>
      <div id="q-list"></div>
      <button class="btn secondary small" id="add-q" style="margin-top:8px">${t('+ Añadir pregunta', '+ Add question')}</button>
      <div class="modal-actions"><button class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button><button class="btn" id="save-s">${t('Guardar', 'Save')}</button></div>`);

    const qList = modal.querySelector('#q-list');
    const draw = () => {
      qList.innerHTML = questions.map((q, i) => `
        <div class="card" style="padding:10px;margin-bottom:8px" data-i="${i}">
          <div class="form-row">
            <label class="field" style="flex:2"><span class="label">${t('Pregunta', 'Question')} ${i + 1}</span><input class="input q-label" value="${esc(q.label || '')}"></label>
            <label class="field" style="max-width:150px"><span class="label">${t('Tipo', 'Type')}</span>
              <select class="input q-type">${TYPES.map(([v, l]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${typeof l === 'function' ? l() : l}</option>`).join('')}</select></label>
          </div>
          <div class="q-options" ${q.type === 'choice' ? '' : 'style="display:none"'}>
            <label class="field"><span class="label">${t('Opciones (una por línea)', 'Options (one per line)')}</span><textarea class="input q-opts" rows="2">${esc((q.options || []).join('\n'))}</textarea></label>
          </div>
          <div class="flex" style="gap:12px;font-size:12px;flex-wrap:wrap;align-items:center">
            <label class="flex" style="gap:5px"><input type="checkbox" class="q-req" ${q.required ? 'checked' : ''}> ${t('Obligatoria', 'Required')}</label>
            <label class="flex" style="gap:5px"><span>${t('Mapear a', 'Map to')}:</span>
              <select class="input q-map" style="width:auto;padding:4px"><option value="">—</option>
                <option value="name" ${q.map === 'name' ? 'selected' : ''}>${t('Nombre', 'Name')}</option>
                <option value="email" ${q.map === 'email' ? 'selected' : ''}>Email</option>
                <option value="phone" ${q.map === 'phone' ? 'selected' : ''}>${t('Teléfono', 'Phone')}</option></select></label>
            <button class="btn ghost small q-del" data-i="${i}">${t('Quitar', 'Remove')}</button>
          </div>
          <div class="flex" style="gap:6px;font-size:12px;margin-top:6px;align-items:center">
            <span class="muted">${t('Mostrar solo si', 'Show only if')}</span>
            <select class="input q-cond-q" style="width:auto;padding:4px"><option value="">${t('(siempre)', '(always)')}</option>
              ${questions.filter((_, j) => j < i).map((pq, j) => `<option value="${pq.id || j}" ${q.condition && String(q.condition.q) === String(pq.id || j) ? 'selected' : ''}>${esc((pq.label || 'P' + (j + 1)).slice(0, 24))}</option>`).join('')}</select>
            <span class="muted">=</span><input class="input q-cond-v" style="width:120px;padding:4px" value="${esc(q.condition ? q.condition.equals || '' : '')}" placeholder="${t('valor', 'value')}">
          </div>
        </div>`).join('') || `<p class="muted">${t('Añade la primera pregunta.', 'Add the first question.')}</p>`;
      qList.querySelectorAll('.q-del').forEach((b) => b.addEventListener('click', () => { collect(); questions.splice(+b.dataset.i, 1); draw(); }));
      qList.querySelectorAll('.q-type').forEach((s) => s.addEventListener('change', () => { collect(); draw(); }));
    };
    const collect = () => {
      qList.querySelectorAll('[data-i]').forEach((el) => {
        const i = +el.dataset.i;
        const q = questions[i]; if (!q) return;
        q.label = el.querySelector('.q-label').value;
        q.type = el.querySelector('.q-type').value;
        q.required = el.querySelector('.q-req').checked;
        q.map = el.querySelector('.q-map').value || undefined;
        q.options = q.type === 'choice' ? el.querySelector('.q-opts').value.split('\n').map((s) => s.trim()).filter(Boolean) : undefined;
        const cq = el.querySelector('.q-cond-q').value, cv = el.querySelector('.q-cond-v').value;
        q.condition = cq ? { q: cq, equals: cv } : undefined;
        if (!q.id) q.id = 'q' + i + Math.floor(performance.now());
      });
    };
    draw();
    modal.querySelector('#add-q').addEventListener('click', () => { collect(); questions.push({ type: 'text', label: '' }); draw(); });
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#save-s').addEventListener('click', async () => {
      collect();
      const name = modal.querySelector('#s-name').value.trim();
      if (!name) return toast(t('Ponle un nombre', 'Give it a name'), true);
      const body = { name, tag: modal.querySelector('#s-tag').value.trim(), questions };
      try {
        if (survey) await api(`/surveys/${survey.id}`, { method: 'PUT', body });
        else await api('/surveys', { method: 'POST', body });
        closeOverlay(); toast(t('Encuesta guardada', 'Survey saved')); renderSurveys(view);
      } catch (err) { toast(err.message, true); }
    });
  }
}

async function renderResponses(view, id) {
  const s = await api(`/surveys/${id}`);
  view.innerHTML = `
  <div class="page-header"><a href="#/surveys" class="btn ghost small">← ${t('Encuestas', 'Surveys')}</a>
    <h1 style="margin-left:10px">${esc(s.name)}</h1></div>
  <div class="card"><div class="card-body">
    ${s.responses.length
      ? `<table class="table"><thead><tr><th>${t('Fecha', 'Date')}</th><th>${t('Contacto', 'Contact')}</th>${s.questions.map((q) => `<th>${esc((q.label || '').slice(0, 30))}</th>`).join('')}</tr></thead>
        <tbody>${s.responses.map((r) => `<tr><td class="muted" style="font-size:11px">${fmtDate(r.created_at)}</td>
          <td>${r.contact_id ? esc(fullName(r)) : '<span class="muted">—</span>'}</td>
          ${s.questions.map((q) => `<td>${esc(String(r.answers[q.label] ?? '—'))}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : `<div class="empty">${t('Aún no hay respuestas.', 'No responses yet.')}</div>`}
  </div></div>`;
}
