// Real delivery providers with graceful fallback.
// Everything works out of the box in "simulated" mode (messages recorded in
// the inbox only); adding env keys switches channels to live delivery:
//   Email:    RESEND_API_KEY  (or SENDGRID_API_KEY) + MAIL_FROM
//   SMS:      TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER
//   WhatsApp: same Twilio account + TWILIO_WHATSAPP_FROM (e.g. "whatsapp:+14155238886")

function emailProvider() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  return 'simulated';
}
// Twilio accepts two auth styles: Account SID + Auth Token, or an API Key
// (SK…) + its Secret used as Basic-Auth credentials while the Account SID
// still identifies the account in the request URL.
function twilioAuthReady() {
  return (
    process.env.TWILIO_ACCOUNT_SID &&
    (process.env.TWILIO_AUTH_TOKEN || (process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET))
  );
}
function smsProvider() {
  return twilioAuthReady() && process.env.TWILIO_FROM_NUMBER ? 'twilio' : 'simulated';
}
function whatsappProvider() {
  return twilioAuthReady() && process.env.TWILIO_WHATSAPP_FROM ? 'twilio' : 'simulated';
}

function paymentsProvider() {
  return process.env.STRIPE_SECRET_KEY ? 'stripe' : 'simulated';
}

function status() {
  return {
    email: emailProvider(),
    sms: smsProvider(),
    whatsapp: whatsappProvider(),
    payments: paymentsProvider(),
    prospecting: process.env.GOOGLE_PLACES_API_KEY ? 'google_places' : process.env.SERPER_API_KEY ? 'serper' : 'simulated',
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
    mail_from: process.env.MAIL_FROM || null,
  };
}

// ---- Stripe (payments) ----
// Creates a Checkout Session for an invoice. Returns { url } to redirect the
// payer to, or null in simulated mode (the pay page then offers a
// mark-as-paid test button instead).
async function createCheckoutSession({ invoice, successUrl, cancelUrl }) {
  if (paymentsProvider() !== 'stripe') return null;
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
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Stripe checkout session failed');
  return { url: data.url, id: data.id };
}

// Confirms a Checkout Session is actually paid — the webhook re-fetches from
// Stripe instead of trusting the inbound payload.
async function retrieveCheckoutSession(sessionId) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Stripe session retrieve failed');
  return data;
}

// ---- Email ----
async function deliverEmail({ to, subject, text, fromName }) {
  const provider = emailProvider();
  if (provider === 'simulated' || !to) return { ok: true, provider: 'simulated' };
  const from = process.env.MAIL_FROM || 'onboarding@resend.dev';
  const fromHeader = fromName ? `${fromName} <${from}>` : from;
  try {
    if (provider === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: fromHeader, to: [to], subject: subject || '(no subject)', text }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { ok: true, provider };
    }
    // SendGrid
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: fromName || undefined },
        subject: subject || '(no subject)',
        content: [{ type: 'text/plain', value: text }],
      }),
    });
    if (!(res.status === 202 || res.ok)) throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { ok: true, provider };
  } catch (err) {
    return { ok: false, provider, error: err.message };
  }
}

// ---- SMS / WhatsApp via Twilio ----
async function twilioSend({ from, to, body }) {
  const account = process.env.TWILIO_ACCOUNT_SID;
  // Basic-auth user/pass: API Key SID + Secret when present, else Account SID + Auth Token.
  const user = process.env.TWILIO_API_KEY_SID || account;
  const pass = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN;
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

async function deliverSms({ to, body }) {
  if (smsProvider() === 'simulated' || !to) return { ok: true, provider: 'simulated' };
  try {
    await twilioSend({ from: process.env.TWILIO_FROM_NUMBER, to, body });
    return { ok: true, provider: 'twilio' };
  } catch (err) {
    return { ok: false, provider: 'twilio', error: err.message };
  }
}

async function deliverWhatsapp({ to, body }) {
  if (whatsappProvider() === 'simulated' || !to) return { ok: true, provider: 'simulated' };
  try {
    await twilioSend({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
      body,
    });
    return { ok: true, provider: 'twilio' };
  } catch (err) {
    return { ok: false, provider: 'twilio', error: err.message };
  }
}

module.exports = {
  status,
  deliverEmail,
  deliverSms,
  deliverWhatsapp,
  paymentsProvider,
  createCheckoutSession,
  retrieveCheckoutSession,
};
