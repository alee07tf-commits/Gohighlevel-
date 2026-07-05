import { api, state, loadMe, setLocation } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast } from '../ui.js';

// Editable integration providers (per sub-account, inheriting agency → server).
const PROVIDERS = [
  { key: 'email', label: 'Email', fields: [
    { k: 'vendor', label: 'Proveedor', type: 'select', opts: ['resend', 'sendgrid'] },
    { k: 'api_key', label: 'API key', secret: true },
    { k: 'mail_from', label: 'Remitente (from)', placeholder: 'tu@dominio.com' } ] },
  { key: 'twilio', label: 'SMS / WhatsApp (Twilio)', fields: [
    { k: 'account_sid', label: 'Account SID (AC…)' },
    { k: 'auth_token', label: 'Auth Token', secret: true },
    { k: 'from_number', label: 'Número SMS (from)', placeholder: '+34…' },
    { k: 'whatsapp_from', label: 'WhatsApp from', placeholder: 'whatsapp:+14155238886' } ] },
  { key: 'stripe', label: 'Pagos (Stripe)', fields: [{ k: 'secret_key', label: 'Secret key (sk_…)', secret: true }] },
  { key: 'ai', label: 'IA (Claude)', fields: [
    { k: 'api_key', label: 'Anthropic API key', secret: true },
    { k: 'model', label: 'Modelo (opcional)', placeholder: 'claude-sonnet-5' } ] },
  { key: 'places', label: 'Prospección (Google)', fields: [
    { k: 'google_places_api_key', label: 'Google Places API key', secret: true },
    { k: 'serper_api_key', label: 'Serper API key (alternativa)', secret: true } ] },
];

function sourceBadge(src) {
  const m = { estancia: ['green', 'esta sub-cuenta'], agencia: ['indigo', 'agencia'], plataforma: ['gray', 'servidor'], none: ['amber', 'sin configurar'] };
  const [c, t] = m[src] || m.none;
  return `<span class="badge ${c}">${t}</span>`;
}
function fieldValue(cfg, k) {
  const f = (cfg?.fields || []).find((x) => x.key === k);
  return f ? f.value : '';
}
function providerBlock(p, cfg) {
  return `<div class="integ-block" data-provider="${p.key}" style="border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:12px;margin-bottom:10px">
    <div class="flex" style="justify-content:space-between;align-items:center"><strong>${esc(p.label)}</strong> ${sourceBadge(cfg?.source)}</div>
    ${p.fields.map((f) => {
      const val = fieldValue(cfg, f.key);
      if (f.type === 'select')
        return `<label class="field" style="margin-top:8px"><span class="label">${esc(f.label)}</span>
          <select class="input integ-f" data-k="${f.key}"><option value="">—</option>${f.opts.map((o) => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
      return `<label class="field" style="margin-top:8px"><span class="label">${esc(f.label)}</span>
        <input class="input integ-f" data-k="${f.key}" ${f.secret ? 'type="password"' : ''} value="${esc(val)}" placeholder="${esc(f.placeholder || (f.secret ? '••••' : ''))}"></label>`;
    }).join('')}
    <div class="flex" style="margin-top:8px;gap:8px">
      <button class="btn secondary small integ-save">Guardar</button>
      ${cfg?.has_override ? '<button class="btn ghost small integ-inherit">Heredar de agencia</button>' : ''}
      ${p.key === 'email' ? '<button class="btn ghost small integ-test" style="margin-left:auto">Enviar prueba</button>' : ''}
    </div>
  </div>`;
}

export async function renderSettings(view) {
  const [locations, team, integrations, customFields, snapshotList, customVals, integCfg] = await Promise.all([
    api('/locations'),
    api('/locations/team/users'),
    api('/system/integrations'),
    api('/custom-fields'),
    api('/snapshots'),
    api('/custom-values'),
    api('/integrations'),
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
      <div class="card-title">Integraciones de esta sub-cuenta</div>
      <div class="card-body">
        <p class="muted" style="margin-bottom:10px;font-size:12px">Cada sub-cuenta puede tener sus propias claves. Si las dejas vacías, hereda las de la <strong>agencia</strong> y, si tampoco hay, las del <strong>servidor</strong>. Los secretos se guardan cifrados.</p>
        ${PROVIDERS.map((p) => providerBlock(p, integCfg[p.key])).join('')}
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
      <div class="card-title">Valores del negocio (Custom Values)</div>
      <div class="card-body">
        <p class="muted" style="margin-bottom:10px;font-size:12px">Rellena estos datos una vez. Las plantillas (funnels, emails, SMS) usan <code class="inline">{{custom_values.clave}}</code> y se rellenan solos para este cliente.</p>
        ${customVals.length
          ? customVals.map((v) => `<div class="flex cv-row" style="margin:6px 0;gap:8px" data-id="${v.id}">
              <div style="flex:0 0 42%"><strong style="font-size:13px">${esc(v.label || v.key)}</strong>
                <div class="muted" style="font-size:11px"><code class="inline">{{custom_values.${esc(v.key)}}}</code></div></div>
              <input class="input cv-val" value="${esc(v.value || '')}" placeholder="—" style="flex:1">
              <button class="btn ghost small del-cv" data-id="${v.id}" title="Eliminar">✕</button></div>`).join('')
          : '<p class="muted">Aún no hay valores. Se crean solos al dar de alta una sub-cuenta con plantilla.</p>'}
        <div class="flex" style="margin-top:10px;gap:8px">
          <input class="input" id="cv-label" placeholder="Etiqueta (ej. Horario)" style="flex:0 0 42%">
          <input class="input" id="cv-value" placeholder="Valor" style="flex:1">
          <button class="btn secondary" id="cv-add">+ Añadir</button>
        </div>
        <button class="btn" id="cv-save" style="margin-top:10px">Guardar valores</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Plantillas (Snapshots)</div>
      <div class="card-body">
        <p class="muted" style="margin-bottom:10px;font-size:12px">Guarda la configuración de una sub-cuenta como plantilla reutilizable. La marcada <strong>por defecto</strong> se carga automáticamente al crear una sub-cuenta nueva.</p>
        ${snapshotList.length
          ? snapshotList.map((s) => {
              const total = Object.values(s.counts || {}).reduce((a, b) => a + b, 0);
              return `<div class="appt-row"><div style="flex:1"><strong>${esc(s.name)}</strong>
                ${s.is_default ? '<span class="badge indigo" style="margin-left:6px">por defecto</span>' : ''}
                <div class="muted" style="font-size:11px">${esc(s.description || '')} · ${total} elementos</div></div>
                ${!s.is_default ? `<button class="btn ghost small snap-default" data-id="${s.id}">Hacer por defecto</button>` : ''}
                <button class="btn secondary small snap-apply" data-id="${s.id}" data-name="${esc(s.name)}">Aplicar aquí</button>
                <button class="btn ghost small snap-del" data-id="${s.id}">✕</button></div>`;
            }).join('')
          : '<p class="muted">Sin plantillas todavía.</p>'}
        <button class="btn secondary" id="snap-create" style="margin-top:12px">+ Crear plantilla desde esta sub-cuenta</button>
        <div class="flex" style="margin-top:10px">
          <button class="btn ghost small" id="snap-export">Exportar JSON</button>
          <button class="btn ghost small" id="snap-import">Importar JSON</button>
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

  // Per-sub-account integration credentials.
  view.querySelectorAll('.integ-block').forEach((block) => {
    const provider = block.dataset.provider;
    block.querySelector('.integ-save').addEventListener('click', async () => {
      const body = {};
      block.querySelectorAll('.integ-f').forEach((i) => {
        const v = i.value.trim();
        if (v && !v.startsWith('••••')) body[i.dataset.k] = v;
      });
      try {
        await api(`/integrations/${provider}`, { method: 'PUT', body });
        toast('Integración guardada');
        renderSettings(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
    const inh = block.querySelector('.integ-inherit');
    if (inh)
      inh.addEventListener('click', async () => {
        await api(`/integrations/${provider}`, { method: 'PUT', body: { use_agency: true } });
        toast('Ahora hereda de la agencia');
        renderSettings(view);
      });
    const testBtn = block.querySelector('.integ-test');
    if (testBtn)
      testBtn.addEventListener('click', async () => {
        const to = prompt('Enviar email de prueba a:', state.user?.email || '');
        if (!to) return;
        testBtn.disabled = true;
        testBtn.textContent = 'Enviando…';
        try {
          const r = await api('/integrations/test-email', { method: 'POST', body: { to } });
          if (r.provider === 'simulated')
            toast('Modo simulado: guarda una API key de email para enviar de verdad', true);
          else if (r.ok) toast(`Email de prueba enviado a ${r.to} vía ${r.provider}`);
          else toast(`Fallo al enviar: ${r.error || 'error desconocido'}`, true);
        } catch (err) {
          toast(err.message, true);
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = 'Enviar prueba';
        }
      });
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
  // ---- Custom values ----
  view.querySelector('#cv-save').addEventListener('click', async () => {
    try {
      await Promise.all(
        [...view.querySelectorAll('.cv-row')].map((row) =>
          api(`/custom-values/${row.dataset.id}`, { method: 'PUT', body: { value: row.querySelector('.cv-val').value } })
        )
      );
      toast('Valores guardados');
    } catch (err) {
      toast(err.message, true);
    }
  });
  view.querySelector('#cv-add').addEventListener('click', async () => {
    const label = view.querySelector('#cv-label').value.trim();
    if (!label) return toast('Escribe una etiqueta', true);
    await api('/custom-values', { method: 'POST', body: { label, value: view.querySelector('#cv-value').value } });
    toast('Valor añadido');
    renderSettings(view);
  });
  view.querySelectorAll('.del-cv').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este valor?')) return;
      await api(`/custom-values/${b.dataset.id}`, { method: 'DELETE' });
      renderSettings(view);
    })
  );

  // ---- Snapshot library ----
  view.querySelector('#snap-create').addEventListener('click', async () => {
    const name = prompt(`Nombre de la plantilla (desde "${current?.name}"):`);
    if (!name) return;
    const makeDefault = confirm('¿Marcarla como plantilla por defecto (se cargará al crear sub-cuentas nuevas)?');
    try {
      const r = await api('/snapshots', { method: 'POST', body: { name, from_location_id: current.id, is_default: makeDefault } });
      toast(`Plantilla creada: ${Object.values(r.counts).reduce((a, b) => a + b, 0)} elementos`);
      renderSettings(view);
    } catch (err) {
      toast(err.message, true);
    }
  });
  view.querySelectorAll('.snap-default').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/snapshots/${b.dataset.id}`, { method: 'PUT', body: { is_default: true } });
      toast('Plantilla por defecto actualizada');
      renderSettings(view);
    })
  );
  view.querySelectorAll('.snap-apply').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`¿Aplicar la plantilla "${b.dataset.name}" en la sub-cuenta actual (${current?.name})? Se añadirá su contenido.`)) return;
      try {
        const r = await api(`/snapshots/${b.dataset.id}/apply`, { method: 'POST', body: { location_id: current.id } });
        toast(`Aplicado: ${Object.entries(r.applied).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') || 'nada nuevo'}`);
        renderSettings(view);
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
  view.querySelectorAll('.snap-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta plantilla?')) return;
      await api(`/snapshots/${b.dataset.id}`, { method: 'DELETE' });
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

  view.querySelector('#new-loc').addEventListener('click', () => {
    const defaultSnap = snapshotList.find((s) => s.is_default);
    const modal = openModal(`
      <h2>Nueva sub-cuenta (cliente)</h2>
      <p class="muted" style="margin-bottom:10px;font-size:12px">Al crearla se cargará automáticamente la plantilla elegida y se rellenarán sus datos del negocio. Todo listo para trabajar.</p>
      <form id="loc-new-form">
        <label class="field"><span class="label">Nombre del negocio *</span><input class="input" name="name" required></label>
        <div class="form-row">
          <label class="field"><span class="label">Teléfono</span><input class="input" name="phone"></label>
          <label class="field"><span class="label">Email</span><input class="input" name="email" type="email"></label>
        </div>
        <label class="field"><span class="label">Sitio web</span><input class="input" name="website"></label>
        <label class="field"><span class="label">Plantilla a cargar</span>
          <select class="input" name="snapshot_id">
            <option value="">${defaultSnap ? `Por defecto — ${esc(defaultSnap.name)}` : 'Ninguna (vacía)'}</option>
            ${snapshotList.map((s) => `<option value="${s.id}">${esc(s.name)}${s.is_default ? ' (por defecto)' : ''}</option>`).join('')}
            <option value="0">Ninguna (vacía)</option>
          </select></label>
        <div class="modal-actions">
          <button type="button" class="btn secondary" id="cancel">Cancelar</button>
          <button class="btn">Crear sub-cuenta</button>
        </div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#loc-new-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      if (body.snapshot_id === '') delete body.snapshot_id;
      else body.snapshot_id = Number(body.snapshot_id);
      const btn = e.target.querySelector('button.btn:not(.secondary)');
      btn.disabled = true;
      btn.textContent = 'Creando…';
      try {
        const loc = await api('/locations', { method: 'POST', body });
        const p = loc.provisioned || {};
        const summary = Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ');
        await loadMe();
        setLocation(loc.id);
        closeOverlay();
        toast(`Sub-cuenta creada${summary ? ` · ${summary}` : ''}`);
        location.reload();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = 'Crear sub-cuenta';
      }
    });
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
