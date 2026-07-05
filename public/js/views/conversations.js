import { api } from '../api.js';
import { esc, toast, fmtDate, fullName, initials } from '../ui.js';
import { t } from '../i18n.js';

const FILTERS = [
  ['all', () => t('Todas', 'All')],
  ['unread', () => t('Sin leer', 'Unread')],
  ['unanswered', () => t('Sin responder', 'Unanswered')],
  ['mine', () => t('Míos', 'Mine')],
];

export async function renderConversations(view, rest = []) {
  const activeId = rest[0] ? Number(rest[0]) : null;
  let filter = 'all';
  let channel = '';
  const [team, snippets] = await Promise.all([
    api('/locations/team/users').catch(() => []),
    api('/snippets').catch(() => []),
  ]);

  view.innerHTML = `
  <div class="page-header"><h1>${t('Conversaciones', 'Conversations')}</h1>
    <span class="badge indigo" id="unread-badge"></span>
    <div class="spacer"></div>
    <div class="seg" id="conv-filters">${FILTERS.map((f) => `<button class="seg-btn ${f[0] === 'all' ? 'active' : ''}" data-f="${f[0]}">${f[1]()}</button>`).join('')}</div>
    <select class="input" id="channel-filter" style="width:130px">
      <option value="">${t('Todo canal', 'All channels')}</option>
      ${['sms', 'whatsapp', 'email', 'chat'].map((c) => `<option value="${c}">${c.toUpperCase()}</option>`).join('')}
    </select>
  </div>
  <div class="conv-layout ${activeId ? 'thread-open' : ''}">
    <div class="conv-list" id="conv-list"></div>
    <div class="conv-thread" id="thread">
      <div class="empty" style="margin:auto"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>${t('Selecciona una conversación', 'Select a conversation')}</div>
    </div>
  </div>`;

  const listEl = view.querySelector('#conv-list');
  async function loadList() {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('filter', filter);
    if (channel) params.set('channel', channel);
    const convs = await api(`/conversations?${params}`);
    view.querySelector('#unread-badge').textContent = `${convs.filter((c) => c.unread > 0).length} ${t('sin leer', 'unread')}`;
    listEl.innerHTML = convs.length
      ? convs.map((c) => `<div class="conv-item ${c.id === activeId ? 'active' : ''}" data-id="${c.id}">
          <div class="c-name">${esc(fullName(c))} ${c.unread ? '<span class="unread-dot"></span>' : ''}${c.last_direction === 'inbound' ? '<span class="badge amber" style="font-size:9px;padding:1px 5px;margin-left:4px">●</span>' : ''}</div>
          <div class="c-preview">${c.last_channel ? `[${esc(c.last_channel)}] ` : ''}${esc(c.last_body || t('Aún no hay mensajes', 'No messages yet'))}</div>
          ${c.assigned_name ? `<div class="muted" style="font-size:10.5px">→ ${esc(c.assigned_name)}</div>` : ''}
        </div>`).join('')
      : `<div class="empty">${t('No hay conversaciones con este filtro.', 'No conversations for this filter.')}</div>`;
    listEl.querySelectorAll('.conv-item').forEach((el) =>
      el.addEventListener('click', () => (location.hash = `#/conversations/${el.dataset.id}`))
    );
    return convs;
  }

  view.querySelectorAll('#conv-filters .seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.f;
      view.querySelectorAll('#conv-filters .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      loadList();
    })
  );
  view.querySelector('#channel-filter').addEventListener('change', (e) => { channel = e.target.value; loadList(); });

  const convs = await loadList();
  if (activeId) {
    const conv = convs.find((c) => c.id === activeId) || { id: activeId };
    await renderThread(view.querySelector('#thread'), conv, team, snippets);
  }
}

async function renderThread(threadEl, conv, team, snippets) {
  const messages = await api(`/conversations/${conv.id}/messages`);

  threadEl.innerHTML = `
    <div class="thread-head">
      <a href="#/conversations" class="btn secondary small mobile-only" style="margin-right:2px">←</a>
      <span class="avatar">${initials(conv)}</span> <span class="th-name">${esc(fullName(conv))}</span>
      <span class="muted th-email" style="font-weight:400;font-size:12px">${esc(conv.email || conv.phone || '')}</span>
      <div class="spacer"></div>
      <select class="input small" id="assign-sel" title="${t('Asignar', 'Assign')}" style="width:130px">
        <option value="">${t('Sin asignar', 'Unassigned')}</option>
        ${team.map((u) => `<option value="${u.id}" ${conv.assigned_user_id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
      </select>
      <button class="btn secondary small" id="ai-toggle">${conv.ai_paused ? '▶ IA' : 'IA'}</button>
      <a href="#/contacts/${conv.contact_id}" class="th-view">${t('Ver contacto', 'View contact')} →</a>
    </div>
    <div class="thread-msgs" id="msgs">
      ${messages
        .map(
          (m) => `<div class="msg ${m.direction}">
            ${m.subject ? `<strong>${esc(m.subject)}</strong><br>` : ''}${esc(m.body)}
            <div class="msg-meta">${m.channel.toUpperCase()} · ${fmtDate(m.created_at)}</div></div>`
        )
        .join('')}
    </div>
    <form class="thread-compose" id="compose">
      <div class="flex" style="gap:6px;width:100%;margin-bottom:6px">
        <select class="input" name="channel" style="width:120px">
          ${['sms', 'whatsapp', 'email', 'chat'].map((c) => `<option value="${c}" ${(conv.last_channel || 'sms') === c ? 'selected' : ''}>${c.toUpperCase()}</option>`).join('')}
        </select>
        <select class="input" id="snippet-sel" style="width:150px"><option value="">${t('Respuestas guardadas', 'Saved replies')}</option>${snippets.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select>
        <button type="button" class="btn secondary small" id="ai-suggest">✨ ${t('Sugerir', 'Suggest')}</button>
        <a href="#" id="manage-snippets" class="muted" style="font-size:11px;align-self:center">${t('Gestionar', 'Manage')}</a>
      </div>
      <textarea class="input" name="body" rows="2" placeholder="${t('Escribe un mensaje… ({{first_name}} funciona aquí)', 'Type a message… ({{first_name}} works here)')}" required></textarea>
      <button class="btn">${t('Enviar', 'Send')}</button>
    </form>`;

  const msgsEl = threadEl.querySelector('#msgs');
  msgsEl.scrollTop = msgsEl.scrollHeight;
  const bodyEl = threadEl.querySelector('[name=body]');

  threadEl.querySelector('#assign-sel').addEventListener('change', async (e) => {
    try {
      const res = await api(`/conversations/${conv.id}/assign`, { method: 'PUT', body: { user_id: e.target.value ? Number(e.target.value) : null } });
      conv.assigned_user_id = res.assigned_user_id;
      toast(t('Conversación asignada', 'Conversation assigned'));
    } catch (err) { toast(err.message, true); }
  });

  threadEl.querySelector('#snippet-sel').addEventListener('change', (e) => {
    const s = snippets.find((x) => x.id === Number(e.target.value));
    if (s) { bodyEl.value = bodyEl.value ? `${bodyEl.value}\n${s.body}` : s.body; bodyEl.focus(); }
    e.target.value = '';
  });

  threadEl.querySelector('#ai-suggest').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '…';
    try {
      const r = await api(`/conversations/${conv.id}/ai-suggest`, { method: 'POST', body: {} });
      bodyEl.value = r.reply || '';
      bodyEl.focus();
      if (r.provider === 'template') toast(t('Borrador básico (configura la IA para sugerencias inteligentes)', 'Basic draft (configure AI for smart suggestions)'));
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; btn.textContent = '✨ ' + t('Sugerir', 'Suggest'); }
  });

  threadEl.querySelector('#manage-snippets').addEventListener('click', (e) => { e.preventDefault(); snippetsModal(() => renderThread(threadEl, conv, team, snippets)); });

  threadEl.querySelector('#ai-toggle').addEventListener('click', async (e) => {
    try {
      const res = await api(`/conversations/${conv.id}/ai`, { method: 'PUT', body: { paused: !conv.ai_paused } });
      conv.ai_paused = res.ai_paused;
      e.currentTarget.textContent = conv.ai_paused ? '▶ IA' : 'IA';
      toast(conv.ai_paused ? t('IA pausada — tomas tú la conversación', 'AI paused — you are taking over') : t('IA reactivada', 'AI reactivated'));
    } catch (err) { toast(err.message, true); }
  });

  threadEl.querySelector('#compose').addEventListener('submit', async (e) => {
    e.preventDefault();
    const channel = e.target.channel.value;
    const body = e.target.body.value;
    try {
      await api(`/conversations/${conv.id}/messages`, {
        method: 'POST',
        body: { channel, body, subject: channel === 'email' ? t('Mensaje de tu equipo', 'Message from your team') : '' },
      });
      await renderThread(threadEl, conv, team, snippets);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// Manage saved replies.
async function snippetsModal(onChanged) {
  const { openModal, closeOverlay, formData } = await import('../ui.js');
  const snippets = await api('/snippets').catch(() => []);
  const modal = openModal(`<h2>${t('Respuestas guardadas', 'Saved replies')}</h2>
    <div id="sn-list">${snippets.length
      ? snippets.map((s) => `<div class="appt-row" data-id="${s.id}"><div style="flex:1"><strong>${esc(s.title)}</strong><div class="muted" style="font-size:12px">${esc((s.body || '').slice(0, 60))}</div></div>
          <button class="btn ghost small sn-del" data-id="${s.id}">✕</button></div>`).join('')
      : `<p class="muted">${t('Aún no hay respuestas guardadas.', 'No saved replies yet.')}</p>`}</div>
    <form id="sn-form" style="margin-top:10px">
      <label class="field"><span class="label">${t('Título', 'Title')}</span><input class="input" name="title" required></label>
      <label class="field"><span class="label">${t('Texto (admite {{first_name}})', 'Text ({{first_name}} works)')}</span><textarea class="input" name="body" rows="3"></textarea></label>
      <div class="modal-actions"><button type="button" class="btn secondary" id="c">${t('Cerrar', 'Close')}</button><button class="btn">+ ${t('Añadir', 'Add')}</button></div>
    </form>`);
  modal.querySelector('#c').addEventListener('click', closeOverlay);
  const reload = () => { closeOverlay(); snippetsModal(onChanged); onChanged && onChanged(); };
  modal.querySelectorAll('.sn-del').forEach((b) => b.addEventListener('click', async () => { await api(`/snippets/${b.dataset.id}`, { method: 'DELETE' }); reload(); }));
  modal.querySelector('#sn-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/snippets', { method: 'POST', body: formData(e.target) }); reload(); }
    catch (err) { toast(err.message, true); }
  });
}
