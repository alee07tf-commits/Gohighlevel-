import { api, setSession } from '../api.js';
import { formData, toast, esc } from '../ui.js';

// Default (unbranded) LeadFlow header, or a client's white-label header when a
// brand slug is present in the URL (`#/login/<slug>`).
function authShell(inner, brand) {
  const logo = brand
    ? `<div class="logo">${
        brand.logo_url
          ? `<img src="${esc(brand.logo_url)}" alt="${esc(brand.name)}" style="max-height:38px">`
          : esc(brand.name)
      }</div>`
    : '<div class="logo">Lead<span>Flow</span></div>';
  return `<div class="auth-wrap"><div class="auth-card">${logo}${inner}</div></div>`;
}

// Fetch a tenant's public branding (unauthenticated). Returns null if none.
async function loadBrand(slug) {
  if (!slug) return null;
  try {
    const res = await fetch(`/api/public/brand/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Warns loudly when the backend has no persistent database (serverless without
// DATABASE_URL) — otherwise accounts silently vanish between requests.
async function persistenceWarning() {
  try {
    const res = await fetch('/api/system/health');
    const h = await res.json();
    if (h && h.persistent === false) {
      return `<div class="auth-warn">⚠️ La base de datos no es persistente. Configura <code>DATABASE_URL</code> (Supabase) y <code>JWT_SECRET</code> en Vercel — sin eso, las cuentas no se guardan.</div>`;
    }
  } catch {
    /* health unreachable → don't block the form */
  }
  return '';
}

function applyBrandColor(brand) {
  const c = brand && brand.brand_color;
  const root = document.documentElement.style;
  if (c && /^#[0-9a-fA-F]{6}$/.test(c)) {
    root.setProperty('--primary', c);
    root.setProperty('--primary-dark', c);
  } else {
    root.removeProperty('--primary');
    root.removeProperty('--primary-dark');
  }
}

export async function renderLogin(root, brandSlug) {
  const [brand, warn] = await Promise.all([loadBrand(brandSlug), persistenceWarning()]);
  applyBrandColor(brand);
  const sub = brand
    ? brand.headline || `Accede a tu cuenta de ${esc(brand.name)}`
    : 'Accede a tu cuenta de agencia';
  root.innerHTML = authShell(
    `${warn}
    <p class="sub">${esc(sub)}</p>
    <form id="login-form">
      <label class="field"><span class="label">Email</span><input class="input" name="email" type="email" required></label>
      <label class="field"><span class="label">Contraseña</span><input class="input" name="password" type="password" required></label>
      <button class="btn" style="width:100%">Entrar</button>
    </form>
    ${brand ? '' : '<p class="alt">¿Nueva agencia? <a href="#/register">Crea una cuenta</a></p>'}
    ${brand ? '' : '<p class="alt muted">Demo: <code class="inline">demo@leadflow.app</code> / <code class="inline">demo123</code></p>'}`,
    brand
  );

  root.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api('/auth/login', { method: 'POST', body: formData(e.target) });
      setSession(res.token);
      location.hash = '#/dashboard';
    } catch (err) {
      toast(err.message, true);
    }
  });
}

export async function renderRegister(root) {
  const warn = await persistenceWarning();
  root.innerHTML = authShell(`${warn}
    <p class="sub">Crea tu agencia</p>
    <form id="register-form">
      <label class="field"><span class="label">Nombre de la agencia</span><input class="input" name="agency_name" required placeholder="Acme Marketing"></label>
      <label class="field"><span class="label">Tu nombre</span><input class="input" name="name" required></label>
      <label class="field"><span class="label">Email</span><input class="input" name="email" type="email" required></label>
      <label class="field"><span class="label">Contraseña</span><input class="input" name="password" type="password" required minlength="6"></label>
      <label class="field"><span class="label">Primer cliente / sub-cuenta</span><input class="input" name="location_name" placeholder="Mi primer cliente"></label>
      <button class="btn" style="width:100%">Crear agencia</button>
    </form>
    <p class="alt">¿Ya tienes cuenta? <a href="#/login">Entrar</a></p>`);

  root.querySelector('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api('/auth/register', { method: 'POST', body: formData(e.target) });
      setSession(res.token);
      location.hash = '#/dashboard';
    } catch (err) {
      toast(err.message, true);
    }
  });
}
