import { api } from '../api.js';
import { esc, fmtMoney, fmtDate, fullName } from '../ui.js';

const ICONS = { contact: '👤', tag: '🏷️', note: '📝', appointment: '📅', form: '📩', automation: '⚙️', opportunity: '🎯' };

export async function renderDashboard(view) {
  const data = await api('/dashboard');
  const s = data.stats;

  view.innerHTML = `
  <div class="page-header"><h1>Dashboard</h1></div>
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
}
