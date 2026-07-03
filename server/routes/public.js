// Public, unauthenticated routes: rendered funnel pages, form capture and
// calendar booking widgets. These are what your clients' leads interact with.
const express = require('express');
const db = require('../db');
const automation = require('../services/automation');
const scheduler = require('../services/scheduler');
const scoring = require('../services/scoring');

const router = express.Router();

function esc(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const PAGE_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;color:#1a202c;background:#f7fafc;line-height:1.6}
  .hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;text-align:center;padding:90px 24px}
  .hero h1{font-size:2.6rem;margin-bottom:14px}
  .hero p{font-size:1.2rem;opacity:.9;max-width:640px;margin:0 auto 26px}
  .btn{display:inline-block;background:#f59e0b;color:#fff;padding:14px 36px;border-radius:8px;font-weight:700;
       text-decoration:none;border:none;font-size:1rem;cursor:pointer}
  .section{max-width:760px;margin:0 auto;padding:56px 24px}
  .section h2{font-size:1.8rem;margin-bottom:12px;text-align:center}
  .section p{text-align:center;color:#4a5568}
  .features{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-top:28px}
  .feature{background:#fff;border-radius:10px;padding:22px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .feature h3{margin-bottom:6px;font-size:1.05rem}
  form.lead{background:#fff;border-radius:12px;padding:30px;box-shadow:0 4px 14px rgba(0,0,0,.1);max-width:460px;margin:24px auto 0}
  form.lead label{display:block;font-size:.85rem;font-weight:600;margin:12px 0 4px;color:#374151}
  form.lead input,form.lead textarea{width:100%;padding:11px;border:1px solid #d1d5db;border-radius:7px;font-size:.95rem}
  form.lead button{width:100%;margin-top:18px}
  .success{background:#ecfdf5;border:1px solid #10b981;color:#065f46;padding:16px;border-radius:8px;text-align:center;
           max-width:460px;margin:20px auto;display:none}
  .footer{text-align:center;color:#9ca3af;font-size:.8rem;padding:30px}
`;

function renderBlock(block, pageId) {
  switch (block.type) {
    case 'hero':
      return `<div class="hero"><h1>${esc(block.headline)}</h1><p>${esc(block.subheadline)}</p>
        ${block.cta ? `<a class="btn" href="#lead-form">${esc(block.cta)}</a>` : ''}</div>`;
    case 'text':
      return `<div class="section"><h2>${esc(block.headline)}</h2><p>${esc(block.body)}</p></div>`;
    case 'features': {
      const items = (block.items || [])
        .map((f) => `<div class="feature"><h3>${esc(f.title)}</h3><p>${esc(f.body)}</p></div>`)
        .join('');
      return `<div class="section"><h2>${esc(block.headline || '')}</h2><div class="features">${items}</div></div>`;
    }
    case 'form': {
      const fieldDefs = {
        first_name: { label: 'First name', type: 'text' },
        last_name: { label: 'Last name', type: 'text' },
        email: { label: 'Email', type: 'email' },
        phone: { label: 'Phone', type: 'tel' },
        message: { label: 'Message', type: 'textarea' },
      };
      const inputs = (block.fields || ['first_name', 'email'])
        .map((f) => {
          const def = fieldDefs[f] || { label: f, type: 'text' };
          const input =
            def.type === 'textarea'
              ? `<textarea name="${esc(f)}" rows="3"></textarea>`
              : `<input type="${def.type}" name="${esc(f)}" ${f === 'email' || f === 'first_name' ? 'required' : ''}>`;
          return `<label>${esc(def.label)}${input}</label>`;
        })
        .join('');
      return `<div class="section" id="lead-form"><h2>${esc(block.headline || '')}</h2>
        <div class="success" id="form-success">${esc(block.success_message || 'Thank you!')}</div>
        <form class="lead" method="post" action="/api/public/pages/${pageId}/submit"
              onsubmit="return submitLead(event)">${inputs}
          <button class="btn" type="submit">${esc(block.button || 'Submit')}</button>
        </form></div>`;
    }
    default:
      return '';
  }
}

router.get('/f/:funnelSlug{/:pageSlug}', async (req, res) => {
  const funnel = await db.get('SELECT * FROM funnels WHERE slug = ?', [req.params.funnelSlug]);
  if (!funnel) return res.status(404).send('Funnel not found');
  const slug = req.params.pageSlug || 'home';
  const page = await db.get('SELECT * FROM funnel_pages WHERE funnel_id = ? AND slug = ? AND published = 1', [
    funnel.id,
    slug,
  ]);
  if (!page) return res.status(404).send('Page not found or not published');
  const loc = await db.get('SELECT * FROM locations WHERE id = ?', [funnel.location_id]);
  const css = PAGE_CSS.replaceAll('#4f46e5', (loc && loc.brand_color) || '#4f46e5');
  const blocks = JSON.parse(page.content || '[]');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(page.name)}</title>
<style>${css}</style></head><body>
${blocks.map((b) => renderBlock(b, page.id)).join('\n')}
<div class="footer">Powered by LeadFlow</div>
<script>
async function submitLead(e){e.preventDefault();const f=e.target;
const data=Object.fromEntries(new FormData(f).entries());
const r=await fetch(f.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
if(r.ok){f.style.display='none';document.getElementById('form-success').style.display='block';}
else{alert('Something went wrong, please try again.');}
return false;}
</script></body></html>`;
  res.send(html);
});

// Lead capture: upserts a contact by email/phone, records the submission and
// fires form_submitted / contact_created automations.
router.post('/pages/:pageId/submit', async (req, res) => {
  const page = await db.get('SELECT * FROM funnel_pages WHERE id = ?', [req.params.pageId]);
  if (!page || !page.published) return res.status(404).json({ error: 'Page not found' });
  const funnel = await db.get('SELECT * FROM funnels WHERE id = ?', [page.funnel_id]);
  const data = req.body || {};
  const email = (data.email || '').trim();
  const phone = (data.phone || '').trim();
  if (!email && !phone) return res.status(400).json({ error: 'email or phone is required' });

  let contact = null;
  if (email)
    contact = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND email = ? AND email != ''`, [
      funnel.location_id,
      email,
    ]);
  if (!contact && phone)
    contact = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND phone = ? AND phone != ''`, [
      funnel.location_id,
      phone,
    ]);
  let isNew = false;
  if (!contact) {
    const id = await db.insert(
      `INSERT INTO contacts (location_id, first_name, last_name, email, phone, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [funnel.location_id, data.first_name || '', data.last_name || '', email, phone, `funnel:${funnel.slug}`]
    );
    contact = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
    isNew = true;
  }

  // Tag from the form block config, if set.
  const formBlock = JSON.parse(page.content || '[]').find((b) => b.type === 'form');
  if (formBlock && formBlock.tag) {
    await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [
      contact.id,
      formBlock.tag,
    ]);
  }

  await db.run('INSERT INTO form_submissions (location_id, funnel_page_id, contact_id, data) VALUES (?, ?, ?, ?)', [
    funnel.location_id,
    page.id,
    contact.id,
    JSON.stringify(data),
  ]);

  await scoring.addScore(contact.id, 'form_submitted');
  await automation.logActivity(funnel.location_id, contact.id, 'form', `Submitted form on "${page.name}" (${funnel.name})`);
  if (isNew) await automation.trigger(funnel.location_id, 'contact_created', contact);
  await automation.trigger(funnel.location_id, 'form_submitted', contact, { funnel_id: funnel.id });
  if (formBlock && formBlock.tag)
    await automation.trigger(funnel.location_id, 'tag_added', contact, { tag: formBlock.tag });

  res.status(201).json({ ok: true });
});

// ---- Public booking widget ----
router.get('/book/:slug', async (req, res) => {
  const calendar = await db.get('SELECT * FROM calendars WHERE slug = ?', [req.params.slug]);
  if (!calendar) return res.status(404).send('Calendar not found');
  const bookLoc = await db.get('SELECT * FROM locations WHERE id = ?', [calendar.location_id]);
  const bookCss = PAGE_CSS.replaceAll('#4f46e5', (bookLoc && bookLoc.brand_color) || '#4f46e5');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Book: ${esc(calendar.name)}</title>
<style>${bookCss}
.book{max-width:460px;margin:60px auto;background:#fff;border-radius:12px;padding:34px;box-shadow:0 4px 14px rgba(0,0,0,.1)}
.book h1{font-size:1.5rem;margin-bottom:6px}.book .desc{color:#6b7280;margin-bottom:18px}
.book label{display:block;font-size:.85rem;font-weight:600;margin:12px 0 4px;color:#374151}
.book input,.book select{width:100%;padding:11px;border:1px solid #d1d5db;border-radius:7px;font-size:.95rem}
.book button{width:100%;margin-top:18px}</style></head><body>
<div class="success" id="ok" style="margin-top:60px">Appointment booked! Check your email for details.</div>
<div class="book" id="widget">
<h1>${esc(calendar.name)}</h1>
<p class="desc">${esc(calendar.description)} &middot; ${calendar.duration_minutes} min</p>
<form onsubmit="return book(event)">
<label>Name<input name="name" required></label>
<label>Email<input name="email" type="email" required></label>
<label>Phone<input name="phone" type="tel"></label>
<label>Date<input name="date" type="date" required></label>
<label>Time<select name="time" id="time"></select></label>
<button class="btn" type="submit">Book Appointment</button>
</form></div>
<div class="footer">Powered by LeadFlow</div>
<script>
const startHour=${calendar.start_hour},endHour=${calendar.end_hour},dur=${calendar.duration_minutes};
const sel=document.getElementById('time');
for(let m=startHour*60;m+dur<=endHour*60;m+=dur){
  const h=String(Math.floor(m/60)).padStart(2,'0'),mm=String(m%60).padStart(2,'0');
  sel.insertAdjacentHTML('beforeend','<option>'+h+':'+mm+'</option>');
}
async function book(e){e.preventDefault();
const d=Object.fromEntries(new FormData(e.target).entries());
const r=await fetch('/api/public/book/${esc(calendar.slug)}',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
if(r.ok){document.getElementById('widget').style.display='none';document.getElementById('ok').style.display='block';}
else{const j=await r.json().catch(()=>({}));alert(j.error||'Could not book, try another time.');}
return false;}
</script></body></html>`;
  res.send(html);
});

router.post('/book/:slug', async (req, res) => {
  const calendar = await db.get('SELECT * FROM calendars WHERE slug = ?', [req.params.slug]);
  if (!calendar) return res.status(404).json({ error: 'Calendar not found' });
  const { name, email, phone, date, time } = req.body || {};
  if (!name || !email || !date || !time)
    return res.status(400).json({ error: 'name, email, date and time are required' });

  const startsAt = `${date}T${time}:00`;
  const endsAt = new Date(new Date(startsAt + 'Z').getTime() + calendar.duration_minutes * 60000)
    .toISOString()
    .slice(0, 19);

  const clash = await db.get('SELECT id FROM appointments WHERE calendar_id = ? AND starts_at = ? AND status != ?', [
    calendar.id,
    startsAt,
    'cancelled',
  ]);
  if (clash) return res.status(409).json({ error: 'That slot is already taken, pick another time.' });

  let contact = await db.get('SELECT * FROM contacts WHERE location_id = ? AND email = ?', [
    calendar.location_id,
    email,
  ]);
  let isNew = false;
  if (!contact) {
    const [first, ...rest] = String(name).split(' ');
    const id = await db.insert(
      `INSERT INTO contacts (location_id, first_name, last_name, email, phone, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [calendar.location_id, first, rest.join(' '), email, phone || '', `booking:${calendar.slug}`]
    );
    contact = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
    isNew = true;
  }

  const apptId = await db.insert(
    `INSERT INTO appointments (location_id, calendar_id, contact_id, title, starts_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [calendar.location_id, calendar.id, contact.id, `${calendar.name} with ${name}`, startsAt, endsAt]
  );

  await scoring.addScore(contact.id, 'appointment_booked');
  await scheduler.scheduleAppointmentReminder(calendar, apptId, startsAt);
  await automation.logActivity(calendar.location_id, contact.id, 'appointment', `Booked "${calendar.name}" for ${startsAt}`);
  if (isNew) await automation.trigger(calendar.location_id, 'contact_created', contact);
  await automation.trigger(calendar.location_id, 'appointment_booked', contact, { calendar_id: calendar.id });

  res.status(201).json({ ok: true });
});

// ---- Public client report (/r/<token>) ----
router.get('/r/:token', async (req, res) => {
  const report = await db.get('SELECT * FROM reports WHERE token = ?', [req.params.token]);
  if (!report) return res.status(404).send('Report not found');
  const location = await db.get('SELECT * FROM locations WHERE id = ?', [report.location_id]);
  const stats = JSON.parse(report.data || '{}');
  const created = new Date(report.created_at).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const stat = (label, value) =>
    `<div class="stat"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div></div>`;
  const money = (v) => '$' + Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe — ${esc(location.name)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#f1f4f9;color:#1e293b;line-height:1.6}
.head{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:48px 24px;text-align:center}
.head h1{font-size:1.9rem}.head p{opacity:.85;margin-top:6px}
.wrap{max-width:860px;margin:-30px auto 40px;padding:0 20px}
.card{background:#fff;border-radius:14px;box-shadow:0 4px 18px rgba(15,23,42,.08);padding:28px;margin-bottom:18px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}
.stat{text-align:center;padding:16px 8px;background:#f8fafc;border-radius:10px}
.stat .v{font-size:1.7rem;font-weight:800;color:#4f46e5}.stat .l{font-size:.78rem;color:#64748b;font-weight:600}
.narr{white-space:pre-wrap;font-size:1.02rem}
.foot{text-align:center;color:#94a3b8;font-size:.8rem;padding:20px}
</style></head><body>
<div class="head"><h1>${esc(location.name)}</h1>
<p>Informe de resultados · últimos ${report.period_days} días · ${esc(created)}</p></div>
<div class="wrap">
<div class="card"><div class="stats">
${stat('Contactos nuevos', stats.new_contacts ?? 0)}
${stat('Formularios recibidos', stats.form_submissions ?? 0)}
${stat('Citas agendadas', stats.appointments ?? 0)}
${stat('Mensajes enviados', stats.messages_sent ?? 0)}
${stat('Oportunidades creadas', stats.opportunities_created ?? 0)}
${stat('Pipeline abierto', money(stats.pipeline_value))}
${stat('Ganado en el periodo', money(stats.won_value))}
</div></div>
<div class="card"><h2 style="margin-bottom:10px;font-size:1.1rem">Resumen</h2>
<p class="narr">${esc(report.narrative)}</p></div>
</div>
<div class="foot">Preparado con ❤ por tu equipo de marketing</div>
</body></html>`);
});

// ---- Public invoice payment page (/pay/<token>) ----
router.get('/pay/:token', async (req, res) => {
  const inv = await db.get('SELECT * FROM invoices WHERE token = ?', [req.params.token]);
  if (!inv) return res.status(404).send('Invoice not found');
  const location = await db.get('SELECT * FROM locations WHERE id = ?', [inv.location_id]);
  const contact = inv.contact_id ? await db.get('SELECT * FROM contacts WHERE id = ?', [inv.contact_id]) : null;
  const providers = require('../services/providers');
  const items = JSON.parse(inv.items || '[]');
  const brand = location.brand_color || '#4f46e5';
  const paid = inv.status === 'paid';
  const justPaid = req.query.paid === '1';
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Factura ${esc(inv.number)} — ${esc(location.name)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#f1f4f9;color:#1e293b;line-height:1.6}
.head{background:${esc(brand)};color:#fff;padding:36px 24px;text-align:center}
.head img{max-height:48px;margin-bottom:8px}
.wrap{max-width:560px;margin:-24px auto 40px;padding:0 20px}
.card{background:#fff;border-radius:14px;box-shadow:0 4px 18px rgba(15,23,42,.08);padding:28px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin:14px 0}
td,th{padding:9px 4px;border-bottom:1px solid #e2e8f0;text-align:left;font-size:.92rem}
td:last-child,th:last-child{text-align:right}
.total{font-size:1.4rem;font-weight:800;text-align:right;margin-top:10px}
.btn{display:block;width:100%;background:${esc(brand)};color:#fff;border:none;border-radius:10px;padding:15px;
     font-size:1.05rem;font-weight:700;cursor:pointer;text-align:center;text-decoration:none}
.paid{background:#ecfdf5;border:1px solid #10b981;color:#065f46;padding:16px;border-radius:10px;text-align:center;font-weight:700}
.muted{color:#64748b;font-size:.85rem}.foot{text-align:center;color:#94a3b8;font-size:.8rem;padding:18px}
</style></head><body>
<div class="head">${location.logo_url ? `<img src="${esc(location.logo_url)}" alt="">` : ''}
<h1>${esc(location.name)}</h1><p>Factura ${esc(inv.number)}</p></div>
<div class="wrap"><div class="card">
${contact ? `<p class="muted">Para: ${esc([contact.first_name, contact.last_name].filter(Boolean).join(' '))}</p>` : ''}
${inv.title ? `<h2 style="margin:6px 0">${esc(inv.title)}</h2>` : ''}
${inv.due_date ? `<p class="muted">Vencimiento: ${esc(inv.due_date)}</p>` : ''}
<table><thead><tr><th>Concepto</th><th>Cant.</th><th>Importe</th></tr></thead><tbody>
${items.map((it) => `<tr><td>${esc(it.name)}</td><td>${Number(it.qty) || 1}</td><td>${((Number(it.qty) || 1) * (Number(it.price) || 0)).toFixed(2)} ${esc(inv.currency)}</td></tr>`).join('')}
</tbody></table>
<div class="total">Total: ${inv.total.toFixed(2)} ${esc(inv.currency)}</div>
</div>
<div class="card">
${paid || justPaid
    ? `<div class="paid">✅ Factura pagada${inv.paid_at ? ` el ${new Date(inv.paid_at).toLocaleDateString('es-ES')}` : ''}. ¡Gracias!</div>`
    : inv.status === 'void'
      ? `<div class="paid" style="background:#fef2f2;border-color:#ef4444;color:#b91c1c">Esta factura fue anulada.</div>`
      : providers.paymentsProvider() === 'stripe'
        ? `<form method="post" action="/api/public/pay/${esc(inv.token)}/checkout"><button class="btn">Pagar ${inv.total.toFixed(2)} ${esc(inv.currency)} 💳</button></form>
           <p class="muted" style="text-align:center;margin-top:10px">Pago seguro procesado por Stripe</p>`
        : `<form method="post" action="/api/public/pay/${esc(inv.token)}/simulate-paid"><button class="btn">Pagar ${inv.total.toFixed(2)} ${esc(inv.currency)} (modo prueba)</button></form>
           <p class="muted" style="text-align:center;margin-top:10px">Stripe no está conectado todavía — este botón simula el pago para pruebas.</p>`}
</div>
<div class="foot">Powered by LeadFlow</div></div></body></html>`);
});

router.post('/pay/:token/checkout', async (req, res) => {
  const inv = await db.get('SELECT * FROM invoices WHERE token = ?', [req.params.token]);
  if (!inv) return res.status(404).send('Invoice not found');
  if (inv.status === 'paid') return res.redirect(`/pay/${inv.token}`);
  const providers = require('../services/providers');
  const base = `${req.protocol}://${req.get('host')}`;
  try {
    const session = await providers.createCheckoutSession({
      invoice: inv,
      successUrl: `${base}/pay/${inv.token}?paid=1`,
      cancelUrl: `${base}/pay/${inv.token}`,
    });
    if (!session) return res.redirect(`/pay/${inv.token}`);
    res.redirect(303, session.url);
  } catch (err) {
    res.status(502).send(`Payment error: ${esc(err.message)}`);
  }
});

router.post('/pay/:token/simulate-paid', async (req, res) => {
  const inv = await db.get('SELECT * FROM invoices WHERE token = ?', [req.params.token]);
  if (!inv) return res.status(404).send('Invoice not found');
  const providers = require('../services/providers');
  if (providers.paymentsProvider() === 'stripe')
    return res.status(400).send('Simulated payments are disabled when Stripe is connected');
  await require('./payments').settleInvoice(inv.id, 'simulated');
  res.redirect(`/pay/${inv.token}?paid=1`);
});

// ---- Public review / feedback gate (/review/<token>) ----
router.get('/review/:token', async (req, res) => {
  const rr = await db.get('SELECT * FROM review_requests WHERE token = ?', [req.params.token]);
  if (!rr) return res.status(404).send('Not found');
  const location = await db.get('SELECT * FROM locations WHERE id = ?', [rr.location_id]);
  if (rr.status === 'sent') await db.run(`UPDATE review_requests SET status = 'opened' WHERE id = ?`, [rr.id]);
  const brand = location.brand_color || '#4f46e5';
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Tu opinión — ${esc(location.name)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#f1f4f9;color:#1e293b;text-align:center}
.card{max-width:440px;margin:60px auto;background:#fff;border-radius:16px;box-shadow:0 6px 22px rgba(15,23,42,.1);padding:36px 28px}
h1{font-size:1.3rem;margin-bottom:6px}p{color:#64748b}
.stars{font-size:2.6rem;margin:22px 0;cursor:pointer;user-select:none}
.stars span{opacity:.35;transition:.1s}.stars span.on{opacity:1}
textarea{width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-family:inherit;margin-top:10px}
.btn{background:${esc(brand)};color:#fff;border:none;border-radius:10px;padding:13px 30px;font-weight:700;cursor:pointer;margin-top:14px;font-size:1rem}
#done{display:none;color:#065f46;background:#ecfdf5;border:1px solid #10b981;padding:16px;border-radius:10px;margin-top:16px}
.foot{color:#94a3b8;font-size:.8rem;padding:14px}
</style></head><body>
<div class="card">
<h1>${esc(location.name)}</h1>
<p>¿Cómo fue tu experiencia con nosotros?</p>
<div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<span data-n="${n}">★</span>`).join('')}</div>
<div id="low" style="display:none">
  <p>Sentimos no haber estado a la altura. ¿Qué podemos mejorar?</p>
  <textarea id="comment" rows="4" placeholder="Cuéntanos qué pasó…"></textarea>
  <button class="btn" onclick="send()">Enviar</button>
</div>
<div id="done">¡Gracias por tu opinión! La usaremos para mejorar.</div>
</div>
<div class="foot">Powered by LeadFlow</div>
<script>
const googleLink=${JSON.stringify(location.review_link_google || '')};
let rating=0;
const spans=[...document.querySelectorAll('#stars span')];
spans.forEach(s=>s.addEventListener('click',async()=>{
  rating=Number(s.dataset.n);
  spans.forEach(x=>x.classList.toggle('on',Number(x.dataset.n)<=rating));
  if(rating>=4&&googleLink){
    await post('');
    location.href=googleLink;
  }else{
    document.getElementById('low').style.display='block';
  }
}));
async function post(comment){
  await fetch('/api/public/review/${esc(rr.token)}',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({rating,comment})});
}
async function send(){
  await post(document.getElementById('comment').value);
  document.getElementById('low').style.display='none';
  document.getElementById('done').style.display='block';
}
</script></body></html>`);
});

router.post('/review/:token', async (req, res) => {
  const rr = await db.get('SELECT * FROM review_requests WHERE token = ?', [req.params.token]);
  if (!rr) return res.status(404).json({ error: 'Not found' });
  const rating = Math.min(5, Math.max(1, Number(req.body?.rating) || 0));
  if (!rating) return res.status(400).json({ error: 'rating is required' });
  await db.run(
    `UPDATE review_requests SET rating = ?, comment = ?, status = 'reviewed', responded_at = now() WHERE id = ?`,
    [rating, String(req.body?.comment || '').slice(0, 2000), rr.id]
  );
  await automation.logActivity(
    rr.location_id,
    rr.contact_id,
    'note',
    `Review response: ${rating}★${req.body?.comment ? ` — "${String(req.body.comment).slice(0, 120)}"` : ''}`
  );
  res.json({ ok: true });
});

module.exports = router;
