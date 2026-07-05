import { api } from '../api.js';
import { esc, toast, fmtDate, fullName, initials } from '../ui.js';

export async function renderConversations(view, rest = []) {
  const activeId = rest[0] ? Number(rest[0]) : null;
  const convs = await api('/conversations');

  view.innerHTML = `
  <div class="page-header"><h1>Conversations</h1>
    <span class="badge indigo">${convs.filter((c) => c.unread > 0).length} unread</span></div>
  <div class="conv-layout ${activeId ? 'thread-open' : ''}">
    <div class="conv-list">
      ${
        convs.length
          ? convs
              .map(
                (c) => `<div class="conv-item ${c.id === activeId ? 'active' : ''}" data-id="${c.id}">
                  <div class="c-name">${esc(fullName(c))} ${c.unread ? '<span class="unread-dot"></span>' : ''}</div>
                  <div class="c-preview">${c.last_channel ? `[${c.last_channel}] ` : ''}${esc(c.last_body || 'No messages yet')}</div>
                </div>`
              )
              .join('')
          : '<div class="empty">No conversations yet.<br>Message a contact to start one.</div>'
      }
    </div>
    <div class="conv-thread" id="thread">
      <div class="empty" style="margin:auto"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>Select a conversation</div>
    </div>
  </div>`;

  view.querySelectorAll('.conv-item').forEach((el) =>
    el.addEventListener('click', () => (location.hash = `#/conversations/${el.dataset.id}`))
  );

  if (activeId) {
    const conv = convs.find((c) => c.id === activeId);
    if (conv) await renderThread(view.querySelector('#thread'), conv);
  }
}

async function renderThread(threadEl, conv) {
  const messages = await api(`/conversations/${conv.id}/messages`);

  threadEl.innerHTML = `
    <div class="thread-head">
      <a href="#/conversations" class="btn secondary small mobile-only" style="margin-right:2px">←</a>
      <span class="avatar">${initials(conv)}</span> <span class="th-name">${esc(fullName(conv))}</span>
      <span class="muted th-email" style="font-weight:400;font-size:12px">${esc(conv.email || conv.phone || '')}</span>
      <button class="btn secondary small right" id="ai-toggle">${conv.ai_paused ? '▶ IA' : 'IA'}</button>
      <a href="#/contacts/${conv.contact_id}" class="th-view">Ver contacto →</a>
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
      <select class="input" name="channel" style="width:120px">
        ${['sms', 'whatsapp', 'email', 'chat'].map((c) => `<option value="${c}" ${(conv.last_channel || 'sms') === c ? 'selected' : ''}>${c.toUpperCase()}</option>`).join('')}
      </select>
      <textarea class="input" name="body" rows="2" placeholder="Escribe un mensaje… ({{first_name}} funciona aquí)" required></textarea>
      <button class="btn">Enviar</button>
    </form>`;

  const msgs = threadEl.querySelector('#msgs');
  msgs.scrollTop = msgs.scrollHeight;

  threadEl.querySelector('#ai-toggle').addEventListener('click', async () => {
    const res = await api(`/conversations/${conv.id}/ai`, { method: 'PUT', body: { paused: !conv.ai_paused } });
    conv.ai_paused = res.ai_paused;
    toast(conv.ai_paused ? 'IA pausada — tomas tú la conversación' : 'IA reactivada');
    renderThread(threadEl, conv);
  });

  threadEl.querySelector('#compose').addEventListener('submit', async (e) => {
    e.preventDefault();
    const channel = e.target.channel.value;
    const body = e.target.body.value;
    try {
      await api(`/conversations/${conv.id}/messages`, {
        method: 'POST',
        body: { channel, body, subject: channel === 'email' ? 'Mensaje de tu equipo' : '' },
      });
      await renderThread(threadEl, conv);
    } catch (err) {
      toast(err.message, true);
    }
  });
}
