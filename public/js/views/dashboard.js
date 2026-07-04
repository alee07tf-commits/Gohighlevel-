import { api } from '../api.js';
import { esc, fmtMoney, fmtDate, fullName, openModal, closeOverlay, toast, icon } from '../ui.js';

const ICONS = { contact: 'contact', tag: 'tag', note: 'note', appointment: 'appointment', form: 'form', automation: 'automation', opportunity: 'opportunity' };

export async function renderDashboard(view) {
  const data = await api('/dashboard');
  const s = data.stats;

  view.innerHTML = `
  <div class="page-greeting">${esc(window.__greeting || 'Hola')} — ${s.unread_conversations > 0 ? `${s.unread_conversations} conversación(es) sin leer` : 'todo al día'} · ${s.upcoming_appointments} cita(s) próximas</div>
  <div class="page-header"><h1>Dashboard</h1>
    <div class="spacer"></div>
    <button class="btn secondary" id="report-btn">Informe del cliente</button>
  </div>
  <div class="hero-banner">
    <div class="hb-label">◎ Pipeline abierto</div>
    <div class="hb-value">${fmtMoney(s.pipeline_value)}</div>
    <div class="hb-sub">${s.open_opportunities} oportunidades abiertas en el pipeline</div>
    <div class="hb-badges">
      <span class="hb-badge">↗ +${s.contacts_this_week} contactos esta semana</span>
      <span class="hb-badge">${s.form_submissions_week} formularios (7 días)</span>
    </div>
    <div class="hb-cards">
      <div class="hb-card"><div class="l">Ganado</div><div class="v">${fmtMoney(s.won_value)}</div><div class="s">oportunidades cerradas</div></div>
      <div class="hb-card"><div class="l">Contactos</div><div class="v">${s.contacts}</div><div class="s">en esta sub-cuenta</div></div>
      <div class="hb-card"><div class="l">Citas próximas</div><div class="v">${s.upcoming_appointments}</div><div class="s">confirmadas</div></div>
      <div class="hb-card"><div class="l">Sin leer</div><div class="v">${s.unread_conversations}</div><div class="s">conversaciones</div></div>
    </div>
  </div>
  ${
    data.hotLeads?.length
      ? `<div class="card" style="margin-bottom:18px;border-left:4px solid #f59e0b"><div class="card-body">
          <strong>Leads calientes — llámalos hoy</strong>
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
    <div class="stat"><div class="stat-label">Contactos nuevos (7 días)</div><div class="stat-value">${s.contacts_this_week}</div></div>
    <div class="stat"><div class="stat-label">Formularios (7 días)</div><div class="stat-value">${s.form_submissions_week}</div></div>
    <div class="stat"><div class="stat-label">Oportunidades abiertas</div><div class="stat-value">${s.open_opportunities}</div></div>
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
                    <div class="t-icon">${icon(ICONS[a.type] || 'note', 14)}</div>
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
      <h2>Informe para el cliente</h2>
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
