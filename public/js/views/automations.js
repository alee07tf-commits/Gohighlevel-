import { api } from '../api.js';
import { esc, openModal, closeOverlay, toast, fmtDate, fullName } from '../ui.js';
import { t } from '../i18n.js';

const TRIGGER_LABELS = {
  review_received: t('★ Reseña recibida', '★ Review received'),
  invoice_paid: t('Factura pagada', 'Invoice paid'),
  appointment_status_changed: t('Cambio de estado de cita', 'Appointment status changed'),
  contact_created: t('Contacto creado', 'Contact created'),
  tag_added: t('Etiqueta añadida', 'Tag added'),
  form_submitted: t('Formulario enviado', 'Form submitted'),
  appointment_booked: t('Cita reservada', 'Appointment booked'),
  opportunity_stage_changed: t('Cambio de etapa de oportunidad', 'Opportunity stage changed'),
  message_received: t('Mensaje recibido (SMS/WhatsApp)', 'Message received (SMS/WhatsApp)'),
};
const ACTION_LABELS = {
  add_tag: t('Añadir etiqueta', 'Add tag'),
  remove_tag: t('Quitar etiqueta', 'Remove tag'),
  send_email: t('Enviar email', 'Send email'),
  send_sms: t('Enviar SMS', 'Send SMS'),
  send_whatsapp: t('Enviar WhatsApp', 'Send WhatsApp'),
  add_note: t('Añadir nota', 'Add note'),
  create_opportunity: t('Crear oportunidad', 'Create opportunity'),
  wait: t('Esperar', 'Wait'),
  create_task: t('Crear tarea', 'Create task'),
  send_review_request: t('★ Pedir reseña', '★ Request review'),
  branch: t('Rama Si/Entonces', 'If/Else branch'),
  webhook: t('Webhook saliente', 'Outgoing webhook'),
};

export async function renderAutomations(view) {
  const workflows = await api('/workflows');

  view.innerHTML = `
  <div class="page-header">
    <h1>${t('Automatizaciones', 'Automations')}</h1>
    <div class="spacer"></div>
    <button class="btn secondary" id="ai-wf-btn">${t('Crear con IA', 'Create with AI')}</button>
    <button class="btn secondary" id="recipes-btn">${t('Recetas', 'Recipes')}</button>
    <button class="btn" id="new-wf">${t('+ Flujo', '+ Workflow')}</button>
  </div>
  ${
    workflows.length
      ? workflows
          .map(
            (wf) => `<div class="card" style="margin-bottom:14px"><div class="card-body">
              <div class="flex">
                <strong style="font-size:15px">${esc(wf.name)}</strong>
                <span class="badge ${wf.active ? 'green' : 'gray'}">${wf.active ? t('activo', 'active') : t('pausado', 'paused')}</span>
                <span class="muted" style="font-size:12px">${t(`${wf.run_count} ejecuciones`, `${wf.run_count} runs`)}</span>
                <div class="right">
                  <button class="btn secondary small toggle-wf" data-id="${wf.id}">${wf.active ? t('Pausar', 'Pause') : t('Activar', 'Activate')}</button>
                  <button class="btn secondary small edit-wf" data-id="${wf.id}">${t('Editar', 'Edit')}</button>
                  <button class="btn secondary small runs-wf" data-id="${wf.id}">${t('Historial', 'History')}</button>
                  <button class="btn ghost small del-wf" data-id="${wf.id}">✕</button>
                </div>
              </div>
              <div style="margin-top:10px;font-size:13px">
                <span class="badge indigo">${t('CUANDO', 'WHEN')}</span> ${TRIGGER_LABELS[wf.trigger_type] || wf.trigger_type}
                ${wf.trigger_config.tag ? `<span class="tag">${esc(wf.trigger_config.tag)}</span>` : ''}
                <span style="margin:0 6px">→</span>
                ${wf.actions
                  .map((a) => `<span class="badge gray" style="margin-right:4px">${ACTION_LABELS[a.type] || a.type}${a.config.tag ? `: ${esc(a.config.tag)}` : ''}</span>`)
                  .join('')}
              </div>
            </div></div>`
          )
          .join('')
      : `<div class="empty card" style="padding:60px"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>${t('Aún no hay flujos. Automatiza seguimientos, etiquetado y actualizaciones del pipeline.', 'No workflows yet. Automate follow-ups, tagging and pipeline updates.')}</div>`
  }`;

  function workflowModal(wf = null) {
    const actions = wf ? structuredClone(wf.actions) : [];
    const modal = openModal(`
      <h2>${wf ? t('Editar flujo', 'Edit Workflow') : t('Nuevo flujo', 'New Workflow')}</h2>
      <label class="field"><span class="label">${t('Nombre', 'Name')}</span><input class="input" id="wf-name" value="${esc(wf?.name || '')}" placeholder="${t('Seguimiento de nuevo lead', 'New lead follow-up')}"></label>
      <div class="form-row">
        <label class="field"><span class="label">${t('Disparador (CUANDO)', 'Trigger (WHEN)')}</span><select class="input" id="wf-trigger">
          ${Object.entries(TRIGGER_LABELS).map(([k, v]) => `<option value="${k}" ${wf?.trigger_type === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></label>
        <label class="field" id="trigger-tag-field" style="display:none"><span class="label">${t('Solo para etiqueta (opcional)', 'Only for tag (optional)')}</span>
          <input class="input" id="wf-trigger-tag" value="${esc(wf?.trigger_config?.tag || '')}"></label>
      </div>
      <div class="card-title" style="padding:0;margin-bottom:8px">${t('Acciones (ENTONCES)', 'Actions (THEN)')}</div>
      <div id="actions-list"></div>
      <div class="flex" style="margin-top:8px">
        <select class="input" id="new-action-type" style="flex:1">
          ${Object.entries(ACTION_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
        <button type="button" class="btn secondary" id="add-action">${t('+ Añadir acción', '+ Add Action')}</button>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
        <button type="button" class="btn" id="save-wf">${wf ? t('Guardar', 'Save') : t('Crear flujo', 'Create Workflow')}</button>
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
          return `<input class="input" data-i="${i}" data-k="tag" placeholder="${t('nombre de etiqueta', 'tag name')}" value="${esc(a.config.tag || '')}">`;
        case 'send_email':
          return `<input class="input" data-i="${i}" data-k="subject" placeholder="${t('Asunto — {{first_name}} funciona', 'Subject — {{first_name}} works')}" value="${esc(a.config.subject || '')}" style="margin-bottom:6px">
            <textarea class="input" data-i="${i}" data-k="body" rows="3" placeholder="${t('Cuerpo del email', 'Email body')}">${esc(a.config.body || '')}</textarea>`;
        case 'send_sms':
        case 'send_whatsapp':
        case 'add_note':
          return `<textarea class="input" data-i="${i}" data-k="body" rows="2" placeholder="${t('Texto — admite campos de fusión', 'Text — merge fields supported')}">${esc(a.config.body || '')}</textarea>`;
        case 'wait':
          return `<div class="flex">
            <input class="input" data-i="${i}" data-k="amount" type="number" min="1" placeholder="${t('Cantidad', 'Amount')}" value="${esc(a.config.amount || '')}" style="width:110px">
            <select class="input" data-i="${i}" data-k="unit" style="width:130px">
              ${['minutes', 'hours', 'days'].map((u) => `<option value="${u}" ${a.config.unit === u ? 'selected' : ''}>${{ minutes: t('minutos', 'minutes'), hours: t('horas', 'hours'), days: t('días', 'days') }[u]}</option>`).join('')}
            </select></div>`;
        case 'webhook':
          return `<input class="input" data-i="${i}" data-k="url" placeholder="${t('https://hooks.zapier.com/… (POST con datos del contacto)', 'https://hooks.zapier.com/… (POST with contact data)')}" value="${esc(a.config.url || '')}">`;
        case 'create_task':
          return `<input class="input" data-i="${i}" data-k="title" placeholder="${t('Título de la tarea — {{first_name}} vale', 'Task title — {{first_name}} works')}" value="${esc(a.config.title || '')}" style="margin-bottom:6px">
            <input class="input" data-i="${i}" data-k="due_in_days" type="number" placeholder="${t('Vence en X días (0 = hoy)', 'Due in X days (0 = today)')}" value="${esc(a.config.due_in_days ?? '')}">`;
        case 'send_review_request':
          return `<select class="input" data-i="${i}" data-k="channel">
            ${['sms', 'whatsapp', 'email'].map((c) => `<option ${a.config.channel === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select><p class="muted" style="font-size:11px;margin-top:4px">${t('4-5★ → tu link de Google (configúralo en Reputación) · 1-3★ → feedback privado', '4-5★ → your Google link (set it up in Reputation) · 1-3★ → private feedback')}</p>`;
        case 'branch': {
          const branchActions = (list) => (list || []).map((n) => `${n.type}${n.config?.tag ? ':' + n.config.tag : ''}`).join(', ') || t('vacío', 'empty');
          return `<div class="form-row">
              <select class="input" data-i="${i}" data-k="field">
                ${['tag', 'score', 'source', 'email', 'phone'].map((f) => `<option ${a.config.field === f ? 'selected' : ''}>${f}</option>`).join('')}
              </select>
              <select class="input" data-i="${i}" data-k="op">
                ${['has', 'not_has', 'equals', 'not_equals', 'contains', 'gte', 'lte', 'is_set', 'not_set'].map((o) => `<option ${a.config.op === o ? 'selected' : ''}>${o}</option>`).join('')}
              </select>
              <input class="input" data-i="${i}" data-k="value" placeholder="${t('valor', 'value')}" value="${esc(a.config.value ?? '')}">
            </div>
            <p class="muted" style="font-size:11px;margin:4px 0">${t('SI se cumple', 'IF true')} → <strong>${esc(branchActions(a.config.then))}</strong> · ${t('SI NO', 'IF false')} → <strong>${esc(branchActions(a.config.otherwise))}</strong></p>
            <div class="flex">
              <button type="button" class="btn secondary small edit-branch" data-i="${i}" data-side="then">${t('Editar SI ✓', 'Edit IF ✓')}</button>
              <button type="button" class="btn secondary small edit-branch" data-i="${i}" data-side="otherwise">${t('Editar SI NO ✗', 'Edit IF NOT ✗')}</button>
            </div>`;
        }
        case 'create_opportunity':
          return `<input class="input" data-i="${i}" data-k="title" placeholder="${t('Título de oportunidad', 'Opportunity title')}" value="${esc(a.config.title || '')}" style="margin-bottom:6px">
            <input class="input" data-i="${i}" data-k="value" type="number" placeholder="${t('Valor $', 'Value $')}" value="${esc(a.config.value || '')}">`;
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
        : `<p class="muted">${t('Aún no hay acciones — añade al menos una abajo.', 'No actions yet — add at least one below.')}</p>`;
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
            t(
              `Acciones de la rama ${side === 'then' ? 'SI ✓' : 'SI NO ✗'} (JSON).\nTipos: ${simple.join(', ')}\nEjemplo: ${example}`,
              `Branch actions ${side === 'then' ? 'IF ✓' : 'IF NOT ✗'} (JSON).\nTypes: ${simple.join(', ')}\nExample: ${example}`
            ),
            current
          );
          if (value === null) return;
          try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed)) throw new Error(t('Debe ser una lista []', 'Must be a list []'));
            action.config[side] = parsed;
            renderActions();
          } catch (err) {
            toast(t('JSON inválido: ', 'Invalid JSON: ') + err.message, true);
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
      if (!name) return toast(t('El nombre es obligatorio', 'Name is required'), true);
      if (!actions.length) return toast(t('Añade al menos una acción', 'Add at least one action'), true);
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
        toast(t('Flujo guardado', 'Workflow saved'));
        renderAutomations(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  view.querySelector('#new-wf').addEventListener('click', () => workflowModal());
  view.querySelector('#ai-wf-btn').addEventListener('click', () => {
    const modal = openModal(`
      <h2>${t('Workflow con IA', 'Workflow AI')}</h2>
      <p class="muted" style="margin-bottom:10px">${t('Describe qué quieres automatizar y la IA monta el workflow (se crea en pausa para que lo revises).', 'Describe what you want to automate and AI builds the workflow (created paused so you can review it).')}</p>
      <textarea class="input" id="wf-goal" rows="3" placeholder="${t('Ej: cuando alguien reserve una cita, mándale un WhatsApp de confirmación, espera 1 día tras la cita y pídele una reseña', 'E.g.: when someone books an appointment, send them a WhatsApp confirmation, wait 1 day after the appointment and ask for a review')}"></textarea>
      <div class="modal-actions">
        <button class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
        <button class="btn" id="gen">${t('Generar', 'Generate')}</button>
      </div>`);
    modal.querySelector('#cancel').addEventListener('click', () => (document.getElementById('modal-root').innerHTML = ''));
    modal.querySelector('#gen').addEventListener('click', async () => {
      const goal = modal.querySelector('#wf-goal').value.trim();
      if (!goal) return toast(t('Describe el objetivo', 'Describe the goal'), true);
      const btn = modal.querySelector('#gen');
      btn.disabled = true;
      btn.textContent = t('Generando…', 'Generating…');
      try {
        const r = await api('/ai/workflow', { method: 'POST', body: { goal } });
        document.getElementById('modal-root').innerHTML = '';
        toast(r.generated_by === 'claude' ? t('Workflow creado por IA (en pausa — revísalo)', 'Workflow created by AI (paused — review it)') : t('Workflow plantilla creado (conecta ANTHROPIC_API_KEY para IA real)', 'Template workflow created (connect ANTHROPIC_API_KEY for real AI)'));
        renderAutomations(view);
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = t('Generar', 'Generate');
      }
    });
  });
  view.querySelector('#recipes-btn').addEventListener('click', async () => {
    const recipes = await api('/workflows/recipes');
    const modal = openModal(`
      <h2>${t('Recetas de automatización', 'Automation recipes')}</h2>
      <p class="muted" style="margin-bottom:12px">${t('Workflows probados listos para instalar con un clic. Luego puedes editarlos.', 'Proven workflows ready to install in one click. You can edit them afterwards.')}</p>
      ${recipes
        .map(
          (r) => `<div class="block-item">
            <div class="b-head"><span>${esc(r.name)}</span>
              <button class="btn small install-recipe" data-key="${esc(r.key)}">${t('Instalar', 'Install')}</button></div>
            <div class="muted" style="font-size:12px">${esc(r.description)}</div>
          </div>`
        )
        .join('')}`);
    modal.querySelectorAll('.install-recipe').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await api(`/workflows/recipes/${b.dataset.key}/install`, { method: 'POST' });
          toast(t('Receta instalada', 'Recipe installed'));
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
      if (!confirm(t('¿Eliminar flujo?', 'Delete workflow?'))) return;
      await api(`/workflows/${b.dataset.id}`, { method: 'DELETE' });
      renderAutomations(view);
    })
  );
  view.querySelectorAll('.runs-wf').forEach((b) =>
    b.addEventListener('click', async () => {
      const runs = await api(`/workflows/${b.dataset.id}/runs`);
      openModal(`
        <h2>${t('Historial de ejecuciones', 'Run History')}</h2>
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
            : `<div class="empty">${t('Sin ejecuciones todavía', 'No runs yet')}</div>`
        }`);
    })
  );
}
