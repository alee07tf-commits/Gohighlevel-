import { api } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtMoney, fullName } from '../ui.js';
import { t } from '../i18n.js';

const STATUS_LABEL = {
  open: () => t('Abierta', 'Open'),
  won: () => t('Ganada', 'Won'),
  lost: () => t('Perdida', 'Lost'),
};

export async function renderPipelines(view) {
  const pipelines = await api('/pipelines');
  let currentId = Number(sessionStorage.getItem('lf_pipeline')) || pipelines[0]?.id;
  if (!pipelines.some((p) => p.id === currentId)) currentId = pipelines[0]?.id;

  view.innerHTML = `
  <div class="page-header">
    <h1>${t('Oportunidades', 'Opportunities')}</h1>
    <select class="input" id="pipeline-select" style="width:220px">
      ${pipelines.map((p) => `<option value="${p.id}" ${p.id === currentId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    </select>
    <button class="btn secondary small" id="new-pipeline">${t('+ Pipeline', '+ Pipeline')}</button>
    <button class="btn secondary small" id="new-stage">${t('+ Etapa', '+ Stage')}</button>
    <div class="spacer"></div>
    <button class="btn" id="new-opp">${t('+ Oportunidad', '+ Opportunity')}</button>
  </div>
  <div id="board"></div>`;

  const board = view.querySelector('#board');

  async function loadBoard() {
    const pipeline = pipelines.find((p) => p.id === currentId);
    if (!pipeline) {
      board.innerHTML = `<div class="empty"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>${t('Aún no hay pipelines. Crea uno para empezar a seguir tus oportunidades.', 'No pipelines yet. Create one to start tracking deals.')}</div>`;
      return;
    }
    sessionStorage.setItem('lf_pipeline', currentId);
    const opps = await api(`/pipelines/${pipeline.id}/opportunities`);

    board.innerHTML = `<div class="kanban">
      ${pipeline.stages
        .map((s) => {
          const cards = opps.filter((o) => o.stage_id === s.id && o.status === 'open');
          const total = cards.reduce((sum, o) => sum + o.value, 0);
          return `<div class="kanban-col" data-stage="${s.id}">
            <div class="col-head"><span>${esc(s.name)} <span class="muted">(${cards.length})</span></span>
              <span class="col-total">${fmtMoney(total)}</span></div>
            <div class="kanban-cards">
              ${cards
                .map(
                  (o) => `<div class="kanban-card" draggable="true" data-id="${o.id}">
                    <div class="k-title">${esc(o.title)}</div>
                    <div class="k-meta"><span>${esc(fullName(o))}</span><span class="k-value">${fmtMoney(o.value)}</span></div>
                  </div>`
                )
                .join('')}
            </div>
          </div>`;
        })
        .join('')}
      <div class="kanban-col" data-stage="__closed">
        <div class="col-head"><span>${t('Cerradas', 'Closed')}</span></div>
        <div class="kanban-cards">
          ${opps
            .filter((o) => o.status !== 'open')
            .map(
              (o) => `<div class="kanban-card" data-id="${o.id}" style="opacity:.75">
                <div class="k-title">${esc(o.title)}</div>
                <div class="k-meta"><span class="badge ${o.status === 'won' ? 'green' : 'red'}">${(STATUS_LABEL[o.status] || (() => o.status))()}</span>
                <span class="k-value">${fmtMoney(o.value)}</span></div></div>`
            )
            .join('')}
        </div>
      </div>
    </div>`;

    // Drag & drop between stages.
    board.querySelectorAll('.kanban-card[draggable]').forEach((card) => {
      card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', card.dataset.id));
      card.addEventListener('click', () => oppModal(opps.find((o) => o.id === Number(card.dataset.id))));
    });
    board.querySelectorAll('.kanban-col').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const oppId = e.dataTransfer.getData('text/plain');
        if (!oppId || col.dataset.stage === '__closed') return;
        try {
          await api(`/pipelines/opportunities/${oppId}`, { method: 'PUT', body: { stage_id: Number(col.dataset.stage) } });
          loadBoard();
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  }

  function oppModal(opp = null) {
    const pipeline = pipelines.find((p) => p.id === currentId);
    if (!pipeline) return toast(t('Primero crea un pipeline', 'Create a pipeline first'), true);
    const modal = openModal(`
      <h2>${opp ? t('Editar oportunidad', 'Edit Opportunity') : t('Nueva oportunidad', 'New Opportunity')}</h2>
      <form id="opp-form">
        <label class="field"><span class="label">${t('Título', 'Title')}</span><input class="input" name="title" required value="${esc(opp?.title || '')}"></label>
        <div class="form-row">
          <label class="field"><span class="label">${t('Valor ($)', 'Value ($)')}</span><input class="input" name="value" type="number" step="0.01" value="${opp?.value ?? ''}"></label>
          <label class="field"><span class="label">${t('Etapa', 'Stage')}</span><select class="input" name="stage_id">
            ${pipeline.stages.map((s) => `<option value="${s.id}" ${opp?.stage_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select></label>
        </div>
        <label class="field"><span class="label">${t('Contacto (buscar por nombre/email)', 'Contact (search by name/email)')}</span>
          <input class="input" id="contact-search" placeholder="${t('Dejar vacío para ninguno', 'Leave empty for none')}" autocomplete="off">
          <input type="hidden" name="contact_id" value="${opp?.contact_id || ''}">
          <div id="contact-results"></div></label>
        ${opp ? `<label class="field"><span class="label">${t('Estado', 'Status')}</span><select class="input" name="status">
          ${['open', 'won', 'lost'].map((s) => `<option value="${s}" ${opp.status === s ? 'selected' : ''}>${STATUS_LABEL[s]()}</option>`).join('')}
        </select></label>` : ''}
        <div class="modal-actions">
          ${opp ? `<button type="button" class="btn danger" id="del-opp">${t('Eliminar', 'Delete')}</button>` : ''}
          <button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
          <button class="btn">${opp ? t('Guardar', 'Save') : t('Crear', 'Create')}</button>
        </div>
      </form>`);

    if (opp?.contact_id) modal.querySelector('#contact-search').value = fullName(opp);
    let searchTimer;
    modal.querySelector('#contact-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const results = await api(`/contacts?q=${encodeURIComponent(e.target.value)}&limit=5`);
        const div = modal.querySelector('#contact-results');
        div.innerHTML = results
          .map((c) => `<a href="#" data-id="${c.id}" class="tag" style="cursor:pointer">${esc(fullName(c))}</a>`)
          .join(' ');
        div.querySelectorAll('a').forEach((a) =>
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            modal.querySelector('[name=contact_id]').value = a.dataset.id;
            modal.querySelector('#contact-search').value = a.textContent;
            div.innerHTML = '';
          })
        );
      }, 250);
    });

    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#del-opp')?.addEventListener('click', async () => {
      if (!confirm(t('¿Eliminar esta oportunidad?', 'Delete this opportunity?'))) return;
      await api(`/pipelines/opportunities/${opp.id}`, { method: 'DELETE' });
      closeOverlay();
      loadBoard();
    });
    modal.querySelector('#opp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = formData(e.target);
      data.contact_id = data.contact_id ? Number(data.contact_id) : null;
      data.stage_id = Number(data.stage_id);
      try {
        if (opp) await api(`/pipelines/opportunities/${opp.id}`, { method: 'PUT', body: data });
        else await api(`/pipelines/${currentId}/opportunities`, { method: 'POST', body: data });
        closeOverlay();
        loadBoard();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  view.querySelector('#pipeline-select').addEventListener('change', (e) => {
    currentId = Number(e.target.value);
    loadBoard();
  });
  view.querySelector('#new-opp').addEventListener('click', () => oppModal());
  view.querySelector('#new-pipeline').addEventListener('click', async () => {
    const name = prompt(t('Nombre del pipeline:', 'Pipeline name:'));
    if (!name) return;
    await api('/pipelines', { method: 'POST', body: { name } });
    renderPipelines(view);
  });
  view.querySelector('#new-stage').addEventListener('click', async () => {
    if (!currentId) return toast(t('Primero crea un pipeline', 'Create a pipeline first'), true);
    const name = prompt(t('Nombre de la etapa:', 'Stage name:'));
    if (!name) return;
    await api(`/pipelines/${currentId}/stages`, { method: 'POST', body: { name } });
    renderPipelines(view);
  });

  await loadBoard();
}
