import { state, loadMe, clearSession, setLocation, setAgency } from './api.js';
import { esc, initials, toast, icon } from './ui.js';
import { t, getLang, setLang } from './i18n.js';
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
import { renderProspecting } from './views/prospecting.js';
import { renderAgency } from './views/agency.js';
import { renderClients } from './views/clients.js';
import { renderTraining } from './views/training.js';

const IC = {
  dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  conversations: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  contacts: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  pipelines: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  payments: '<svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
  prospecting: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  marketing: '<svg viewBox="0 0 24 24"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  automations: '<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  funnels: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  reputation: '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  tasks: '<svg viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
  agency: '<svg viewBox="0 0 24 24"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><line x1="9" y1="9" x2="9" y2="9.01"/><line x1="9" y1="13" x2="9" y2="13.01"/></svg>',
  clients: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  training: '<svg viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
};

function navSections() {
  const isAdmin = state.user?.role === 'admin';
  return [
    { title: t('Workspace', 'Workspace'), items: ['dashboard', 'conversations', 'contacts', 'pipelines', 'calendar', 'tasks'] },
    { title: t('Crecimiento', 'Growth'), items: ['prospecting', 'marketing', 'funnels', 'automations', 'payments', 'reputation'] },
    { title: t('Formación', 'Training'), items: ['training'] },
    // The agency layer is admin-only: "Clientes" manages the agencies below you
    // in the tenant tree; the agency console is SaaS/cross-account/white-label.
    { title: t('Cuenta', 'Account'), items: [...(isAdmin ? ['clients', 'agency'] : []), 'settings'] },
  ];
}

// Labels are functions so they re-evaluate in the active language on each render.
const NAV = [
  { path: 'dashboard', label: () => t('Panel', 'Dashboard'), view: renderDashboard },
  { path: 'conversations', label: () => t('Conversaciones', 'Conversations'), view: renderConversations },
  { path: 'contacts', label: () => t('Contactos', 'Contacts'), view: renderContacts },
  { path: 'pipelines', label: () => t('Oportunidades', 'Opportunities'), view: renderPipelines },
  { path: 'calendar', label: () => t('Calendario', 'Calendar'), view: renderCalendar },
  { path: 'payments', label: () => t('Pagos', 'Payments'), view: renderPayments },
  { path: 'prospecting', label: () => t('Prospección', 'Prospecting'), view: renderProspecting },
  { path: 'marketing', label: () => t('Marketing', 'Marketing'), view: renderMarketing },
  { path: 'automations', label: () => t('Automatizaciones', 'Automations'), view: renderAutomations },
  { path: 'funnels', label: () => t('Sitios y Embudos', 'Sites & Funnels'), view: renderFunnels },
  { path: 'reputation', label: () => t('Reputación', 'Reputation'), view: renderReputation },
  { path: 'tasks', label: () => t('Tareas', 'Tasks'), view: renderTasks },
  { path: 'clients', label: () => t('Clientes', 'Clients'), view: renderClients },
  { path: 'agency', label: () => t('Agencia', 'Agency'), view: renderAgency },
  { path: 'training', label: () => t('Formación', 'Training'), view: renderTraining },
  { path: 'settings', label: () => t('Ajustes', 'Settings'), view: renderSettings },
];

function applyBranding() {
  // White-label: tint the app with the agency's brand color when set.
  const color = state.agency?.brand_color;
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    const root = document.documentElement.style;
    root.setProperty('--primary', color);
    root.setProperty('--primary-dark', color);
  }
}

function renderShell(activePath) {
  applyBranding();
  const app = document.getElementById('app');
  const hour = new Date().getHours();
  const greet =
    hour < 12 ? t('Buenos días', 'Good morning') : hour < 20 ? t('Buenas tardes', 'Good afternoon') : t('Buenas noches', 'Good evening');
  const firstName = (state.user?.name || '').split(' ')[0];

  const navLink = (n) => `<a href="#/${n.path}" class="${n.path === activePath ? 'active' : ''}">
    <span class="nav-icon">${IC[n.path] || ''}</span><span class="nav-label">${n.label()}</span></a>`;

  app.innerHTML = `
  <div class="layout">
    <div class="sidebar-scrim" id="sidebar-scrim"></div>
    <aside class="sidebar" id="sidebar">
      <div class="logo"><span class="logo-chip">${state.agency?.logo_url ? `<img src="${esc(state.agency.logo_url)}" alt="" style="width:18px;height:18px;object-fit:contain">` : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 10-12h-7z"/></svg>'}</span>
        <span class="logo-text">${esc(state.agency?.name || 'LeadFlow')}<span class="logo-sub">${state.agency?.slug ? t('Agencia', 'Agency') : t('plataforma', 'platform')}</span></span></div>
      <div class="search-box" id="global-search">${icon('search', 15)} <span style="flex:1">${t('Buscar contactos…', 'Search contacts…')}</span> <span class="kbd">⌘K</span></div>
      <nav>
        ${navSections().map(
          (s) => `<div class="nav-section">${s.title}</div>` +
            s.items.map((key) => navLink(NAV.find((n) => n.path === key))).join('')
        ).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="lang-switch" role="group" aria-label="${t('Idioma', 'Language')}">
          <button class="lang-btn ${getLang() === 'es' ? 'active' : ''}" data-lang="es">ES</button>
          <button class="lang-btn ${getLang() === 'en' ? 'active' : ''}" data-lang="en">EN</button>
        </div>
        <a href="#" id="drawer-logout" style="color:var(--danger);font-weight:600">${t('Cerrar sesión', 'Log out')}</a>
        <div style="margin-top:6px">${t('plataforma de agencia', 'agency platform')}</div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Menú"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>
        ${state.locations.length
          ? `<select id="location-switcher" title="${t('Sub-cuenta', 'Sub-account')}">
          ${state.locations
            .map((l) => `<option value="${l.id}" ${l.id === state.locationId ? 'selected' : ''}>${esc(l.name)}</option>`)
            .join('')}
        </select>`
          : ''}
        ${state.actingAsChild
          ? `<span class="context-chip" title="${t('Estás gestionando un cliente', 'You are managing a client')}">
              <span class="context-dot"></span> ${esc(state.agency?.name || t('Cliente', 'Client'))}
              <button class="btn ghost small" id="ctx-back">← ${esc(state.parentAgency?.name || t('Volver', 'Back'))}</button>
            </span>`
          : ''}
        <div class="spacer"></div>
        <div class="user-chip"><span class="avatar">${initials(state.user || {})}</span> <span class="chip-name">${esc(firstName)}</span></div>
        <button class="btn secondary small" id="logout-btn">${t('Salir', 'Log out')}</button>
      </header>
      <main class="content" id="view"></main>
    </div>
  </div>`;

  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebar-scrim');
  const closeDrawer = () => { sidebar.classList.remove('open'); scrim.classList.remove('show'); };
  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    scrim.classList.toggle('show', open);
  });
  scrim.addEventListener('click', closeDrawer);
  // Tapping any nav link closes the drawer on mobile.
  sidebar.querySelectorAll('nav a').forEach((a) => a.addEventListener('click', closeDrawer));

  document.getElementById('location-switcher')?.addEventListener('change', (e) => {
    setLocation(e.target.value);
    route();
  });
  // "← back" from inside a client: return to the parent scope and reload.
  document.getElementById('ctx-back')?.addEventListener('click', async () => {
    setAgency(state.parentAgency?.id || null);
    state.user = null; // force loadMe to refresh scope
    location.hash = '#/dashboard';
    await route();
  });
  const doLogout = (e) => {
    e?.preventDefault();
    clearSession();
    location.hash = '#/login';
  };
  document.getElementById('logout-btn').addEventListener('click', doLogout);
  document.getElementById('drawer-logout').addEventListener('click', doLogout);
  // Language switch: re-render the whole shell + current view in the new language.
  sidebar.querySelectorAll('.lang-btn').forEach((b) =>
    b.addEventListener('click', () => {
      if (getLang() === b.dataset.lang) return;
      setLang(b.dataset.lang);
      route();
    })
  );
  document.getElementById('global-search').addEventListener('click', () => {
    closeDrawer();
    location.hash = '#/contacts';
    setTimeout(() => document.getElementById('search')?.focus(), 350);
  });
  window.__greeting = `${greet}, ${firstName}`;
  return document.getElementById('view');
}

async function route() {
  const hash = location.hash.replace(/^#\//, '') || 'dashboard';
  const [path, ...rest] = hash.split('/');

  // `#/login/<slug>` shows a client's white-label login (logo + colour + name).
  if (path === 'login') return renderLogin(document.getElementById('app'), rest[0]);
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
    view.innerHTML = `<div class="empty"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>${esc(err.message)}</div>`;
  }
}

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    location.hash = '#/contacts';
    setTimeout(() => document.getElementById('search')?.focus(), 350);
  }
});
window.addEventListener('hashchange', route);
route();

// PWA: register the service worker (no-op where unsupported).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
