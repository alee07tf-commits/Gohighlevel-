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
function smsProvider() {
  return process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
    ? 'twilio'
    : 'simulated';
}
function whatsappProvider() {
  return process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM
    ? 'twilio'
    : 'simulated';
}

function status() {
  return {
    email: emailProvider(),
    sms: smsProvider(),
    whatsapp: whatsappProvider(),
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
    mail_from: process.env.MAIL_FROM || null,
  };
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
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
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

module.exports = { status, deliverEmail, deliverSms, deliverWhatsapp };
