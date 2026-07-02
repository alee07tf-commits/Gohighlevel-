import { api } from '../api.js';
import { esc, fmtMoney, fmtDate, fullName, openModal, closeOverlay, toast } from '../ui.js';

const ICONS = { contact: '👤', tag: '🏷️', note: '📝', appointment: '📅', form: '📩', automation: '⚙️', opportunity: '🎯' };

export async function renderDashboard(view) {
  const data = await api('/dashboard');
  const s = data.stats;

  view.innerHTML = `
  <div class="page-header"><h1>Dashboard</h1>
    <div class="spacer"></div>
    <button class="btn secondary" id="report-btn">📊 Informe del cliente</button>
  </div>
  ${
    data.hotLeads?.length
      ? `<div class="card" style="margin-bottom:18px;border-left:4px solid #f59e0b"><div class="card-body">
          <strong>🔥 Leads calientes — llámalos hoy</strong>
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
  <div class="stats-grid">
    <div class="stat"><div class="stat-label">Contacts</div><div class="stat-value">${s.contacts}</div>
      <div class="stat-sub">+${s.contacts_this_week} this week</div></div>
    <div class="stat"><div class="stat-label">Pipeline Value</div><div class="stat-value">${fmtMoney(s.pipeline_value)}</div>
      <div class="stat-sub">${s.open_opportunities} open deals</div></div>
    <div class="stat"><div class="stat-label">Revenue Won</div><div class="stat-value">${fmtMoney(s.won_value)}</div></div>
    <div class="stat"><div class="stat-label">Upcoming Appointments</div><div class="stat-value">${s.upcoming_appointments}</div></div>
    <div class="stat"><div class="stat-label">Unread Conversations</div><div class="stat-value">${s.unread_conversations}</div></div>
    <div class="stat"><div class="stat-label">Form Submissions</div><div class="stat-value">${s.form_submissions_week}</div>
      <div class="stat-sub">last 7 days</div></div>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-title">Recent Activity</div>
      <div class="card-body">
        ${
          data.recentActivity.length
            ? data.recentActivity
                .map(
                  (a) => `<div class="timeline-item">
                    <div class="t-icon">${ICONS[a.type] || '•'}</div>
                    <div><div>${esc(a.description)} ${a.first_name ? `— <a href="#/contacts/${a.contact_id}">${esc(fullName(a))}</a>` : ''}</div>
                    <div class="t-time">${fmtDate(a.created_at)}</div></div></div>`
                )
                .join('')
            : '<div class="empty">No activity yet</div>'
        }
      </div>
    </div>
    <div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Upcoming Appointments</div>
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
              : '<div class="empty">No upcoming appointments</div>'
          }
        </div>
      </div>
      <div class="card">
        <div class="card-title">Newest Contacts</div>
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
              : '<div class="empty">No contacts yet</div>'
          }
        </div>
      </div>
    </div>
  </div>`;

  view.querySelector('#report-btn').addEventListener('click', async () => {
    const reports = await api('/reports');
    const modal = openModal(`
      <h2>📊 Informe para el cliente</h2>
      <p class="muted" style="margin-bottom:12px">Genera un informe white-label con los resultados del periodo y compártelo con tu cliente por link o email.</p>
      <div class="flex">
        <select class="input" id="rep-days" style="width:170px">
          <option value="7">Últimos 7 días</option>
          <option value="30" selected>Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
        </select>
        <button class="btn" id="rep-gen">Generar informe</button>
      </div>
      <div id="rep-result" style="margin-top:14px"></div>
      <div class="card-title" style="padding:12px 0 6px">Informes anteriores</div>
      <div id="rep-list">
        ${
          reports.length
            ? reports
                .map(
                  (r) => `<div class="appt-row"><div style="flex:1">Últimos ${r.period_days} días
                    <div class="muted" style="font-size:11px">${fmtDate(r.created_at)}</div></div>
                    <a class="btn secondary small" href="/r/${esc(r.token)}" target="_blank">Ver ↗</a></div>`
                )
                .join('')
            : '<p class="muted">Aún no hay informes.</p>'
        }
      </div>`);
    modal.querySelector('#rep-gen').addEventListener('click', async () => {
      const btn = modal.querySelector('#rep-gen');
      btn.disabled = true;
      btn.textContent = 'Generando…';
      try {
        const rep = await api('/reports/generate', {
          method: 'POST',
          body: { period_days: Number(modal.querySelector('#rep-days').value) },
        });
        modal.querySelector('#rep-result').innerHTML = `
          <div class="block-item">
            <div class="b-head"><span>Informe listo</span></div>
            <p style="font-size:13px;white-space:pre-wrap">${esc(rep.narrative.slice(0, 220))}…</p>
            <div class="flex" style="margin-top:10px">
              <a class="btn secondary small" href="${esc(rep.url)}" target="_blank">Abrir ↗</a>
              <button class="btn secondary small" id="rep-copy">Copiar link</button>
              <button class="btn small" id="rep-send">Enviar por email</button>
            </div>
          </div>`;
        modal.querySelector('#rep-copy').addEventListener('click', () => {
          navigator.clipboard.writeText(location.origin + rep.url);
          toast('Link copiado');
        });
        modal.querySelector('#rep-send').addEventListener('click', async () => {
          const email = prompt('Email del cliente:', '');
          if (!email) return;
          const sent = await api(`/reports/${rep.id}/send`, { method: 'POST', body: { email } });
          toast(sent.delivery.includes('simulated') ? 'Guardado (configura email real en Settings para envío)' : 'Informe enviado');
        });
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generar informe';
      }
    });
  });
}
