import { api } from '../api.js';
import { esc, fmtMoney } from '../ui.js';
import { t } from '../i18n.js';

// Prettifies a raw contact source ("funnel:teeth-whitening", "booking:free-consult",
// "manual") into a readable, localized label.
function sourceLabel(src) {
  if (!src || src === 'manual') return t('Manual', 'Manual');
  const [kind, ...rest] = src.split(':');
  const name = rest.join(':');
  const kinds = {
    funnel: t('Funnel', 'Funnel'),
    booking: t('Reserva', 'Booking'),
    form: t('Formulario', 'Form'),
    chat: 'Chat',
    import: t('Importado', 'Import'),
    api: 'API',
  };
  const label = kinds[kind] || kind;
  return name ? `${label}: ${name}` : label;
}

export async function renderAnalytics(view, rest = []) {
  const days = Number(sessionStorage.getItem('lf_attr_days')) || 90;
  const data = await api(`/analytics/attribution?days=${days}`);
  const T = data.totals;

  const periodOpt = (d, label) =>
    `<option value="${d}" ${d === days ? 'selected' : ''}>${label}</option>`;

  view.innerHTML = `
  <div class="page-header">
    <div><h1>${t('Informes', 'Analytics')}</h1>
      <p class="muted" style="font-size:13px">${t('De dónde vienen tus leads y qué fuente genera ingresos — para demostrar resultados.', 'Where your leads come from and which source drives revenue — to prove results.')}</p></div>
    <div class="spacer"></div>
    <select class="input" id="attr-days" style="width:170px">
      ${periodOpt(30, t('Últimos 30 días', 'Last 30 days'))}
      ${periodOpt(90, t('Últimos 90 días', 'Last 90 days'))}
      ${periodOpt(365, t('Último año', 'Last year'))}
    </select>
  </div>

  <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:16px">
    <div class="stat"><div class="stat-label">${t('Contactos', 'Contacts')}</div><div class="stat-value">${T.contacts}</div></div>
    <div class="stat"><div class="stat-label">${t('Citas', 'Appointments')}</div><div class="stat-value">${T.appointments}</div></div>
    <div class="stat"><div class="stat-label">${t('Ventas ganadas', 'Deals won')}</div><div class="stat-value">${T.won}</div></div>
    <div class="stat"><div class="stat-label">${t('Ingresos ganados', 'Won revenue')}</div><div class="stat-value">${fmtMoney(T.won_value)}</div></div>
    <div class="stat"><div class="stat-label">${t('Pipeline abierto', 'Open pipeline')}</div><div class="stat-value">${fmtMoney(T.pipeline_value)}</div></div>
  </div>

  <div class="card">
    <div class="card-title">${t('Atribución por fuente', 'Attribution by source')}</div>
    <div class="card-body" style="overflow-x:auto">
      ${
        data.rows.length
          ? `<table class="table"><thead><tr>
              <th>${t('Fuente', 'Source')}</th>
              <th>${t('Contactos', 'Contacts')}</th>
              <th>${t('Citas', 'Appts')}</th>
              <th>${t('% reserva', 'Book %')}</th>
              <th>${t('Ganadas', 'Won')}</th>
              <th>${t('% cierre', 'Close %')}</th>
              <th>${t('Ingresos', 'Revenue')}</th>
              <th>${t('Pipeline', 'Pipeline')}</th>
            </tr></thead><tbody>
            ${data.rows
              .map(
                (r) => `<tr>
                  <td><strong>${esc(sourceLabel(r.source))}</strong></td>
                  <td>${r.contacts}</td>
                  <td>${r.appointments}</td>
                  <td>${r.booking_rate}%</td>
                  <td>${r.won}</td>
                  <td>${r.close_rate}%</td>
                  <td><strong>${fmtMoney(r.won_value)}</strong></td>
                  <td class="muted">${fmtMoney(r.pipeline_value)}</td>
                </tr>`
              )
              .join('')}
            </tbody></table>`
          : `<div class="empty">${t('Aún no hay datos en este periodo. Captura leads con funnels y reservas para ver la atribución.', 'No data in this period yet. Capture leads with funnels and bookings to see attribution.')}</div>`
      }
    </div>
  </div>`;

  view.querySelector('#attr-days').addEventListener('change', (e) => {
    sessionStorage.setItem('lf_attr_days', e.target.value);
    renderAnalytics(view, rest);
  });
}
