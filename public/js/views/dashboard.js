import { api } from '../api.js';
import { esc, fmtMoney, fmtDate, fullName, openModal, toast, icon } from '../ui.js';
import { t } from '../i18n.js';

export async function renderDashboard(view) {
  const data = await api('/dashboard');
  const s = data.stats;

  view.innerHTML = `
  <div class="page-greeting">${esc(window.__greeting || t('Hola', 'Hi'))} — ${s.unread_conversations > 0 ? t(`${s.unread_conversations} conversación(es) sin leer`, `${s.unread_conversations} unread conversation(s)`) : t('todo al día', 'all caught up')} · ${t(`${s.upcoming_appointments} cita(s) próximas`, `${s.upcoming_appointments} upcoming appointment(s)`)}</div>
  <div class="page-header"><h1>${t('Panel', 'Dashboard')}</h1>
    <div class="spacer"></div>
    <button class="btn secondary" id="report-btn">${t('Informe del cliente', 'Client report')}</button>
  </div>
  <div class="hero-banner">
    <div class="hb-label">◎ ${t('Pipeline abierto', 'Open pipeline')}</div>
    <div class="hb-value">${fmtMoney(s.pipeline_value)}</div>
    <div class="hb-sub">${t(`${s.open_opportunities} oportunidades abiertas en el pipeline`, `${s.open_opportunities} open opportunities in the pipeline`)}</div>
    <div class="hb-badges">
      <span class="hb-badge">↗ ${t(`+${s.contacts_this_week} contactos esta semana`, `+${s.contacts_this_week} contacts this week`)}</span>
      <span class="hb-badge">${t(`${s.form_submissions_week} formularios (7 días)`, `${s.form_submissions_week} forms (7 days)`)}</span>
    </div>
    <div class="hb-cards">
      <div class="hb-card"><div class="l">${t('Ganado', 'Won')}</div><div class="v">${fmtMoney(s.won_value)}</div><div class="s">${t('oportunidades cerradas', 'closed opportunities')}</div></div>
      <div class="hb-card"><div class="l">${t('Contactos', 'Contacts')}</div><div class="v">${s.contacts}</div><div class="s">${t('en esta sub-cuenta', 'in this sub-account')}</div></div>
      <div class="hb-card"><div class="l">${t('Citas próximas', 'Upcoming')}</div><div class="v">${s.upcoming_appointments}</div><div class="s">${t('confirmadas', 'confirmed')}</div></div>
      <div class="hb-card"><div class="l">${t('Sin leer', 'Unread')}</div><div class="v">${s.unread_conversations}</div><div class="s">${t('conversaciones', 'conversations')}</div></div>
    </div>
  </div>
  ${
    data.hotLeads?.length
      ? `<div class="card" style="margin-bottom:18px;border-left:4px solid #f59e0b"><div class="card-body">
          <strong>${t('Leads calientes — llámalos hoy', 'Hot leads — call them today')}</strong>
          <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">
          ${data.hotLeads
            .map(
              (l) => `<a class="btn secondary small" href="#/contacts/${l.id}">
                ${esc(fullName(l))} <span class="badge amber">${l.score} pts</span></a>`
            )
            .join('')}
          </div></div></div>`
      : ''
  }
  <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
    <div class="stat"><div class="stat-label">${t('Contactos nuevos (7 días)', 'New contacts (7 days)')}</div><div class="stat-value">${s.contacts_this_week}</div></div>
    <div class="stat"><div class="stat-label">${t('Formularios (7 días)', 'Forms (7 days)')}</div><div class="stat-value">${s.form_submissions_week}</div></div>
    <div class="stat"><div class="stat-label">${t('Oportunidades abiertas', 'Open opportunities')}</div><div class="stat-value">${s.open_opportunities}</div></div>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-title">${t('Actividad reciente', 'Recent Activity')}</div>
      <div class="card-body">
        ${
          data.recentActivity.length
            ? data.recentActivity
                .map(
                  (a) => `<div class="timeline-item">
                    <div class="t-icon">${icon(a.type || 'note', 14)}</div>
                    <div><div>${esc(a.description)} ${a.first_name ? `— <a href="#/contacts/${a.contact_id}">${esc(fullName(a))}</a>` : ''}</div>
                    <div class="t-time">${fmtDate(a.created_at)}</div></div></div>`
                )
                .join('')
            : `<div class="empty">${t('Sin actividad todavía', 'No activity yet')}</div>`
        }
      </div>
    </div>
    <div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">${t('Próximas citas', 'Upcoming Appointments')}</div>
        <div class="card-body" style="padding:0">
          ${
            data.upcoming.length
              ? data.upcoming
                  .map(
                    (a) => `<div class="appt-row">
                      <div class="appt-time">${fmtDate(a.starts_at)}</div>
                      <div><strong>${esc(a.title)}</strong><div class="muted" style="font-size:12px">${esc(fullName(a))}</div></div></div>`
                  )
                  .join('')
              : `<div class="empty">${t('Sin citas próximas', 'No upcoming appointments')}</div>`
          }
        </div>
      </div>
      <div class="card">
        <div class="card-title">${t('Contactos recientes', 'Newest Contacts')}</div>
        <div class="card-body" style="padding:0">
          ${
            data.recentContacts.length
              ? data.recentContacts
                  .map(
                    (c) => `<div class="appt-row">
                      <div><a href="#/contacts/${c.id}"><strong>${esc(fullName(c))}</strong></a>
                      <div class="muted" style="font-size:12px">${esc(c.email || c.phone || '')} · ${esc(c.source)}</div></div></div>`
                  )
                  .join('')
              : `<div class="empty">${t('Sin contactos todavía', 'No contacts yet')}</div>`
          }
        </div>
      </div>
    </div>
  </div>`;

  view.querySelector('#report-btn').addEventListener('click', async () => {
    const reports = await api('/reports');
    const modal = openModal(`
      <h2>${t('Informe para el cliente', 'Client report')}</h2>
      <p class="muted" style="margin-bottom:12px">${t('Genera un informe white-label con los resultados del periodo y compártelo con tu cliente por link o email.', 'Generate a white-label report with the period results and share it with your client by link or email.')}</p>
      <div class="flex">
        <select class="input" id="rep-days" style="width:170px">
          <option value="7">${t('Últimos 7 días', 'Last 7 days')}</option>
          <option value="30" selected>${t('Últimos 30 días', 'Last 30 days')}</option>
          <option value="90">${t('Últimos 90 días', 'Last 90 days')}</option>
        </select>
        <button class="btn" id="rep-gen">${t('Generar informe', 'Generate report')}</button>
      </div>
      <div id="rep-result" style="margin-top:14px"></div>
      <div class="card-title" style="padding:12px 0 6px">${t('Informes anteriores', 'Previous reports')}</div>
      <div id="rep-list">
        ${
          reports.length
            ? reports
                .map(
                  (r) => `<div class="appt-row"><div style="flex:1">${t(`Últimos ${r.period_days} días`, `Last ${r.period_days} days`)}
                    <div class="muted" style="font-size:11px">${fmtDate(r.created_at)}</div></div>
                    <a class="btn secondary small" href="/r/${esc(r.token)}" target="_blank">${t('Ver', 'View')} ↗</a></div>`
                )
                .join('')
            : `<p class="muted">${t('Aún no hay informes.', 'No reports yet.')}</p>`
        }
      </div>`);
    modal.querySelector('#rep-gen').addEventListener('click', async () => {
      const btn = modal.querySelector('#rep-gen');
      btn.disabled = true;
      btn.textContent = t('Generando…', 'Generating…');
      try {
        const rep = await api('/reports/generate', {
          method: 'POST',
          body: { period_days: Number(modal.querySelector('#rep-days').value) },
        });
        modal.querySelector('#rep-result').innerHTML = `
          <div class="block-item">
            <div class="b-head"><span>${t('Informe listo', 'Report ready')}</span></div>
            <p style="font-size:13px;white-space:pre-wrap">${esc(rep.narrative.slice(0, 220))}…</p>
            <div class="flex" style="margin-top:10px">
              <a class="btn secondary small" href="${esc(rep.url)}" target="_blank">${t('Abrir', 'Open')} ↗</a>
              <button class="btn secondary small" id="rep-copy">${t('Copiar link', 'Copy link')}</button>
              <button class="btn small" id="rep-send">${t('Enviar por email', 'Send by email')}</button>
            </div>
          </div>`;
        modal.querySelector('#rep-copy').addEventListener('click', () => {
          navigator.clipboard.writeText(location.origin + rep.url);
          toast(t('Link copiado', 'Link copied'));
        });
        modal.querySelector('#rep-send').addEventListener('click', async () => {
          const email = prompt(t('Email del cliente:', 'Client email:'), '');
          if (!email) return;
          const sent = await api(`/reports/${rep.id}/send`, { method: 'POST', body: { email } });
          toast(sent.delivery.includes('simulated') ? t('Guardado (configura email real en Ajustes para envío)', 'Saved (set up real email in Settings to send)') : t('Informe enviado', 'Report sent'));
        });
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = t('Generar informe', 'Generate report');
      }
    });
  });
}
