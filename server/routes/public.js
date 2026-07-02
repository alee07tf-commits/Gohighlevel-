// Public, unauthenticated routes: rendered funnel pages, form capture and
// calendar booking widgets. These are what your clients' leads interact with.
const express = require('express');
const db = require('../db');
const automation = require('../services/automation');

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
  const blocks = JSON.parse(page.content || '[]');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(page.name)}</title>
<style>${PAGE_CSS}</style></head><body>
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
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Book: ${esc(calendar.name)}</title>
<style>${PAGE_CSS}
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

  await db.run(
    `INSERT INTO appointments (location_id, calendar_id, contact_id, title, starts_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [calendar.location_id, calendar.id, contact.id, `${calendar.name} with ${name}`, startsAt, endsAt]
  );

  await automation.logActivity(calendar.location_id, contact.id, 'appointment', `Booked "${calendar.name}" for ${startsAt}`);
  if (isNew) await automation.trigger(calendar.location_id, 'contact_created', contact);
  await automation.trigger(calendar.location_id, 'appointment_booked', contact, { calendar_id: calendar.id });

  res.status(201).json({ ok: true });
});

module.exports = router;
