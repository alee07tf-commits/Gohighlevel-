import { api, state } from '../api.js';
import { esc, toast, openModal, closeOverlay, formData } from '../ui.js';

// Agency console (admin): cross-sub-account roll-up, SaaS plans, and
// white-label / signup settings.
export async function renderAgency(view) {
  if (state.user?.role !== 'admin') {
    view.innerHTML = '<div class="empty card" style="padding:40px">Solo los administradores de la agencia pueden ver este panel.</div>';
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
  <div class="page-header"><h1>Agencia</h1></div>
  <div class="stat-grid" style="margin-bottom:16px">
    <div class="stat-card"><div class="stat-label">Sub-cuentas</div><div class="stat-value">${overview.totals.sub_accounts}</div></div>
    <div class="stat-card"><div class="stat-label">MRR (planes activos)</div><div class="stat-value">${money(overview.totals.mrr)}</div></div>
    <div class="stat-card"><div class="stat-label">Revenue cobrado</div><div class="stat-value">${money(overview.totals.revenue)}</div></div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-title">Sub-cuentas</div>
    <div class="card-body" style="overflow-x:auto">
      <table class="table"><thead><tr><th>Negocio</th><th>Plan</th><th>Estado</th><th>Contactos</th><th>Pipeline</th><th>Revenue</th><th>Wallet</th><th>Uso mes</th></tr></thead>
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
      <div class="card-title">Planes (SaaS)</div>
      <div class="card-body">
        <p class="muted" style="font-size:12px;margin-bottom:10px">Lo que vendes a tus clientes. El plan carga su plantilla al registrarse y define el margen de rebilling por canal.</p>
        ${plans.length ? plans.map((p) => `<div class="appt-row"><div style="flex:1"><strong>${esc(p.name)}</strong>
          <div class="muted" style="font-size:12px">${money(p.price, p.currency)}/${p.interval === 'yearly' ? 'año' : 'mes'}${p.snapshot_id ? '' : ' · sin plantilla'}${p.is_public ? '' : ' · privado'}</div></div>
          <button class="btn ghost small plan-del" data-id="${p.id}">✕</button></div>`).join('') : '<p class="muted">Sin planes todavía.</p>'}
        <button class="btn secondary" id="plan-new" style="margin-top:12px">+ Crear plan</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Registro self-serve y marca</div>
      <div class="card-body">
        <form id="agency-form">
          <label class="field"><span class="label">Identificador de registro (URL)</span>
            <input class="input" name="slug" value="${esc(settings.slug || '')}" placeholder="mi-agencia"></label>
          ${signupUrl ? `<p class="muted" style="font-size:12px;margin:-6px 0 10px">Página pública: <a href="${signupUrl}" target="_blank">${esc(signupUrl)} ↗</a></p>` : '<p class="muted" style="font-size:12px;margin:-6px 0 10px">Pon un identificador para activar tu página de registro.</p>'}
          <label class="field"><span class="label">Titular de la página</span>
            <input class="input" name="signup_headline" value="${esc(settings.signup_headline || '')}" placeholder="Crea tu cuenta en minutos"></label>
          <div class="form-row">
            <label class="field"><span class="label">Color de marca</span>
              <input class="input" name="brand_color" type="color" value="${esc(settings.brand_color || '#6d5ef5')}" style="height:38px;padding:3px"></label>
            <label class="field"><span class="label">Logo URL</span>
              <input class="input" name="logo_url" value="${esc(settings.logo_url || '')}" placeholder="https://…/logo.png"></label>
          </div>
          <button class="btn">Guardar marca</button>
        </form>
      </div>
    </div>
  </div>`;

  view.querySelector('#agency-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/agency/settings', { method: 'PUT', body: formData(e.target) });
      toast('Ajustes de agencia guardados');
      renderAgency(view);
    } catch (err) {
      toast(err.message, true);
    }
  });

  view.querySelectorAll('.plan-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este plan?')) return;
      await api(`/plans/${b.dataset.id}`, { method: 'DELETE' });
      renderAgency(view);
    })
  );

  view.querySelector('#plan-new').addEventListener('click', () => {
    const modal = openModal(`
      <h2>Nuevo plan</h2>
      <form id="plan-form">
        <label class="field"><span class="label">Nombre</span><input class="input" name="name" required placeholder="Plan Pro"></label>
        <div class="form-row">
          <label class="field"><span class="label">Precio</span><input class="input" name="price" type="number" min="0" step="0.01" value="97"></label>
          <label class="field"><span class="label">Intervalo</span><select class="input" name="interval"><option value="monthly">mensual</option><option value="yearly">anual</option></select></label>
        </div>
        <label class="field"><span class="label">Plantilla (snapshot) a cargar</span>
          <select class="input" name="snapshot_id"><option value="">— ninguna —</option>
          ${snaps.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
        <label class="field"><span class="label">Descripción</span><input class="input" name="description"></label>
        <div class="card-title" style="padding:6px 0">Rebilling (multiplicador por canal — vacío = no cobrar)</div>
        <div class="form-row">
          <label class="field"><span class="label">SMS ×</span><input class="input" name="rb_sms" type="number" step="0.1" placeholder="2"></label>
          <label class="field"><span class="label">WhatsApp ×</span><input class="input" name="rb_whatsapp" type="number" step="0.1" placeholder="2"></label>
          <label class="field"><span class="label">Email ×</span><input class="input" name="rb_email" type="number" step="0.1" placeholder="3"></label>
          <label class="field"><span class="label">IA ×</span><input class="input" name="rb_ai" type="number" step="0.1" placeholder="2"></label>
        </div>
        <div class="modal-actions"><button type="button" class="btn secondary" id="cancel">Cancelar</button><button class="btn">Crear plan</button></div>
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
        toast('Plan creado');
        renderAgency(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}
