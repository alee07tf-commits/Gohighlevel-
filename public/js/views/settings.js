import { api, state, loadMe, setLocation } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast } from '../ui.js';

export async function renderSettings(view) {
  const [locations, team, integrations, customFields] = await Promise.all([
    api('/locations'),
    api('/locations/team/users'),
    api('/system/integrations'),
    api('/custom-fields'),
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
            <div class="form-row">
              <label class="field"><span class="label">Color de marca (páginas públicas)</span>
                <input class="input" name="brand_color" type="color" value="${esc(current?.brand_color || '#4f46e5')}" style="height:38px;padding:3px"></label>
              <label class="field"><span class="label">Logo URL (opcional)</span>
                <input class="input" name="logo_url" value="${esc(current?.logo_url || '')}" placeholder="https://…/logo.png"></label>
            </div>
            <div class="card-title" style="padding:8px 0 6px">Briefing diario</div>
            <div class="form-row">
              <label class="field" style="flex:0 0 auto;display:flex;align-items:center;gap:8px;margin-top:20px">
                <input type="checkbox" name="briefing_enabled" ${current?.briefing_enabled ? 'checked' : ''}> Activado</label>
              <label class="field"><span class="label">Hora (UTC)</span>
                <input class="input" name="briefing_hour" type="number" min="0" max="23" value="${current?.briefing_hour ?? 8}"></label>
              <label class="field"><span class="label">Enviar a (email)</span>
                <input class="input" name="briefing_email" type="email" value="${esc(current?.briefing_email || '')}" placeholder="tu@email.com"></label>
            </div>
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
        <div class="appt-row"><div style="flex:1"><strong>Email</strong>
          <div class="muted" style="font-size:12px">${esc(integrations.recommended.email)}</div></div>${integBadge(integrations.email)}</div>
        <div class="appt-row"><div style="flex:1"><strong>SMS</strong>
          <div class="muted" style="font-size:12px">${esc(integrations.recommended.sms)}</div></div>${integBadge(integrations.sms)}</div>
        <div class="appt-row"><div style="flex:1"><strong>WhatsApp</strong>
          <div class="muted" style="font-size:12px">${esc(integrations.recommended.whatsapp)}</div></div>${integBadge(integrations.whatsapp)}</div>
        <div class="appt-row"><div style="flex:1"><strong>Pagos (Stripe)</strong>
          <div class="muted" style="font-size:12px">Stripe (stripe.com) — STRIPE_SECRET_KEY · webhook: /api/webhooks/stripe</div></div>${integBadge(integrations.payments)}</div>
        <div class="appt-row"><div style="flex:1"><strong>Prospección (Google)</strong>
          <div class="muted" style="font-size:12px">GOOGLE_PLACES_API_KEY (oficial, capa gratuita) o SERPER_API_KEY</div></div>${integBadge(integrations.prospecting)}</div>
        <div class="appt-row"><div style="flex:1"><strong>IA (Claude)</strong>
          <div class="muted" style="font-size:12px">${esc(integrations.recommended.ai)}</div></div>${integBadge(integrations.ai)}</div>
        <p class="muted" style="margin-top:10px;font-size:12px">
          En modo <strong>simulado</strong> todo funciona y queda registrado en el inbox, pero no sale al mundo real.
          Para activar un canal añade sus variables de entorno (en Vercel: Settings → Environment Variables) y redespliega.
          Webhook para SMS/WhatsApp entrantes de Twilio: <code class="inline">POST /api/webhooks/twilio/${state.locationId}</code>
        </p>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Conversation AI (chat + WhatsApp/SMS)</div>
      <div class="card-body">
        <label class="flex" style="margin-bottom:10px"><input type="checkbox" id="ai-agent-enabled" ${current?.ai_agent_enabled ? 'checked' : ''}>
          <strong>Responder automáticamente a los leads</strong></label>
        <p class="muted" style="font-size:12px;margin-bottom:8px">La IA responde con los datos del negocio y puede <strong>agendar citas</strong> en tu primer calendario. Puedes pausarla por conversación desde el inbox. Sin ANTHROPIC_API_KEY funciona en modo guiado (ofrece huecos y captura al lead).</p>
        <label class="field"><span class="label">Instrucciones extra para la IA (servicios, precios, horario…)</span>
          <textarea class="input" id="ai-agent-prompt" rows="3" placeholder="Ej: Somos una clínica dental. Limpieza 45€, blanqueamiento 250€. No damos precios de implantes por chat, ofrece cita.">${esc(current?.ai_agent_prompt || '')}</textarea></label>
        <label class="field" style="margin-top:8px"><span class="label">Missed-call text-back (SMS automático si no coges una llamada — requiere Twilio Voice apuntando a /api/webhooks/twilio-voice/${state.locationId})</span>
          <input class="input" id="missed-call-text" placeholder="Hola, vimos tu llamada. ¿En qué podemos ayudarte?" value="${esc(current?.missed_call_text || '')}"></label>
        <button class="btn" id="ai-agent-save">Guardar IA</button>
        <div class="card-title" style="padding:14px 0 6px">Widget de chat para la web del cliente</div>
        <p class="muted" style="font-size:12px">Pega esto antes de <code class="inline">&lt;/body&gt;</code> en cualquier web y tendrá el chat con IA conectado a este CRM:</p>
        <code class="inline" id="widget-snippet" style="display:block;margin-top:6px;padding:10px;user-select:all;font-size:11px">&lt;script src="${location.origin}/widget.js" data-location="${state.locationId}"&gt;&lt;/script&gt;</code>
        <button class="btn secondary small" id="copy-snippet" style="margin-top:8px">Copiar snippet</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Campos personalizados</div>
      <div class="card-body">
        ${customFields.length
          ? customFields.map((f) => `<div class="appt-row"><div style="flex:1"><strong>${esc(f.name)}</strong>
              <span class="muted" style="font-size:12px">· ${f.type} · merge: <code class="inline">{{${esc(f.key)}}}</code></span></div>
              <button class="btn ghost small del-cf" data-id="${f.id}">✕</button></div>`).join('')
          : '<p class="muted">Sin campos personalizados aún.</p>'}
        <div class="flex" style="margin-top:10px">
          <input class="input" id="cf-name" placeholder="Nombre del campo (ej. Cumpleaños)">
          <select class="input" id="cf-type" style="width:110px"><option value="text">texto</option><option value="number">número</option><option value="date">fecha</option></select>
          <button class="btn secondary" id="cf-add">+ Añadir</button>
        </div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Snapshots (plantillas de sub-cuenta)</div>
      <div class="card-body">
        <p class="muted" style="margin-bottom:10px;font-size:12px">Exporta toda la configuración de esta sub-cuenta (pipelines, workflows, funnels, calendarios, plantillas y campos) e impórtala en otra para desplegar un cliente nuevo en minutos.</p>
        <div class="flex">
          <button class="btn secondary" id="snap-export">Exportar snapshot</button>
          <button class="btn secondary" id="snap-import">Importar snapshot</button>
          <input type="file" id="snap-file" accept=".json,application/json" style="display:none">
        </div>
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
              ${u.role !== 'admin' ? `<button class="btn secondary small assign-user" data-id="${u.id}" data-name="${esc(u.name)}">Sub-cuentas</button>` : ''}
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
      const body = formData(e.target);
      body.briefing_enabled = e.target.briefing_enabled.checked;
      await api(`/locations/${current.id}`, { method: 'PUT', body });
      await loadMe();
      toast('Profile saved');
      renderSettings(view);
    } catch (err) {
      toast(err.message, true);
    }
  });

  view.querySelector('#ai-agent-save').addEventListener('click', async () => {
    await api(`/locations/${current.id}`, {
      method: 'PUT',
      body: {
        ai_agent_enabled: view.querySelector('#ai-agent-enabled').checked,
        ai_agent_prompt: view.querySelector('#ai-agent-prompt').value,
        missed_call_text: view.querySelector('#missed-call-text').value,
      },
    });
    toast('Conversation AI guardada');
  });
  view.querySelector('#copy-snippet').addEventListener('click', () => {
    navigator.clipboard.writeText(view.querySelector('#widget-snippet').textContent);
    toast('Snippet copiado');
  });
  view.querySelector('#cf-add').addEventListener('click', async () => {
    const name = view.querySelector('#cf-name').value.trim();
    if (!name) return toast('Escribe el nombre del campo', true);
    await api('/custom-fields', { method: 'POST', body: { name, type: view.querySelector('#cf-type').value } });
    toast('Campo creado');
    renderSettings(view);
  });
  view.querySelectorAll('.del-cf').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar campo personalizado?')) return;
      await api(`/custom-fields/${b.dataset.id}`, { method: 'DELETE' });
      renderSettings(view);
    })
  );
  view.querySelector('#snap-export').addEventListener('click', async () => {
    const snap = await api('/snapshots/export');
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `leadflow-snapshot-${(current?.name || 'cuenta').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  view.querySelector('#snap-import').addEventListener('click', () => view.querySelector('#snap-file').click());
  view.querySelector('#snap-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const snap = JSON.parse(await file.text());
      if (!confirm(`¿Importar snapshot "${snap.name || 'sin nombre'}" en la sub-cuenta actual (${current?.name})?`)) return;
      const result = await api('/snapshots/import', { method: 'POST', body: snap });
      toast(`Importado: ${Object.entries(result.imported).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    } catch (err) {
      toast(err.message, true);
    }
    e.target.value = '';
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

  view.querySelectorAll('.assign-user').forEach((b) =>
    b.addEventListener('click', async () => {
      const assigned = await api(`/locations/team/users/${b.dataset.id}/locations`);
      const modal = openModal(`
        <h2>Acceso de ${esc(b.dataset.name)}</h2>
        <p class="muted" style="margin-bottom:10px">Sin marcar ninguna, el miembro accede a todas. Marcando algunas, solo verá esas sub-cuentas.</p>
        ${locations.map((l) => `<label class="flex" style="margin:6px 0"><input type="checkbox" class="al-cb" value="${l.id}" ${assigned.includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`).join('')}
        <div class="modal-actions">
          <button class="btn secondary" onclick="document.getElementById('modal-root').innerHTML=''">Cancelar</button>
          <button class="btn" id="al-save">Guardar acceso</button>
        </div>`);
      modal.querySelector('#al-save').addEventListener('click', async () => {
        const ids = [...modal.querySelectorAll('.al-cb:checked')].map((cb) => Number(cb.value));
        await api(`/locations/team/users/${b.dataset.id}/locations`, { method: 'PUT', body: { location_ids: ids } });
        document.getElementById('modal-root').innerHTML = '';
        toast('Acceso actualizado');
      });
    })
  );
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
