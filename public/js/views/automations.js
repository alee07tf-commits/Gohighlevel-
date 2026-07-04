import { api } from '../api.js';
import { esc, openModal, closeOverlay, toast, fmtDate, fullName } from '../ui.js';

const TRIGGER_LABELS = {
  review_received: '★ Reseña recibida',
  invoice_paid: 'Factura pagada',
  appointment_status_changed: 'Cambio de estado de cita',
  contact_created: 'Contact created',
  tag_added: 'Tag added',
  form_submitted: 'Form submitted',
  appointment_booked: 'Appointment booked',
  opportunity_stage_changed: 'Opportunity stage changed',
  message_received: 'Message received (SMS/WhatsApp)',
};
const ACTION_LABELS = {
  add_tag: 'Add tag',
  remove_tag: 'Remove tag',
  send_email: 'Send email',
  send_sms: 'Send SMS',
  send_whatsapp: 'Send WhatsApp',
  add_note: 'Add note',
  create_opportunity: 'Create opportunity',
  wait: 'Wait / Esperar',
  create_task: 'Crear tarea',
  send_review_request: '★ Pedir reseña',
  branch: 'Rama If/Else',
  webhook: 'Webhook saliente',
};

export async function renderAutomations(view) {
  const workflows = await api('/workflows');

  view.innerHTML = `
  <div class="page-header">
    <h1>Automations</h1>
    <div class="spacer"></div>
    <button class="btn secondary" id="ai-wf-btn">Crear con IA</button>
    <button class="btn secondary" id="recipes-btn">Recetas</button>
    <button class="btn" id="new-wf">+ Workflow</button>
  </div>
  ${
    workflows.length
      ? workflows
          .map(
            (wf) => `<div class="card" style="margin-bottom:14px"><div class="card-body">
              <div class="flex">
                <strong style="font-size:15px">${esc(wf.name)}</strong>
                <span class="badge ${wf.active ? 'green' : 'gray'}">${wf.active ? 'active' : 'paused'}</span>
                <span class="muted" style="font-size:12px">${wf.run_count} runs</span>
                <div class="right">
                  <button class="btn secondary small toggle-wf" data-id="${wf.id}">${wf.active ? 'Pause' : 'Activate'}</button>
                  <button class="btn secondary small edit-wf" data-id="${wf.id}">Edit</button>
                  <button class="btn secondary small runs-wf" data-id="${wf.id}">History</button>
                  <button class="btn ghost small del-wf" data-id="${wf.id}">✕</button>
                </div>
              </div>
              <div style="margin-top:10px;font-size:13px">
                <span class="badge indigo">WHEN</span> ${TRIGGER_LABELS[wf.trigger_type] || wf.trigger_type}
                ${wf.trigger_config.tag ? `<span class="tag">${esc(wf.trigger_config.tag)}</span>` : ''}
                <span style="margin:0 6px">→</span>
                ${wf.actions
                  .map((a) => `<span class="badge gray" style="margin-right:4px">${ACTION_LABELS[a.type] || a.type}${a.config.tag ? `: ${esc(a.config.tag)}` : ''}</span>`)
                  .join('')}
              </div>
            </div></div>`
          )
          .join('')
      : '<div class="empty card" style="padding:60px"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>No workflows yet. Automate follow-ups, tagging and pipeline updates.</div>'
  }`;

  function workflowModal(wf = null) {
    const actions = wf ? structuredClone(wf.actions) : [];
    const modal = openModal(`
      <h2>${wf ? 'Edit' : 'New'} Workflow</h2>
      <label class="field"><span class="label">Name</span><input class="input" id="wf-name" value="${esc(wf?.name || '')}" placeholder="New lead follow-up"></label>
      <div class="form-row">
        <label class="field"><span class="label">Trigger (WHEN)</span><select class="input" id="wf-trigger">
          ${Object.entries(TRIGGER_LABELS).map(([k, v]) => `<option value="${k}" ${wf?.trigger_type === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></label>
        <label class="field" id="trigger-tag-field" style="display:none"><span class="label">Only for tag (optional)</span>
          <input class="input" id="wf-trigger-tag" value="${esc(wf?.trigger_config?.tag || '')}"></label>
      </div>
      <div class="card-title" style="padding:0;margin-bottom:8px">Actions (THEN)</div>
      <div id="actions-list"></div>
      <div class="flex" style="margin-top:8px">
        <select class="input" id="new-action-type" style="flex:1">
          ${Object.entries(ACTION_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
        <button type="button" class="btn secondary" id="add-action">+ Add Action</button>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="cancel">Cancel</button>
        <button type="button" class="btn" id="save-wf">${wf ? 'Save' : 'Create Workflow'}</button>
      </div>`);

    const triggerSel = modal.querySelector('#wf-trigger');
    const tagField = modal.querySelector('#trigger-tag-field');
    function syncTagField() {
      tagField.style.display = triggerSel.value === 'tag_added' ? 'block' : 'none';
    }
    triggerSel.addEventListener('change', syncTagField);
    syncTagField();

    const listEl = modal.querySelector('#actions-list');
    function actionFields(a, i) {
      switch (a.type) {
        case 'add_tag':
        case 'remove_tag':
          return `<input class="input" data-i="${i}" data-k="tag" placeholder="tag name" value="${esc(a.config.tag || '')}">`;
        case 'send_email':
          return `<input class="input" data-i="${i}" data-k="subject" placeholder="Subject — {{first_name}} works" value="${esc(a.config.subject || '')}" style="margin-bottom:6px">
            <textarea class="input" data-i="${i}" data-k="body" rows="3" placeholder="Email body">${esc(a.config.body || '')}</textarea>`;
        case 'send_sms':
        case 'send_whatsapp':
        case 'add_note':
          return `<textarea class="input" data-i="${i}" data-k="body" rows="2" placeholder="Text — merge fields supported">${esc(a.config.body || '')}</textarea>`;
        case 'wait':
          return `<div class="flex">
            <input class="input" data-i="${i}" data-k="amount" type="number" min="1" placeholder="Cantidad" value="${esc(a.config.amount || '')}" style="width:110px">
            <select class="input" data-i="${i}" data-k="unit" style="width:130px">
              ${['minutes', 'hours', 'days'].map((u) => `<option value="${u}" ${a.config.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
            </select></div>`;
        case 'webhook':
          return `<input class="input" data-i="${i}" data-k="url" placeholder="https://hooks.zapier.com/… (POST con datos del contacto)" value="${esc(a.config.url || '')}">`;
        case 'create_task':
          return `<input class="input" data-i="${i}" data-k="title" placeholder="Título de la tarea — {{first_name}} vale" value="${esc(a.config.title || '')}" style="margin-bottom:6px">
            <input class="input" data-i="${i}" data-k="due_in_days" type="number" placeholder="Vence en X días (0 = hoy)" value="${esc(a.config.due_in_days ?? '')}">`;
        case 'send_review_request':
          return `<select class="input" data-i="${i}" data-k="channel">
            ${['sms', 'whatsapp', 'email'].map((c) => `<option ${a.config.channel === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select><p class="muted" style="font-size:11px;margin-top:4px">4-5★ → tu link de Google (configúralo en Reputación) · 1-3★ → feedback privado</p>`;
        case 'branch': {
          const branchActions = (list) => (list || []).map((n) => `${n.type}${n.config?.tag ? ':' + n.config.tag : ''}`).join(', ') || 'vacío';
          return `<div class="form-row">
              <select class="input" data-i="${i}" data-k="field">
                ${['tag', 'score', 'source', 'email', 'phone'].map((f) => `<option ${a.config.field === f ? 'selected' : ''}>${f}</option>`).join('')}
              </select>
              <select class="input" data-i="${i}" data-k="op">
                ${['has', 'not_has', 'equals', 'not_equals', 'contains', 'gte', 'lte', 'is_set', 'not_set'].map((o) => `<option ${a.config.op === o ? 'selected' : ''}>${o}</option>`).join('')}
              </select>
              <input class="input" data-i="${i}" data-k="value" placeholder="valor" value="${esc(a.config.value ?? '')}">
            </div>
            <p class="muted" style="font-size:11px;margin:4px 0">SI se cumple → <strong>${esc(branchActions(a.config.then))}</strong> · SI NO → <strong>${esc(branchActions(a.config.otherwise))}</strong></p>
            <div class="flex">
              <button type="button" class="btn secondary small edit-branch" data-i="${i}" data-side="then">Editar SI ✓</button>
              <button type="button" class="btn secondary small edit-branch" data-i="${i}" data-side="otherwise">Editar SI NO ✗</button>
            </div>`;
        }
        case 'create_opportunity':
          return `<input class="input" data-i="${i}" data-k="title" placeholder="Opportunity title" value="${esc(a.config.title || '')}" style="margin-bottom:6px">
            <input class="input" data-i="${i}" data-k="value" type="number" placeholder="Value $" value="${esc(a.config.value || '')}">`;
        default:
          return '';
      }
    }
    function renderActions() {
      listEl.innerHTML = actions.length
        ? actions
            .map(
              (a, i) => `<div class="block-item">
                <div class="b-head"><span>${i + 1}. ${ACTION_LABELS[a.type]}</span>
                  <button type="button" class="btn ghost small rm-action" data-i="${i}">✕</button></div>
                ${actionFields(a, i)}
              </div>`
            )
            .join('')
        : '<p class="muted">No actions yet — add at least one below.</p>';
      listEl.querySelectorAll('.rm-action').forEach((b) =>
        b.addEventListener('click', () => {
          actions.splice(Number(b.dataset.i), 1);
          renderActions();
        })
      );
      listEl.querySelectorAll('[data-k]').forEach((input) =>
        input.addEventListener('input', () => {
          actions[Number(input.dataset.i)].config[input.dataset.k] = input.value;
        })
      );
      listEl.querySelectorAll('.edit-branch').forEach((btn) =>
        btn.addEventListener('click', () => {
          const action = actions[Number(btn.dataset.i)];
          const side = btn.dataset.side;
          const simple = ['add_tag', 'remove_tag', 'send_email', 'send_sms', 'send_whatsapp', 'add_note', 'create_task', 'send_review_request'];
          const current = JSON.stringify(action.config[side] || [], null, 2);
          const example = '[\n  { "type": "add_tag", "config": { "tag": "caliente" } },\n  { "type": "send_sms", "config": { "body": "Hola {{first_name}}!" } }\n]';
          const value = prompt(
            `Acciones de la rama ${side === 'then' ? 'SI ✓' : 'SI NO ✗'} (JSON).\nTipos: ${simple.join(', ')}\nEjemplo: ${example}`,
            current
          );
          if (value === null) return;
          try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed)) throw new Error('Debe ser una lista []');
            action.config[side] = parsed;
            renderActions();
          } catch (err) {
            toast('JSON inválido: ' + err.message, true);
          }
        })
      );
    }
    renderActions();

    modal.querySelector('#add-action').addEventListener('click', () => {
      actions.push({ type: modal.querySelector('#new-action-type').value, config: {} });
      renderActions();
    });
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#save-wf').addEventListener('click', async () => {
      const name = modal.querySelector('#wf-name').value.trim();
      if (!name) return toast('Name is required', true);
      if (!actions.length) return toast('Add at least one action', true);
      const body = {
        name,
        trigger_type: triggerSel.value,
        trigger_config: triggerSel.value === 'tag_added' && modal.querySelector('#wf-trigger-tag').value
          ? { tag: modal.querySelector('#wf-trigger-tag').value.trim() }
          : {},
        actions: actions.map((a) => ({ type: a.type, config: a.config })),
      };
      try {
        if (wf) await api(`/workflows/${wf.id}`, { method: 'PUT', body });
        else await api('/workflows', { method: 'POST', body });
        closeOverlay();
        toast('Workflow saved');
        renderAutomations(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  view.querySelector('#new-wf').addEventListener('click', () => workflowModal());
  view.querySelector('#ai-wf-btn').addEventListener('click', () => {
    const modal = openModal(`
      <h2>Workflow AI</h2>
      <p class="muted" style="margin-bottom:10px">Describe qué quieres automatizar y la IA monta el workflow (se crea en pausa para que lo revises).</p>
      <textarea class="input" id="wf-goal" rows="3" placeholder="Ej: cuando alguien reserve una cita, mándale un WhatsApp de confirmación, espera 1 día tras la cita y pídele una reseña"></textarea>
      <div class="modal-actions">
        <button class="btn secondary" id="cancel">Cancelar</button>
        <button class="btn" id="gen">Generar</button>
      </div>`);
    modal.querySelector('#cancel').addEventListener('click', () => (document.getElementById('modal-root').innerHTML = ''));
    modal.querySelector('#gen').addEventListener('click', async () => {
      const goal = modal.querySelector('#wf-goal').value.trim();
      if (!goal) return toast('Describe el objetivo', true);
      const btn = modal.querySelector('#gen');
      btn.disabled = true;
      btn.textContent = 'Generando…';
      try {
        const r = await api('/ai/workflow', { method: 'POST', body: { goal } });
        document.getElementById('modal-root').innerHTML = '';
        toast(r.generated_by === 'claude' ? 'Workflow creado por IA (en pausa — revísalo)' : 'Workflow plantilla creado (conecta ANTHROPIC_API_KEY para IA real)');
        renderAutomations(view);
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = 'Generar';
      }
    });
  });
  view.querySelector('#recipes-btn').addEventListener('click', async () => {
    const recipes = await api('/workflows/recipes');
    const modal = openModal(`
      <h2>Recetas de automatización</h2>
      <p class="muted" style="margin-bottom:12px">Workflows probados listos para instalar con un clic. Luego puedes editarlos.</p>
      ${recipes
        .map(
          (r) => `<div class="block-item">
            <div class="b-head"><span>${esc(r.name)}</span>
              <button class="btn small install-recipe" data-key="${esc(r.key)}">Instalar</button></div>
            <div class="muted" style="font-size:12px">${esc(r.description)}</div>
          </div>`
        )
        .join('')}`);
    modal.querySelectorAll('.install-recipe').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await api(`/workflows/recipes/${b.dataset.key}/install`, { method: 'POST' });
          toast('Receta instalada');
          document.getElementById('modal-root').innerHTML = '';
          renderAutomations(view);
        } catch (err) {
          toast(err.message, true);
          b.disabled = false;
        }
      })
    );
  });
  view.querySelectorAll('.edit-wf').forEach((b) =>
    b.addEventListener('click', () => workflowModal(workflows.find((w) => w.id === Number(b.dataset.id))))
  );
  view.querySelectorAll('.toggle-wf').forEach((b) =>
    b.addEventListener('click', async () => {
      const wf = workflows.find((w) => w.id === Number(b.dataset.id));
      await api(`/workflows/${wf.id}`, { method: 'PUT', body: { active: !wf.active } });
      renderAutomations(view);
    })
  );
  view.querySelectorAll('.del-wf').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete workflow?')) return;
      await api(`/workflows/${b.dataset.id}`, { method: 'DELETE' });
      renderAutomations(view);
    })
  );
  view.querySelectorAll('.runs-wf').forEach((b) =>
    b.addEventListener('click', async () => {
      const runs = await api(`/workflows/${b.dataset.id}/runs`);
      openModal(`
        <h2>Run History</h2>
        ${
          runs.length
            ? runs
                .map(
                  (r) => `<div class="block-item">
                    <div class="b-head"><span>${esc(fullName(r))}</span>
                      <span class="badge ${r.status === 'success' ? 'green' : 'red'}">${r.status}</span></div>
                    <div class="muted" style="font-size:12px">${fmtDate(r.created_at)}</div>
                    <ul style="margin:6px 0 0 18px;font-size:12px">${r.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
                  </div>`
                )
                .join('')
            : '<div class="empty">No runs yet</div>'
        }`);
    })
  );
}
