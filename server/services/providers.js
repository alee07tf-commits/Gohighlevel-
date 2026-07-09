// Real delivery providers with graceful fallback. Every channel works in
// "simulated" mode (recorded in the inbox only) until credentials exist.
// Credentials resolve per context via services/integrations.js in the cascade
//   location override → agency default → deployment env var
// so each sub-account (or the agency) can bring its own Stripe/Twilio/email/AI.
// `ctx` is { locationId } or { agencyId } (or both); omitted → env only.
const integrations = require('./integrations');

async function cfg(provider, ctx) {
  return (await integrations.resolve(provider, ctx || {})).config;
}

function emailVendor(c) {
  return c.vendor || (c.api_key ? 'resend' : '');
}
// Twilio accepts Account SID + Auth Token, or an API Key (SK…) + Secret used as
// Basic-Auth credentials while the Account SID still identifies the account.
function twilioReady(c) {
  return c.account_sid && (c.auth_token || (c.api_key_sid && c.api_key_secret));
}

async function emailProvider(ctx) {
  const c = await cfg('email', ctx);
  return c.api_key ? emailVendor(c) || 'resend' : 'simulated';
}
async function smsProvider(ctx) {
  const c = await cfg('twilio', ctx);
  return twilioReady(c) && c.from_number ? 'twilio' : 'simulated';
}
async function whatsappProvider(ctx) {
  const c = await cfg('twilio', ctx);
  return twilioReady(c) && c.whatsapp_from ? 'twilio' : 'simulated';
}
async function paymentsProvider(ctx) {
  const c = await cfg('stripe', ctx);
  return c.secret_key ? 'stripe' : 'simulated';
}

// Effective per-context status for the Settings → Integraciones card, with the
// resolution source of each provider.
async function status(ctx) {
  const [email, twilio, stripe, ai] = await Promise.all([
    integrations.resolve('email', ctx || {}),
    integrations.resolve('twilio', ctx || {}),
    integrations.resolve('stripe', ctx || {}),
    integrations.resolve('ai', ctx || {}),
  ]);
  return {
    email: email.config.api_key ? emailVendor(email.config) || 'resend' : 'simulated',
    sms: twilioReady(twilio.config) && twilio.config.from_number ? 'twilio' : 'simulated',
    whatsapp: twilioReady(twilio.config) && twilio.config.whatsapp_from ? 'twilio' : 'simulated',
    payments: stripe.config.secret_key ? 'stripe' : 'simulated',
    ai: Boolean(ai.config.api_key),
    mail_from: email.config.mail_from || null,
    sources: { email: email.source, sms: twilio.source, whatsapp: twilio.source, payments: stripe.source, ai: ai.source },
  };
}

// ---- Stripe ----
async function createCheckoutSession({ invoice, successUrl, cancelUrl }, ctx) {
  const c = await cfg('stripe', ctx);
  if (!c.secret_key) return null;
  const params = new URLSearchParams({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'metadata[invoice_id]': String(invoice.id),
    'metadata[invoice_token]': invoice.token,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': (invoice.currency || 'EUR').toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(Math.round(invoice.total * 100)),
    'line_items[0][price_data][product_data][name]': invoice.title || `Invoice ${invoice.number}`,
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.secret_key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Stripe checkout session failed');
  return { url: data.url, id: data.id };
}

// SaaS subscription checkout (recurring) using the agency's Stripe key. Uses
// inline price_data so no pre-created Stripe Price is needed. Returns { url }.
async function createSubscriptionCheckout({ plan, successUrl, cancelUrl, customerEmail, metadata = {} }, ctx) {
  const c = await cfg('stripe', ctx);
  if (!c.secret_key) return null;
  const params = new URLSearchParams({
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': (plan.currency || 'EUR').toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(Math.round(Number(plan.price) * 100)),
    'line_items[0][price_data][recurring][interval]': plan.interval === 'yearly' ? 'year' : 'month',
    'line_items[0][price_data][product_data][name]': plan.name || 'Plan',
  });
  if (customerEmail) params.set('customer_email', customerEmail);
  for (const [k, v] of Object.entries(metadata)) params.set(`metadata[${k}]`, String(v));
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.secret_key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Stripe subscription checkout failed');
  return { url: data.url, id: data.id };
}

async function retrieveCheckoutSession(sessionId, ctx) {
  const c = await cfg('stripe', ctx);
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${c.secret_key}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Stripe session retrieve failed');
  return data;
}

// ---- Email ----
// Sends both an HTML and a plain-text part when `html` is given (better
// rendering + deliverability). Falls back to text-only when it isn't.
async function deliverEmail({ to, subject, text, html, fromName }, ctx) {
  const c = await cfg('email', ctx);
  const vendor = c.api_key ? emailVendor(c) || 'resend' : 'simulated';
  if (vendor === 'simulated' || !to) return { ok: true, provider: 'simulated' };
  const from = c.mail_from || 'onboarding@resend.dev';
  const fromHeader = fromName ? `${fromName} <${from}>` : from;
  try {
    if (vendor === 'resend') {
      const payload = { from: fromHeader, to: [to], subject: subject || '(no subject)', text };
      if (html) payload.html = html;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { ok: true, provider: vendor };
    }
    const content = [{ type: 'text/plain', value: text || '' }];
    if (html) content.push({ type: 'text/html', value: html });
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: fromName || undefined },
        subject: subject || '(no subject)',
        content,
      }),
    });
    if (!(res.status === 202 || res.ok)) throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { ok: true, provider: vendor };
  } catch (err) {
    return { ok: false, provider: vendor, error: err.message };
  }
}

// ---- SMS / WhatsApp via Twilio ----
async function twilioSend({ from, to, body }, c) {
  const account = c.account_sid;
  const user = c.api_key_sid || account;
  const pass = c.api_key_secret || c.auth_token;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function deliverSms({ to, body }, ctx) {
  const c = await cfg('twilio', ctx);
  if (!(twilioReady(c) && c.from_number) || !to) return { ok: true, provider: 'simulated' };
  try {
    await twilioSend({ from: c.from_number, to, body }, c);
    return { ok: true, provider: 'twilio' };
  } catch (err) {
    return { ok: false, provider: 'twilio', error: err.message };
  }
}

async function deliverWhatsapp({ to, body }, ctx) {
  const c = await cfg('twilio', ctx);
  if (!(twilioReady(c) && c.whatsapp_from) || !to) return { ok: true, provider: 'simulated' };
  try {
    await twilioSend({ from: c.whatsapp_from, to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`, body }, c);
    return { ok: true, provider: 'twilio' };
  } catch (err) {
    return { ok: false, provider: 'twilio', error: err.message };
  }
}

module.exports = {
  status,
  emailProvider,
  smsProvider,
  whatsappProvider,
  deliverEmail,
  deliverSms,
  deliverWhatsapp,
  paymentsProvider,
  createCheckoutSession,
  createSubscriptionCheckout,
  retrieveCheckoutSession,
};
