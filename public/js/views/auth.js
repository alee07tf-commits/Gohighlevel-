import { api, setSession } from '../api.js';
import { formData, toast, esc } from '../ui.js';

function authShell(inner) {
  return `<div class="auth-wrap"><div class="auth-card">
    <div class="logo">Lead<span>Flow</span></div>${inner}</div></div>`;
}

export function renderLogin(root) {
  root.innerHTML = authShell(`
    <p class="sub">Sign in to your agency account</p>
    <form id="login-form">
      <label class="field"><span class="label">Email</span><input class="input" name="email" type="email" required></label>
      <label class="field"><span class="label">Password</span><input class="input" name="password" type="password" required></label>
      <button class="btn" style="width:100%">Sign In</button>
    </form>
    <p class="alt">New agency? <a href="#/register">Create an account</a></p>
    <p class="alt muted">Demo: <code class="inline">demo@leadflow.app</code> / <code class="inline">demo123</code></p>`);

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

export function renderRegister(root) {
  root.innerHTML = authShell(`
    <p class="sub">Create your agency — free forever, self-hosted</p>
    <form id="register-form">
      <label class="field"><span class="label">Agency name</span><input class="input" name="agency_name" required placeholder="Acme Marketing"></label>
      <label class="field"><span class="label">Your name</span><input class="input" name="name" required></label>
      <label class="field"><span class="label">Email</span><input class="input" name="email" type="email" required></label>
      <label class="field"><span class="label">Password</span><input class="input" name="password" type="password" required minlength="6"></label>
      <label class="field"><span class="label">First client / sub-account name</span><input class="input" name="location_name" placeholder="My First Client"></label>
      <button class="btn" style="width:100%">Create Agency</button>
    </form>
    <p class="alt">Already have an account? <a href="#/login">Sign in</a></p>`);

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
