import { api } from '../api.js';
import { esc, openModal, closeOverlay, toast, fmtDate, fullName } from '../ui.js';

const TRIGGER_LABELS = {
  contact_created: '👤 Contact created',
  tag_added: '🏷️ Tag added',
  form_submitted: '📩 Form submitted',
  appointment_booked: '📅 Appointment booked',
  opportunity_stage_changed: '🎯 Opportunity stage changed',
  message_received: '💬 Message received (SMS/WhatsApp)',
};
const ACTION_LABELS = {
  add_tag: 'Add tag',
  remove_tag: 'Remove tag',
  send_email: 'Send email',
  send_sms: 'Send SMS',
  send_whatsapp: 'Send WhatsApp',
  add_note: 'Add note',
  create_opportunity: 'Create opportunity',
  wait: '⏳ Wait / Esperar',
};

export async function renderAutomations(view) {
  const workflows = await api('/workflows');

  view.innerHTML = `
  <div class="page-header">
    <h1>Automations</h1>
    <div class="spacer"></div>
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
      : '<div class="empty card" style="padding:60px"><div class="big">⚙️</div>No workflows yet. Automate follow-ups, tagging and pipeline updates.</div>'
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
