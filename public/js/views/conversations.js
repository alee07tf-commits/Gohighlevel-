import { api } from '../api.js';
import { esc, toast, fmtDate, fullName, initials } from '../ui.js';

export async function renderConversations(view, rest = []) {
  const activeId = rest[0] ? Number(rest[0]) : null;
  const convs = await api('/conversations');

  view.innerHTML = `
  <div class="page-header"><h1>Conversations</h1>
    <span class="badge indigo">${convs.filter((c) => c.unread > 0).length} unread</span></div>
  <div class="conv-layout">
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
      <div class="empty" style="margin:auto"><div class="big">💬</div>Select a conversation</div>
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
      <span class="avatar">${initials(conv)}</span> ${esc(fullName(conv))}
      <span class="muted" style="font-weight:400;font-size:12px">${esc(conv.email || conv.phone || '')}</span>
      <a class="right" href="#/contacts/${conv.contact_id}">View contact →</a>
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
        <option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option>
      </select>
      <textarea class="input" name="body" rows="2" placeholder="Type a message… ({{first_name}} works here too)" required></textarea>
      <button class="btn">Send</button>
    </form>`;

  const msgs = threadEl.querySelector('#msgs');
  msgs.scrollTop = msgs.scrollHeight;

  threadEl.querySelector('#compose').addEventListener('submit', async (e) => {
    e.preventDefault();
    const channel = e.target.channel.value;
    const body = e.target.body.value;
    try {
      await api(`/conversations/${conv.id}/messages`, {
        method: 'POST',
        body: { channel, body, subject: channel === 'email' ? 'Message from your team' : '' },
      });
      await renderThread(threadEl, conv);
    } catch (err) {
      toast(err.message, true);
    }
  });
}
