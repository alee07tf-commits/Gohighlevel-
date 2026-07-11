import { api, state } from '../api.js';
import { esc, toast, openModal, closeOverlay, formData } from '../ui.js';
import { t } from '../i18n.js';

// Central "servicios de la plataforma": configured ONCE by the agency and
// cascaded to every sub-account (env → agency → sub-account). These are the
// managed services a client uses with zero setup (SMS, WhatsApp, Email, AI),
// plus agency-wide payments defaults. `primary` is the field whose
// presence means "configured".
const CENTRAL = [
  { key: 'twilio', label: t('SMS y WhatsApp (Twilio)', 'SMS & WhatsApp (Twilio)'), managed: true, primary: 'account_sid', fields: [
    { k: 'account_sid', label: 'Account SID (AC…)' },
    { k: 'auth_token', label: 'Auth Token', secret: true },
    { k: 'from_number', label: t('Número SMS (from)', 'SMS number (from)'), placeholder: '+34…' },
    { k: 'whatsapp_from', label: 'WhatsApp from', placeholder: 'whatsapp:+14155238886' } ] },
  { key: 'email', label: 'Email', managed: true, primary: 'api_key', fields: [
    { k: 'vendor', label: t('Proveedor', 'Provider'), type: 'select', opts: ['resend', 'sendgrid'] },
    { k: 'api_key', label: t('API key', 'API key'), secret: true },
    { k: 'mail_from', label: t('Remitente (from)', 'Sender (from)'), placeholder: t('tu@dominio.com', 'you@domain.com') } ] },
  { key: 'ai', label: t('IA (Claude) — motor de TODAS las funciones IA', 'AI (Claude) — powers ALL AI features'), managed: true, primary: 'api_key', fields: [
    { k: 'api_key', label: 'Anthropic API key', secret: true },
    { k: 'model', label: t('Modelo (opcional)', 'Model (optional)'), placeholder: 'claude-sonnet-5' } ] },
  { key: 'stripe', label: t('Pagos (Stripe)', 'Payments (Stripe)'), primary: 'secret_key', fields: [{ k: 'secret_key', label: 'Secret key (sk_…)', secret: true }] },
];

function centralFieldValue(cfg, k) {
  const f = (cfg?.fields || []).find((x) => x.key === k);
  return f ? f.value : '';
}
function centralBlock(p, cfg) {
  const configured = (cfg?.fields || []).some((f) => f.key === p.primary && f.set);
  const badge = configured
    ? `<span class="badge green">${t('Activo para todos', 'Active for all')}</span>`
    : `<span class="badge amber">${t('Sin configurar', 'Not configured')}</span>`;
  return `<div class="integ-block" data-provider="${p.key}" style="border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:12px">
    <div class="flex" style="justify-content:space-between;align-items:center">
      <strong>${esc(p.label)}${p.managed ? ` <span class="muted" style="font-weight:400;font-size:11px">· ${t('servicio incluido', 'included service')}</span>` : ''}</strong> ${badge}</div>
    ${p.fields.map((f) => {
      const val = centralFieldValue(cfg, f.key);
      if (f.type === 'select')
        return `<label class="field" style="margin-top:8px"><span class="label">${esc(f.label)}</span>
          <select class="input integ-f" data-k="${f.key}"><option value="">—</option>${f.opts.map((o) => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
      return `<label class="field" style="margin-top:8px"><span class="label">${esc(f.label)}</span>
        <input class="input integ-f" data-k="${f.key}" ${f.secret ? 'type="password"' : ''} value="${esc(val)}" placeholder="${esc(f.placeholder || (f.secret ? '••••' : ''))}"></label>`;
    }).join('')}
    <div class="flex" style="margin-top:8px;gap:8px">
      <button class="btn secondary small integ-save">${t('Guardar', 'Save')}</button>
      ${configured ? `<button class="btn ghost small integ-clear">${t('Vaciar', 'Clear')}</button>` : ''}
    </div>
  </div>`;
}

// Agency console (admin): cross-sub-account roll-up, SaaS plans, and
// white-label / signup settings.
export async function renderAgency(view) {
  if (state.user?.role !== 'admin') {
    view.innerHTML = `<div class="empty card" style="padding:40px">${t('Solo los administradores de la agencia pueden ver este panel.', 'Only agency administrators can view this panel.')}</div>`;
    return;
  }
  const CENTRAL_KEYS = CENTRAL.map((p) => p.key);
  const [overview, plans, snaps, settings, ...centralCfgs] = await Promise.all([
    api('/agency/overview'),
    api('/plans'),
    api('/snapshots'),
    api('/agency/settings'),
    ...CENTRAL_KEYS.map((k) => api(`/integrations/agency/${k}`)),
  ]);
  const centralCfg = Object.fromEntries(CENTRAL_KEYS.map((k, i) => [k, centralCfgs[i]]));
  const money = (n, c = 'EUR') => `${Number(n || 0).toFixed(2)} ${c}`;
  const signupUrl = settings.slug ? `${location.origin}/signup/${settings.slug}` : null;

  view.innerHTML = `
  <div class="page-header"><h1>${t('Agencia', 'Agency')}</h1></div>
  <div class="stat-grid" style="margin-bottom:16px">
    <div class="stat-card"><div class="stat-label">${t('Sub-cuentas', 'Sub-accounts')}</div><div class="stat-value">${overview.totals.sub_accounts}</div></div>
    <div class="stat-card"><div class="stat-label">${t('MRR (planes activos)', 'MRR (active plans)')}</div><div class="stat-value">${money(overview.totals.mrr)}</div></div>
    <div class="stat-card"><div class="stat-label">${t('Revenue cobrado', 'Revenue collected')}</div><div class="stat-value">${money(overview.totals.revenue)}</div></div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-title">${t('Sub-cuentas', 'Sub-accounts')}</div>
    <div class="card-body" style="overflow-x:auto">
      <table class="table"><thead><tr><th>${t('Negocio', 'Business')}</th><th>${t('Plan', 'Plan')}</th><th>${t('Estado', 'Status')}</th><th>${t('Contactos', 'Contacts')}</th><th>${t('Pipeline', 'Pipeline')}</th><th>${t('Revenue', 'Revenue')}</th><th>${t('Wallet', 'Wallet')}</th><th>${t('Uso mes', 'Monthly usage')}</th></tr></thead>
      <tbody>
        ${overview.locations.map((l) => `<tr>
          <td><strong>${esc(l.name)}</strong><div class="muted" style="font-size:11px">${esc(l.company || '')}</div></td>
          <td>${l.subscription?.plan_name ? esc(l.subscription.plan_name) : '<span class="muted">—</span>'}</td>
          <td>${l.subscription ? `<span class="badge ${l.subscription.status === 'active' ? 'green' : 'amber'}">${esc(l.subscription.status)}</span>` : '<span class="muted">—</span>'}</td>
          <td>${l.contacts}</td>
          <td>${money(l.pipeline_value)}</td>
          <td>${money(l.revenue)}</td>
          <td>${money(l.wallet_balance)}</td>
          <td>${money(l.usage_this_month)}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-title">${t('Servicios de la plataforma', 'Platform services')}</div>
    <div class="card-body">
      <p class="muted" style="font-size:12.5px;margin-bottom:12px">${t('Configúralos <strong>una sola vez aquí</strong> y quedan disponibles para <strong>todos tus clientes</strong> sin que ellos pongan nada. Cada cliente puede sobrescribirlos en su sub-cuenta si trae su propia cuenta. Los secretos se guardan cifrados.', 'Set them up <strong>once here</strong> and they become available to <strong>all your clients</strong> with no setup on their side. Each client can override them in their sub-account if they bring their own. Secrets are stored encrypted.')}</p>
      <div class="grid-cards">${CENTRAL.map((p) => centralBlock(p, centralCfg[p.key])).join('')}</div>
    </div>
  </div>

  <div class="grid-2">
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">${t('Planes (SaaS)', 'Plans (SaaS)')}</div>
      <div class="card-body">
        <p class="muted" style="font-size:12px;margin-bottom:10px">${t('Lo que vendes a tus clientes. El plan carga su plantilla al registrarse y define el margen de rebilling por canal.', 'What you sell to your clients. The plan loads its template on signup and defines the rebilling margin per channel.')}</p>
        ${plans.length ? plans.map((p) => {
          const fk = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', ai: t('IA', 'AI') };
          const feats = Object.entries(fk).filter(([k]) => p.features && p.features[k]).map(([, l]) => l);
          return `<div class="appt-row"><div style="flex:1"><strong>${esc(p.name)}</strong>
          <div class="muted" style="font-size:12px">${money(p.price, p.currency)}/${p.interval === 'yearly' ? t('año', 'year') : t('mes', 'month')}${p.snapshot_id ? '' : t(' · sin plantilla', ' · no template')}${p.is_public ? '' : t(' · privado', ' · private')}</div>
          ${feats.length ? `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${feats.map((l) => `<span class="tag" style="font-size:10px">${esc(l)}</span>`).join('')}</div>` : ''}</div>
          <button class="btn ghost small plan-del" data-id="${p.id}">✕</button></div>`;
        }).join('') : `<p class="muted">${t('Sin planes todavía.', 'No plans yet.')}</p>`}
        <button class="btn secondary" id="plan-new" style="margin-top:12px">${t('+ Crear plan', '+ Create plan')}</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">${t('Registro self-serve y marca', 'Self-serve signup and branding')}</div>
      <div class="card-body">
        <form id="agency-form">
          <label class="field"><span class="label">${t('Identificador de registro (URL)', 'Signup identifier (URL)')}</span>
            <input class="input" name="slug" value="${esc(settings.slug || '')}" placeholder="${t('mi-agencia', 'my-agency')}"></label>
          ${signupUrl ? `<p class="muted" style="font-size:12px;margin:-6px 0 10px">${t('Página pública', 'Public page')}: <a href="${signupUrl}" target="_blank">${esc(signupUrl)} ↗</a></p>` : `<p class="muted" style="font-size:12px;margin:-6px 0 10px">${t('Pon un identificador para activar tu página de registro.', 'Set an identifier to activate your signup page.')}</p>`}
          <label class="field"><span class="label">${t('Titular de la página', 'Page headline')}</span>
            <input class="input" name="signup_headline" value="${esc(settings.signup_headline || '')}" placeholder="${t('Crea tu cuenta en minutos', 'Create your account in minutes')}"></label>
          <div class="form-row">
            <label class="field"><span class="label">${t('Color de marca', 'Brand color')}</span>
              <input class="input" name="brand_color" type="color" value="${esc(settings.brand_color || '#6d5ef5')}" style="height:38px;padding:3px"></label>
            <label class="field"><span class="label">${t('Logo URL', 'Logo URL')}</span>
              <input class="input" name="logo_url" value="${esc(settings.logo_url || '')}" placeholder="https://…/logo.png"></label>
          </div>
          <button class="btn">${t('Guardar marca', 'Save branding')}</button>
        </form>
      </div>
    </div>
  </div>`;

  view.querySelector('#agency-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/agency/settings', { method: 'PUT', body: formData(e.target) });
      toast(t('Ajustes de agencia guardados', 'Agency settings saved'));
      renderAgency(view);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Central platform-service integrations (agency scope → cascades to all).
  view.querySelectorAll('.integ-block').forEach((block) => {
    const provider = block.dataset.provider;
    block.querySelector('.integ-save').addEventListener('click', async () => {
      const body = {};
      block.querySelectorAll('.integ-f').forEach((i) => {
        const v = i.value.trim();
        if (v && !v.startsWith('••••')) body[i.dataset.k] = v;
      });
      try {
        await api(`/integrations/agency/${provider}`, { method: 'PUT', body });
        toast(t('Servicio guardado para toda la agencia', 'Service saved for the whole agency'));
        renderAgency(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
    const clr = block.querySelector('.integ-clear');
    if (clr)
      clr.addEventListener('click', async () => {
        if (!confirm(t('¿Vaciar este servicio para toda la agencia?', 'Clear this service for the whole agency?'))) return;
        try {
          await api(`/integrations/agency/${provider}`, { method: 'PUT', body: { clear: true } });
          toast(t('Servicio vaciado', 'Service cleared'));
          renderAgency(view);
        } catch (err) {
          toast(err.message, true);
        }
      });
  });

  view.querySelectorAll('.plan-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('¿Eliminar este plan?', 'Delete this plan?'))) return;
      await api(`/plans/${b.dataset.id}`, { method: 'DELETE' });
      renderAgency(view);
    })
  );

  view.querySelector('#plan-new').addEventListener('click', () => {
    const modal = openModal(`
      <h2>${t('Nuevo plan', 'New plan')}</h2>
      <form id="plan-form">
        <label class="field"><span class="label">${t('Nombre', 'Name')}</span><input class="input" name="name" required placeholder="Plan Pro"></label>
        <div class="form-row">
          <label class="field"><span class="label">${t('Precio', 'Price')}</span><input class="input" name="price" type="number" min="0" step="0.01" value="97"></label>
          <label class="field"><span class="label">${t('Intervalo', 'Interval')}</span><select class="input" name="interval"><option value="monthly">${t('mensual', 'monthly')}</option><option value="yearly">${t('anual', 'yearly')}</option></select></label>
        </div>
        <label class="field"><span class="label">${t('Plantilla (snapshot) a cargar', 'Template (snapshot) to load')}</span>
          <select class="input" name="snapshot_id"><option value="">${t('— ninguna —', '— none —')}</option>
          ${snaps.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
        <label class="field"><span class="label">${t('Descripción', 'Description')}</span><input class="input" name="description"></label>
        <div class="card-title" style="padding:6px 0">${t('Funciones incluidas (el cliente las usa; el backend ya está conectado)', 'Included features (the client uses them; the backend is already connected)')}</div>
        <div class="form-row" style="flex-wrap:wrap;gap:10px">
          ${[['email', 'Email'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['ai', t('IA', 'AI')]].map(([k, label]) =>
            `<label class="flex" style="gap:6px;align-items:center"><input type="checkbox" name="ft_${k}" checked> ${esc(label)}</label>`).join('')}
        </div>
        <div class="card-title" style="padding:6px 0">${t('Rebilling (multiplicador por canal — vacío = no cobrar)', 'Rebilling (multiplier per channel — empty = no charge)')}</div>
        <div class="form-row">
          <label class="field"><span class="label">${t('SMS ×', 'SMS ×')}</span><input class="input" name="rb_sms" type="number" step="0.1" placeholder="2"></label>
          <label class="field"><span class="label">${t('WhatsApp ×', 'WhatsApp ×')}</span><input class="input" name="rb_whatsapp" type="number" step="0.1" placeholder="2"></label>
          <label class="field"><span class="label">${t('Email ×', 'Email ×')}</span><input class="input" name="rb_email" type="number" step="0.1" placeholder="3"></label>
          <label class="field"><span class="label">${t('IA ×', 'AI ×')}</span><input class="input" name="rb_ai" type="number" step="0.1" placeholder="2"></label>
        </div>
        <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Crear plan', 'Create plan')}</button></div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#plan-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const rebilling = {};
      for (const k of ['sms', 'whatsapp', 'email', 'ai']) if (f[`rb_${k}`]) rebilling[k] = Number(f[`rb_${k}`]);
      // Checkboxes only appear in formData when checked → default false.
      const features = {};
      for (const k of ['email', 'sms', 'whatsapp', 'ai']) features[k] = f[`ft_${k}`] != null;
      try {
        await api('/plans', {
          method: 'POST',
          body: { name: f.name, description: f.description, price: f.price, interval: f.interval, snapshot_id: f.snapshot_id || null, rebilling, features },
        });
        closeOverlay();
        toast(t('Plan creado', 'Plan created'));
        renderAgency(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}
