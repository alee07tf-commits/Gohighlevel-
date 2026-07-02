import { api, state, loadMe, setLocation } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast } from '../ui.js';

export async function renderSettings(view) {
  const [locations, team, integrations] = await Promise.all([
    api('/locations'),
    api('/locations/team/users'),
    api('/system/integrations'),
  ]);
  const current = locations.find((l) => l.id === state.locationId) || locations[0];

  const integBadge = (v) =>
    v === 'simulated' || v === false
      ? '<span class="badge amber">simulado</span>'
      : `<span class="badge green">${v === true ? 'activo' : esc(v)}</span>`;

  view.innerHTML = `
  <div class="page-header"><h1>Settings</h1></div>
  <div class="grid-2">
    <div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Sub-Account Profile — ${esc(current?.name || '')}</div>
        <div class="card-body">
          <form id="loc-form">
            <label class="field"><span class="label">Name</span><input class="input" name="name" value="${esc(current?.name || '')}" required></label>
            <label class="field"><span class="label">Company</span><input class="input" name="company" value="${esc(current?.company || '')}"></label>
            <div class="form-row">
              <label class="field"><span class="label">Phone</span><input class="input" name="phone" value="${esc(current?.phone || '')}"></label>
              <label class="field"><span class="label">Email</span><input class="input" name="email" value="${esc(current?.email || '')}"></label>
            </div>
            <label class="field"><span class="label">Website</span><input class="input" name="website" value="${esc(current?.website || '')}"></label>
            <button class="btn">Save Profile</button>
          </form>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Sub-Accounts (${locations.length})</div>
        <div class="card-body">
          ${locations
            .map(
              (l) => `<div class="appt-row"><div style="flex:1"><strong>${esc(l.name)}</strong>
                <div class="muted" style="font-size:12px">${esc(l.company || '')}</div></div>
                ${l.id === state.locationId ? '<span class="badge indigo">current</span>' : `<button class="btn secondary small switch-loc" data-id="${l.id}">Switch</button>`}
              </div>`
            )
            .join('')}
          <button class="btn secondary" id="new-loc" style="margin-top:12px">+ New Sub-Account</button>
        </div>
      </div>
    </div>
    <div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Integraciones (canales de envío)</div>
      <div class="card-body">
        <div class="appt-row"><div style="flex:1"><strong>📧 Email</strong>
          <div class="muted" style="font-size:12px">${esc(integrations.recommended.email)}</div></div>${integBadge(integrations.email)}</div>
        <div class="appt-row"><div style="flex:1"><strong>📱 SMS</strong>
          <div class="muted" style="font-size:12px">${esc(integrations.recommended.sms)}</div></div>${integBadge(integrations.sms)}</div>
        <div class="appt-row"><div style="flex:1"><strong>💬 WhatsApp</strong>
          <div class="muted" style="font-size:12px">${esc(integrations.recommended.whatsapp)}</div></div>${integBadge(integrations.whatsapp)}</div>
        <div class="appt-row"><div style="flex:1"><strong>✨ IA (Claude)</strong>
          <div class="muted" style="font-size:12px">${esc(integrations.recommended.ai)}</div></div>${integBadge(integrations.ai)}</div>
        <p class="muted" style="margin-top:10px;font-size:12px">
          En modo <strong>simulado</strong> todo funciona y queda registrado en el inbox, pero no sale al mundo real.
          Para activar un canal añade sus variables de entorno (en Vercel: Settings → Environment Variables) y redespliega.
          Webhook para SMS/WhatsApp entrantes de Twilio: <code class="inline">POST /api/webhooks/twilio/${state.locationId}</code>
        </p>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Agency Team</div>
      <div class="card-body">
        ${team
          .map(
            (u) => `<div class="appt-row">
              <div style="flex:1"><strong>${esc(u.name)}</strong>
                <div class="muted" style="font-size:12px">${esc(u.email)}</div></div>
              <span class="badge ${u.role === 'admin' ? 'indigo' : 'gray'}">${u.role}</span>
              ${u.id !== state.user.id ? `<button class="btn ghost small del-user" data-id="${u.id}">✕</button>` : ''}
            </div>`
          )
          .join('')}
        <button class="btn secondary" id="new-user" style="margin-top:12px">+ Invite Team Member</button>
      </div>
    </div>
    </div>
  </div>`;

  view.querySelector('#loc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/locations/${current.id}`, { method: 'PUT', body: formData(e.target) });
      await loadMe();
      toast('Profile saved');
      renderSettings(view);
    } catch (err) {
      toast(err.message, true);
    }
  });

  view.querySelectorAll('.switch-loc').forEach((b) =>
    b.addEventListener('click', () => {
      setLocation(b.dataset.id);
      location.reload();
    })
  );

  view.querySelector('#new-loc').addEventListener('click', async () => {
    const name = prompt('Sub-account name (e.g. client business name):');
    if (!name) return;
    try {
      const loc = await api('/locations', { method: 'POST', body: { name } });
      await loadMe();
      setLocation(loc.id);
      toast('Sub-account created');
      location.reload();
    } catch (err) {
      toast(err.message, true);
    }
  });

  view.querySelector('#new-user').addEventListener('click', () => {
    const modal = openModal(`
      <h2>Invite Team Member</h2>
      <form id="user-form">
        <label class="field"><span class="label">Name</span><input class="input" name="name" required></label>
        <label class="field"><span class="label">Email</span><input class="input" name="email" type="email" required></label>
        <label class="field"><span class="label">Temporary password</span><input class="input" name="password" required minlength="6"></label>
        <label class="field"><span class="label">Role</span><select class="input" name="role">
          <option value="member">Member</option><option value="admin">Admin</option></select></label>
        <div class="modal-actions">
          <button type="button" class="btn secondary" id="cancel">Cancel</button>
          <button class="btn">Create User</button>
        </div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/locations/team/users', { method: 'POST', body: formData(e.target) });
        closeOverlay();
        toast('Team member added');
        renderSettings(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  view.querySelectorAll('.del-user').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Remove this team member?')) return;
      try {
        await api(`/locations/team/users/${b.dataset.id}`, { method: 'DELETE' });
        renderSettings(view);
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
}
