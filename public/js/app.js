import { state, loadMe, clearSession, setLocation } from './api.js';
import { esc, initials, toast } from './ui.js';
import { renderLogin, renderRegister } from './views/auth.js';
import { renderDashboard } from './views/dashboard.js';
import { renderContacts } from './views/contacts.js';
import { renderConversations } from './views/conversations.js';
import { renderCalendar } from './views/calendar.js';
import { renderPipelines } from './views/pipelines.js';
import { renderMarketing } from './views/marketing.js';
import { renderAutomations } from './views/automations.js';
import { renderFunnels } from './views/funnels.js';
import { renderSettings } from './views/settings.js';
import { renderPayments } from './views/payments.js';
import { renderReputation } from './views/reputation.js';
import { renderTasks } from './views/tasks.js';

const NAV = [
  { path: 'dashboard', label: 'Dashboard', icon: '📊', view: renderDashboard },
  { path: 'conversations', label: 'Conversations', icon: '💬', view: renderConversations },
  { path: 'contacts', label: 'Contacts', icon: '👥', view: renderContacts },
  { path: 'pipelines', label: 'Opportunities', icon: '🎯', view: renderPipelines },
  { path: 'calendar', label: 'Calendar', icon: '📅', view: renderCalendar },
  { path: 'payments', label: 'Pagos', icon: '💳', view: renderPayments },
  { path: 'marketing', label: 'Marketing', icon: '📣', view: renderMarketing },
  { path: 'automations', label: 'Automations', icon: '⚙️', view: renderAutomations },
  { path: 'funnels', label: 'Sites & Funnels', icon: '🌐', view: renderFunnels },
  { path: 'reputation', label: 'Reputación', icon: '⭐', view: renderReputation },
  { path: 'tasks', label: 'Tareas', icon: '✅', view: renderTasks },
  { path: 'settings', label: 'Settings', icon: '🛠️', view: renderSettings },
];

function renderShell(activePath) {
  const app = document.getElementById('app');
  app.innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">⚡ Lead<span>Flow</span></div>
      <nav>
        ${NAV.map(
          (n) => `<a href="#/${n.path}" class="${n.path === activePath ? 'active' : ''}">
            <span class="nav-icon">${n.icon}</span><span class="nav-label">${n.label}</span></a>`
        ).join('')}
      </nav>
      <div class="sidebar-footer">v1.2 · ${esc(state.agency?.name || '')}</div>
    </aside>
    <div class="main">
      <header class="topbar">
        <select id="location-switcher" title="Sub-account">
          ${state.locations
            .map((l) => `<option value="${l.id}" ${l.id === state.locationId ? 'selected' : ''}>${esc(l.name)}</option>`)
            .join('')}
        </select>
        <div class="spacer"></div>
        <div class="user-chip"><span class="avatar">${initials(state.user || {})}</span> ${esc(state.user?.name || '')}</div>
        <button class="btn secondary small" id="logout-btn">Log out</button>
      </header>
      <main class="content" id="view"></main>
    </div>
  </div>`;

  document.getElementById('location-switcher').addEventListener('change', (e) => {
    setLocation(e.target.value);
    route();
  });
  document.getElementById('logout-btn').addEventListener('click', () => {
    clearSession();
    location.hash = '#/login';
  });
  return document.getElementById('view');
}

async function route() {
  const hash = location.hash.replace(/^#\//, '') || 'dashboard';
  const [path, ...rest] = hash.split('/');

  if (path === 'login') return renderLogin(document.getElementById('app'));
  if (path === 'register') return renderRegister(document.getElementById('app'));

  if (!state.token) {
    location.hash = '#/login';
    return;
  }
  if (!state.user) {
    try {
      await loadMe();
    } catch {
      clearSession();
      location.hash = '#/login';
      return;
    }
  }

  const nav = NAV.find((n) => n.path === path) || NAV[0];
  const view = renderShell(nav.path);
  try {
    await nav.view(view, rest);
  } catch (err) {
    toast(err.message, true);
    view.innerHTML = `<div class="empty"><div class="big">⚠️</div>${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);
route();

// PWA: register the service worker (no-op where unsupported).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
