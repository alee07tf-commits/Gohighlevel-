import { api, state } from '../api.js';
import { esc, toast, openModal, closeOverlay, formData } from '../ui.js';
import { t } from '../i18n.js';

// Agency console (admin): cross-sub-account roll-up, SaaS plans, and
// white-label / signup settings.
export async function renderAgency(view) {
  if (state.user?.role !== 'admin') {
    view.innerHTML = `<div class="empty card" style="padding:40px">${t('Solo los administradores de la agencia pueden ver este panel.', 'Only agency administrators can view this panel.')}</div>`;
    return;
  }
  const [overview, plans, snaps, settings] = await Promise.all([
    api('/agency/overview'),
    api('/plans'),
    api('/snapshots'),
    api('/agency/settings'),
  ]);
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

  <div class="grid-2">
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">${t('Planes (SaaS)', 'Plans (SaaS)')}</div>
      <div class="card-body">
        <p class="muted" style="font-size:12px;margin-bottom:10px">${t('Lo que vendes a tus clientes. El plan carga su plantilla al registrarse y define el margen de rebilling por canal.', 'What you sell to your clients. The plan loads its template on signup and defines the rebilling margin per channel.')}</p>
        ${plans.length ? plans.map((p) => `<div class="appt-row"><div style="flex:1"><strong>${esc(p.name)}</strong>
          <div class="muted" style="font-size:12px">${money(p.price, p.currency)}/${p.interval === 'yearly' ? t('año', 'year') : t('mes', 'month')}${p.snapshot_id ? '' : t(' · sin plantilla', ' · no template')}${p.is_public ? '' : t(' · privado', ' · private')}</div></div>
          <button class="btn ghost small plan-del" data-id="${p.id}">✕</button></div>`).join('') : `<p class="muted">${t('Sin planes todavía.', 'No plans yet.')}</p>`}
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
      try {
        await api('/plans', {
          method: 'POST',
          body: { name: f.name, description: f.description, price: f.price, interval: f.interval, snapshot_id: f.snapshot_id || null, rebilling },
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
