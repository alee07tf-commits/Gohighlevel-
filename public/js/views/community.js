import { api, state } from '../api.js';
import { esc, toast, fmtDate, initials } from '../ui.js';
import { t } from '../i18n.js';

export async function renderCommunity(view, rest = []) {
  if (rest[0]) return renderThread(view, Number(rest[0]));
  const posts = await api('/community');

  view.innerHTML = `
  <div class="page-header"><h1>${t('Comunidad', 'Community')}</h1></div>
  <div class="grid-2" style="align-items:start">
    <div>
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <form id="post-form">
          <input class="input" name="title" placeholder="${t('Título (opcional)', 'Title (optional)')}" style="margin-bottom:8px">
          <textarea class="input" name="body" rows="3" placeholder="${t('Comparte algo con tu comunidad…', 'Share something with your community…')}" required></textarea>
          <button class="btn" style="margin-top:8px">${t('Publicar', 'Post')}</button>
        </form>
      </div></div>
      ${posts.length
        ? posts.map((p) => `<div class="card" style="margin-bottom:12px"><div class="card-body">
            <div class="flex" style="gap:8px;align-items:center;margin-bottom:6px">
              <span class="avatar">${initials({ first_name: p.author || '?' })}</span>
              <div style="flex:1"><strong>${esc(p.author || t('Anónimo', 'Anonymous'))}</strong>
                <div class="muted" style="font-size:11px">${fmtDate(p.created_at)}</div></div>
              ${(p.user_id === state.user?.id || state.user?.role === 'admin') ? `<button class="btn ghost small del-post" data-id="${p.id}">✕</button>` : ''}
            </div>
            ${p.title ? `<div style="font-weight:600;margin-bottom:4px">${esc(p.title)}</div>` : ''}
            <div style="white-space:pre-wrap;line-height:1.55">${esc(p.body)}</div>
            <a class="btn ghost small" href="#/community/${p.id}" style="margin-top:8px">💬 ${p.comments} ${t('comentario(s)', 'comment(s)')}</a>
          </div></div>`).join('')
        : `<div class="empty card" style="padding:40px"><div class="big">👥</div>${t('Aún no hay publicaciones. ¡Sé el primero!', 'No posts yet. Be the first!')}</div>`}
    </div>
    <div class="card"><div class="card-body">
      <div class="card-title">${t('Sobre la comunidad', 'About the community')}</div>
      <p class="muted" style="font-size:13px">${t('Un espacio para que tu equipo y tus clientes compartan avances, dudas y novedades. Como los grupos de GoHighLevel.', 'A space for your team and clients to share progress, questions and news. Like GoHighLevel groups.')}</p>
    </div></div>
  </div>`;

  view.querySelector('#post-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api('/community', { method: 'POST', body: f }); renderCommunity(view); }
    catch (err) { toast(err.message, true); }
  });
  view.querySelectorAll('.del-post').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('¿Eliminar esta publicación?', 'Delete this post?'))) return;
    await api(`/community/${b.dataset.id}`, { method: 'DELETE' }); renderCommunity(view);
  }));
}

async function renderThread(view, id) {
  const p = await api(`/community/${id}`);
  view.innerHTML = `
  <div class="page-header"><a href="#/community" class="btn ghost small">← ${t('Comunidad', 'Community')}</a></div>
  <div class="card" style="max-width:720px"><div class="card-body">
    <div class="flex" style="gap:8px;align-items:center;margin-bottom:8px">
      <span class="avatar">${initials({ first_name: p.author || '?' })}</span>
      <div><strong>${esc(p.author || '—')}</strong><div class="muted" style="font-size:11px">${fmtDate(p.created_at)}</div></div>
    </div>
    ${p.title ? `<h2 style="margin-bottom:6px">${esc(p.title)}</h2>` : ''}
    <div style="white-space:pre-wrap;line-height:1.6;margin-bottom:16px">${esc(p.body)}</div>
    <div class="card-title" style="padding:8px 0 4px">${p.comments.length} ${t('comentarios', 'comments')}</div>
    <div id="comments">${p.comments.map((c) => `<div class="appt-row"><div style="flex:1"><strong style="font-size:13px">${esc(c.author || '—')}</strong>
      <div style="white-space:pre-wrap">${esc(c.body)}</div><div class="muted" style="font-size:11px">${fmtDate(c.created_at)}</div></div>
      ${(c.user_id === state.user?.id || state.user?.role === 'admin') ? `<button class="btn ghost small del-c" data-id="${c.id}">✕</button>` : ''}</div>`).join('') || `<p class="muted">${t('Sin comentarios aún.', 'No comments yet.')}</p>`}</div>
    <form id="comment-form" style="margin-top:12px;display:flex;gap:8px">
      <input class="input" name="body" placeholder="${t('Escribe un comentario…', 'Write a comment…')}" required style="flex:1">
      <button class="btn">${t('Enviar', 'Send')}</button>
    </form>
  </div></div>`;

  view.querySelector('#comment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/community/${id}/comments`, { method: 'POST', body: { body: e.target.body.value } }); renderThread(view, id); }
    catch (err) { toast(err.message, true); }
  });
  view.querySelectorAll('.del-c').forEach((b) => b.addEventListener('click', async () => {
    await api(`/community/comments/${b.dataset.id}`, { method: 'DELETE' }); renderThread(view, id);
  }));
}
