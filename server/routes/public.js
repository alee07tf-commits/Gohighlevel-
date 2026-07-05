// Public, unauthenticated routes: rendered funnel pages, form capture and
// calendar booking widgets. These are what your clients' leads interact with.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const automation = require('../services/automation');
const scheduler = require('../services/scheduler');
const scoring = require('../services/scoring');
const customValues = require('../services/customValues');
const leads = require('../services/leads');
const secretbox = require('../services/secretbox');
const shopify = require('../services/shopify');
const calendly = require('../services/calendly');

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

// Public white-label branding for a tenant, keyed by its slug. Powers the
// branded client login page so a handed-off account looks like the client's
// own product (logo + colour + name) before the client even signs in.
router.get('/brand/:slug', async (req, res) => {
  const a = await db.get('SELECT name, brand_color, logo_url, signup_headline FROM agencies WHERE slug = ?', [
    req.params.slug,
  ]);
  if (!a) return res.status(404).json({ error: 'not found' });
  res.json({
    name: a.name,
    brand_color: a.brand_color || '#4f46e5',
    logo_url: a.logo_url || '',
    headline: a.signup_headline || '',
  });
});


// ---- Landing page themes (Claude design picks one; user can change it) ----
function themeCss(theme, brand) {
  const base = PAGE_CSS;
  const t = {
    clean: { bg: '#f7fafc', heroBg: `linear-gradient(135deg,${brand},#7c3aed)`, heroText: '#fff', accent: '#f59e0b', font: "'Segoe UI',system-ui,sans-serif", heading: 'inherit' },
    bold: { bg: '#0f172a', heroBg: '#0f172a', heroText: '#fff', accent: brand, font: "'Segoe UI',system-ui,sans-serif", heading: 'inherit' },
    warm: { bg: '#fdf6ee', heroBg: `linear-gradient(135deg,#b45309,${brand})`, heroText: '#fff', accent: '#b45309', font: "Georgia,'Times New Roman',serif", heading: 'inherit' },
    elegant: { bg: '#fafafa', heroBg: '#1c1917', heroText: '#fafaf9', accent: brand, font: "'Segoe UI',system-ui,sans-serif", heading: "Georgia,serif" },
  }[theme] || null;
  if (!t) return base.replaceAll('#4f46e5', brand);
  return (
    base.replaceAll('#4f46e5', brand) +
    `
  body{background:${t.bg};font-family:${t.font}}
  .hero{background:${t.heroBg};color:${t.heroText}}
  .hero h1,.section h2{font-family:${t.heading}}
  .btn{background:${t.accent}}
  ${theme === 'bold' ? `body{color:#e2e8f0}.section p{color:#94a3b8}.feature,form.lead,.t-card,.p-card,details{background:#1e293b;color:#e2e8f0}.feature h3{color:#fff}.section h2{color:#fff}details summary{color:#fff}form.lead label{color:#cbd5e1}form.lead input,form.lead textarea{background:#0f172a;border-color:#334155;color:#e2e8f0}` : ''}
  .t-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;margin-top:26px}
  .t-card{background:#fff;border-radius:12px;padding:22px;box-shadow:0 1px 5px rgba(0,0,0,.08);text-align:left}
  .t-card .t-text{font-style:italic;margin-bottom:10px}
  .t-card .t-name{font-weight:700;font-size:.9rem;opacity:.8}
  .p-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;margin-top:26px}
  .p-card{background:#fff;border-radius:14px;padding:26px;box-shadow:0 2px 8px rgba(0,0,0,.09);text-align:center}
  .p-card .p-price{font-size:2rem;font-weight:800;margin:8px 0}
  .p-card ul{list-style:none;padding:0;margin:12px 0;text-align:left}
  .p-card li{padding:5px 0;border-bottom:1px dashed rgba(128,128,128,.25);font-size:.92rem}
  details{background:#fff;border-radius:10px;padding:14px 18px;margin:10px auto;max-width:640px;box-shadow:0 1px 4px rgba(0,0,0,.07);text-align:left}
  details summary{font-weight:700;cursor:pointer}
  details p{text-align:left;margin-top:8px}
  .cta-band{text-align:center;padding:64px 24px;background:${t.heroBg};color:${t.heroText}}
  .cta-band h2{font-size:1.9rem;margin-bottom:10px;font-family:${t.heading}}
  .cta-band p{opacity:.9;max-width:560px;margin:0 auto 22px}
`
  );
}

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
    case 'testimonials': {
      const cards = (block.items || [])
        .map((t) => `<div class="t-card"><div class="t-text">“${esc(t.text)}”</div><div class="t-name">— ${esc(t.name)}</div></div>`)
        .join('');
      return `<div class="section"><h2>${esc(block.headline || 'Opiniones')}</h2><div class="t-grid">${cards}</div></div>`;
    }
    case 'pricing': {
      const cards = (block.items || [])
        .map(
          (p) => `<div class="p-card"><h3>${esc(p.name)}</h3><div class="p-price">${esc(p.price)}</div>
            <ul>${(p.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
            <a class="btn" href="#lead-form">${esc(block.button || 'Empezar')}</a></div>`
        )
        .join('');
      return `<div class="section"><h2>${esc(block.headline || 'Planes')}</h2><div class="p-grid">${cards}</div></div>`;
    }
    case 'faq': {
      const items = (block.items || [])
        .map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
        .join('');
      return `<div class="section"><h2>${esc(block.headline || 'Preguntas frecuentes')}</h2>${items}</div>`;
    }
    case 'cta':
      return `<div class="cta-band"><h2>${esc(block.headline)}</h2><p>${esc(block.body || '')}</p>
        <a class="btn" href="#lead-form">${esc(block.button || 'Empezar ahora')}</a></div>`;
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
  const css = themeCss(page.theme || 'clean', (loc && loc.brand_color) || '#4f46e5');
  const blocks = JSON.parse(page.content || '[]');
  // Resolve account-level {{custom_values.KEY}} tokens so one template renders
  // per-client (business name, phone, etc.).
  const cv = await customValues.getMap(funnel.location_id);
  const body = customValues.apply(blocks.map((b) => renderBlock(b, page.id)).join('\n'), cv);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(customValues.apply(page.name, cv))}</title>
<style>${css}</style></head><body>
${body}
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

// ---- Generic inbound webhook receiver (connect any external app) ----
// POST any JSON: email/phone (one required), first_name/last_name or name, tag,
// and any extra fields (stored as custom fields). Upserts the contact and fires
// contact_created / form_submitted / tag_added automations.
router.post('/inbound/:token', async (req, res) => {
  const hook = await db.get('SELECT * FROM inbound_webhooks WHERE token = ?', [req.params.token]);
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  const loc = hook.location_id;
  const data = req.body || {};
  const email = String(data.email || '').trim();
  const phone = String(data.phone || data.phone_number || '').trim();
  if (!email && !phone) return res.status(400).json({ error: 'email or phone is required' });

  let first_name = data.first_name || '';
  let last_name = data.last_name || '';
  if (!first_name && data.name) {
    const parts = String(data.name).trim().split(/\s+/);
    first_name = parts[0] || '';
    last_name = parts.slice(1).join(' ');
  }
  const known = new Set(['email', 'phone', 'phone_number', 'first_name', 'last_name', 'name', 'tag']);
  const custom = {};
  for (const [k, v] of Object.entries(data)) if (!known.has(k) && v != null && typeof v !== 'object') custom[k] = v;

  let contact = null;
  if (email) contact = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND email = ? AND email != ''`, [loc, email]);
  if (!contact && phone) contact = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND phone = ? AND phone != ''`, [loc, phone]);
  let isNew = false;
  if (!contact) {
    const id = await db.insert(
      `INSERT INTO contacts (location_id, first_name, last_name, email, phone, source, custom_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [loc, first_name, last_name, email, phone, `webhook:${hook.name}`, JSON.stringify(custom)]
    );
    contact = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
    isNew = true;
  } else if (Object.keys(custom).length) {
    let existing = {};
    try {
      existing = JSON.parse(contact.custom_fields || '{}');
    } catch {
      existing = {};
    }
    await db.run('UPDATE contacts SET custom_fields = ? WHERE id = ?', [JSON.stringify({ ...existing, ...custom }), contact.id]);
  }

  const tag = data.tag || hook.tag;
  if (tag) await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [contact.id, tag]);
  await db.run('UPDATE inbound_webhooks SET last_received_at = now(), received_count = received_count + 1 WHERE id = ?', [hook.id]);
  await scoring.addScore(contact.id, 'form_submitted');
  await automation.logActivity(loc, contact.id, 'form', `Webhook entrante "${hook.name}"`);
  if (isNew) await automation.trigger(loc, 'contact_created', contact);
  await automation.trigger(loc, 'form_submitted', contact, { webhook: hook.name });
  if (tag) await automation.trigger(loc, 'tag_added', contact, { tag });
  res.status(201).json({ ok: true, contact_id: contact.id, created: isNew });
});

// ---- Meta (Facebook/Instagram) Lead Ads webhook ----
// Verification handshake: Meta GETs with hub.challenge; echo it back when the
// verify token matches. Configure this URL as the page's leadgen callback.
router.get('/meta/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === (process.env.META_VERIFY_TOKEN || '')) {
    return res.status(200).send(String(challenge || ''));
  }
  res.sendStatus(403);
});

// Maps a Meta lead's field_data ([{name, values:[...]}]) to our lead shape.
function mapMetaFields(fieldData = []) {
  const out = { email: '', phone: '', name: '', first_name: '', last_name: '', custom: {} };
  for (const f of fieldData) {
    const name = String(f.name || '').toLowerCase();
    const value = Array.isArray(f.values) ? f.values[0] : f.value;
    if (value == null) continue;
    if (name.includes('email')) out.email = value;
    else if (name.includes('phone')) out.phone = value;
    else if (name === 'full_name' || name === 'name') out.name = value;
    else if (name === 'first_name') out.first_name = value;
    else if (name === 'last_name') out.last_name = value;
    else out.custom[f.name] = value;
  }
  return out;
}

// Fetches a lead's fields from the Graph API using the page's stored token.
async function fetchMetaLead(leadgenId, token) {
  try {
    const url = `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${encodeURIComponent(token)}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const json = await resp.json();
    return json.field_data || null;
  } catch {
    return null;
  }
}

// Receives leadgen changes. Always 200 quickly so Meta doesn't retry; ingest is
// best-effort. Maps each change's page_id to a connected sub-account.
router.post('/meta/webhook', async (req, res) => {
  res.sendStatus(200); // acknowledge immediately
  try {
    const entries = (req.body && req.body.entry) || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        if (change.field !== 'leadgen') continue;
        const v = change.value || {};
        const pageId = String(v.page_id || entry.id || '');
        if (!pageId) continue;
        const acct = await db.get(`SELECT * FROM connected_accounts WHERE app = 'meta' AND external_id = ?`, [pageId]);
        if (!acct) continue;

        // Prefer inline field_data (some setups include it); else fetch via Graph.
        let fieldData = v.field_data || null;
        if (!fieldData && v.leadgen_id) {
          let token = '';
          try { token = (secretbox.decrypt(acct.access_token) || {}).v || ''; } catch { token = ''; }
          if (token) fieldData = await fetchMetaLead(v.leadgen_id, token);
        }
        if (!fieldData) continue;

        const m = mapMetaFields(fieldData);
        await leads.ingestLead({
          location_id: acct.location_id,
          email: m.email, phone: m.phone, name: m.name,
          first_name: m.first_name, last_name: m.last_name,
          custom: { ...m.custom, meta_form_id: v.form_id || '' },
          source: 'meta:lead-ad',
          tag: 'meta-lead',
          activityLabel: 'Lead de Meta (Facebook/Instagram)',
        });
      }
    }
  } catch (err) {
    console.error('meta leadgen ingest failed:', err.message);
  }
});

// ---- Shopify store webhooks (orders + customers → CRM) ----
// Creates an opportunity in the sub-account's first pipeline for an order.
async function createOrderOpportunity(locationId, contactId, order) {
  const pipeline = await db.get('SELECT * FROM pipelines WHERE location_id = ? ORDER BY id LIMIT 1', [locationId]);
  if (!pipeline) return false;
  const stage = await db.get('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY position LIMIT 1', [pipeline.id]);
  if (!stage) return false;
  const paid = String(order.financial_status || '').toLowerCase() === 'paid';
  const info = shopify.mapOrder(order);
  await db.run(
    `INSERT INTO opportunities (location_id, pipeline_id, stage_id, contact_id, title, value, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [locationId, pipeline.id, stage.id, contactId, `Shopify ${info.number || 'order'}`.trim(), info.total, paid ? 'won' : 'open']
  );
  return true;
}

router.post('/shopify/webhook', async (req, res) => {
  const shop = req.get('X-Shopify-Shop-Domain') || '';
  const topic = req.get('X-Shopify-Topic') || '';
  const hmac = req.get('X-Shopify-Hmac-Sha256') || '';
  const secret = process.env.SHOPIFY_API_SECRET || '';
  // Verify the payload signature when the app secret is configured.
  if (secret && !shopify.verifyHmac(req.rawBody, hmac, secret)) {
    return res.status(401).json({ error: 'invalid hmac' });
  }
  const acct = await db.get(`SELECT * FROM connected_accounts WHERE app = 'shopify' AND external_id = ?`, [shop]);
  if (!acct) return res.status(404).json({ error: 'store not connected' });

  const loc = acct.location_id;
  const payload = req.body || {};
  const person = shopify.mapCustomer(payload);
  if (!person.email && !person.phone) return res.status(202).json({ ok: true, skipped: 'no contact info' });

  try {
    if (topic.startsWith('orders/')) {
      const info = shopify.mapOrder(payload);
      const { contact_id } = await leads.ingestLead({
        location_id: loc, ...person, custom: info.custom,
        source: 'shopify:order', tag: 'shopify',
        activityLabel: `Pedido de Shopify ${info.number}`.trim(),
      });
      await createOrderOpportunity(loc, contact_id, payload);
      return res.status(200).json({ ok: true, contact_id });
    }
    // customers/create, customers/update
    const { contact_id } = await leads.ingestLead({
      location_id: loc, ...person, source: 'shopify:customer', tag: 'shopify',
      activityLabel: 'Cliente de Shopify',
    });
    return res.status(200).json({ ok: true, contact_id });
  } catch (err) {
    if (err.status === 400) return res.status(202).json({ ok: true, skipped: err.message });
    console.error('shopify webhook failed:', err.message);
    return res.status(200).json({ ok: false });
  }
});

// ---- Calendly webhooks (invitee.created / invitee.canceled → appointment) ----
// Resolves the sub-account's calendar for external bookings, creating a
// dedicated "Calendly" calendar the first time.
async function resolveExternalCalendar(locationId, name) {
  let cal = await db.get('SELECT * FROM calendars WHERE location_id = ? ORDER BY id LIMIT 1', [locationId]);
  if (cal) return cal;
  const slug = `${name.toLowerCase()}-${locationId}-${crypto.randomBytes(3).toString('hex')}`;
  const id = await db.insert('INSERT INTO calendars (location_id, name, slug) VALUES (?, ?, ?)', [locationId, name, slug]);
  return db.get('SELECT * FROM calendars WHERE id = ?', [id]);
}

router.post('/calendly/:token', async (req, res) => {
  const acct = await db.get(`SELECT * FROM connected_accounts WHERE app = 'calendly' AND webhook_token = ?`, [req.params.token]);
  if (!acct) return res.status(404).json({ error: 'connection not found' });
  if (!calendly.verifySignature(req.get('Calendly-Webhook-Signature'), req.rawBody, process.env.CALENDLY_WEBHOOK_SIGNING_KEY || '')) {
    return res.status(401).json({ error: 'invalid signature' });
  }
  const loc = acct.location_id;
  const m = calendly.mapPayload(req.body || {});
  if (!m.contact.email && !m.contact.phone) return res.status(202).json({ ok: true, skipped: 'no contact info' });

  try {
    const { contact_id } = await leads.ingestLead({
      location_id: loc, ...m.contact, source: 'calendly', tag: 'calendly',
      activityLabel: `Calendly: ${m.event.title}`,
    });

    if (m.kind === 'invitee.canceled') {
      // Cancel the matching appointment if we can find it by contact + start.
      await db.run(
        `UPDATE appointments SET status = 'cancelled'
         WHERE location_id = ? AND contact_id = ? AND status = 'confirmed'
         AND (? = '' OR starts_at = ?)`,
        [loc, contact_id, m.event.start_time || '', m.event.start_time || null]
      );
      return res.status(200).json({ ok: true, contact_id, cancelled: true });
    }

    if (m.event.start_time && m.event.end_time) {
      const cal = await resolveExternalCalendar(loc, 'Calendly');
      const appt = await db.insert(
        `INSERT INTO appointments (location_id, calendar_id, contact_id, title, starts_at, ends_at, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [loc, cal.id, contact_id, m.event.title, m.event.start_time, m.event.end_time, 'Reservado vía Calendly']
      );
      const event = { calendar_id: cal.id, status: 'confirmed', id: appt };
      await scoring.addScore(contact_id, 'appointment_booked');
      const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [contact_id]);
      await automation.trigger(loc, 'appointment_booked', contact, event);
      return res.status(200).json({ ok: true, contact_id, appointment_id: appt });
    }
    return res.status(200).json({ ok: true, contact_id });
  } catch (err) {
    if (err.status === 400) return res.status(202).json({ ok: true, skipped: err.message });
    console.error('calendly webhook failed:', err.message);
    return res.status(200).json({ ok: false });
  }
});

// ---- Standalone public form ----
const FORM_LABELS = {
  first_name: { es: 'Nombre', en: 'First name' }, last_name: { es: 'Apellidos', en: 'Last name' },
  email: { es: 'Email', en: 'Email' }, phone: { es: 'Teléfono', en: 'Phone' }, message: { es: 'Mensaje', en: 'Message' },
};
router.get('/form/:slug', async (req, res) => {
  const form = await db.get('SELECT * FROM forms WHERE slug = ?', [req.params.slug]);
  if (!form) return res.status(404).send('Form not found');
  const loc = await db.get('SELECT * FROM locations WHERE id = ?', [form.location_id]);
  const brand = (loc && loc.brand_color) || '#4f46e5';
  const fields = (() => { try { return JSON.parse(form.fields || '[]'); } catch { return ['email']; } })();
  const inputs = fields
    .map((f) => {
      const label = esc((FORM_LABELS[f] || { es: f }).es);
      if (f === 'message') return `<label>${label}<textarea name="${f}" rows="4"></textarea></label>`;
      const type = f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text';
      return `<label>${label}<input name="${f}" type="${type}" ${f === 'email' ? 'required' : ''}></label>`;
    })
    .join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(form.name)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',system-ui,sans-serif;background:#f4f4f7;color:#1a202c;padding:24px}
.card{max-width:460px;margin:40px auto;background:#fff;border-radius:14px;padding:32px;box-shadow:0 6px 22px rgba(0,0,0,.09)}
h1{font-size:1.5rem;margin-bottom:6px}.sub{color:#64748b;margin-bottom:18px}
label{display:block;font-size:.85rem;font-weight:600;margin:12px 0 4px;color:#374151}
input,textarea{width:100%;padding:11px;border:1px solid #d1d5db;border-radius:8px;font-size:.95rem;font-family:inherit}
button{width:100%;margin-top:20px;background:${esc(brand)};color:#fff;border:none;border-radius:9px;padding:13px;font-size:1rem;font-weight:700;cursor:pointer}
.ok{display:none;text-align:center;padding:20px;background:#ecfdf5;border:1px solid #10b981;color:#065f46;border-radius:10px;margin-top:16px}
.head-bar{height:4px;background:${esc(brand)};border-radius:4px;margin:-32px -32px 20px}</style></head>
<body><div class="card"><div class="head-bar"></div>
<h1>${esc(form.headline || form.name)}</h1>
<div class="sub">${esc(loc ? loc.name || loc.company || '' : '')}</div>
<form id="f">${inputs}<button type="submit">Enviar</button></form>
<div class="ok" id="ok">${esc(form.success_message || '¡Gracias! Te contactaremos pronto.')}</div></div>
<script>
document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();
const data=Object.fromEntries(new FormData(e.target).entries());
const r=await fetch('/api/public/form/${esc(form.slug)}/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
if(r.ok){${form.redirect_url ? `location.href=${JSON.stringify(form.redirect_url)};` : `e.target.style.display='none';document.getElementById('ok').style.display='block';`}}
else{const j=await r.json().catch(()=>({}));alert(j.error||'Error');}});
</script></body></html>`;
  res.send(html);
});

router.post('/form/:slug/submit', async (req, res) => {
  const form = await db.get('SELECT * FROM forms WHERE slug = ?', [req.params.slug]);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  const data = req.body || {};
  const email = (data.email || '').trim();
  const phone = (data.phone || '').trim();
  if (!email && !phone) return res.status(400).json({ error: 'email or phone is required' });

  let contact = null;
  if (email) contact = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND email = ? AND email != ''`, [form.location_id, email]);
  if (!contact && phone) contact = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND phone = ? AND phone != ''`, [form.location_id, phone]);
  let isNew = false;
  if (!contact) {
    const id = await db.insert(
      `INSERT INTO contacts (location_id, first_name, last_name, email, phone, source) VALUES (?, ?, ?, ?, ?, ?)`,
      [form.location_id, data.first_name || '', data.last_name || '', email, phone, `form:${form.slug}`]
    );
    contact = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
    isNew = true;
  }
  if (form.tag) await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [contact.id, form.tag]);
  await db.run('INSERT INTO form_submissions (location_id, form_id, contact_id, data) VALUES (?, ?, ?, ?)', [
    form.location_id, form.id, contact.id, JSON.stringify(data),
  ]);
  await scoring.addScore(contact.id, 'form_submitted');
  await automation.logActivity(form.location_id, contact.id, 'form', `Submitted form "${form.name}"`);
  if (isNew) await automation.trigger(form.location_id, 'contact_created', contact);
  await automation.trigger(form.location_id, 'form_submitted', contact, { form_id: form.id });
  if (form.tag) await automation.trigger(form.location_id, 'tag_added', contact, { tag: form.tag });
  res.status(201).json({ ok: true });
});

// ---- Public client-facing course (membership academy) ----
router.get('/course/:token', async (req, res) => {
  const course = await db.get('SELECT * FROM courses WHERE public_token = ? AND is_public = 1', [req.params.token]);
  if (!course) return res.status(404).send('Course not found');
  const lessons = await db.all('SELECT * FROM lessons WHERE course_id = ? ORDER BY position, id', [course.id]);
  const agency = await db.get('SELECT name, brand_color, logo_url FROM agencies WHERE id = ?', [course.agency_id]);
  const brand = (agency && agency.brand_color) || '#4f46e5';
  const lessonHtml = lessons
    .map(
      (l, i) => `<div class="lesson" data-id="${l.id}">
      <div class="lh"><span class="num">${i + 1}</span><h3>${esc(l.title)}</h3>
        <label class="done"><input type="checkbox" class="cb" data-id="${l.id}"> ${'Completada'}</label></div>
      ${l.youtube_id ? `<div class="video"><iframe src="https://www.youtube.com/embed/${esc(l.youtube_id)}" allowfullscreen loading="lazy"></iframe></div>` : ''}
      ${l.body ? `<div class="body">${esc(l.body).replace(/\n/g, '<br>')}</div>` : ''}
    </div>`
    )
    .join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(course.title)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',system-ui,sans-serif;background:#f4f4f7;color:#1a202c}
.top{background:${esc(brand)};color:#fff;padding:34px 20px;text-align:center}.top h1{font-size:1.8rem}.top p{opacity:.9;margin-top:6px}
.wrap{max-width:760px;margin:0 auto;padding:24px}
.bar{height:8px;background:#e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:20px}.bar>div{height:100%;background:${esc(brand)};width:0;transition:width .3s}
.lesson{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.lh{display:flex;align-items:center;gap:10px}.lh h3{flex:1;font-size:1.1rem}.num{background:${esc(brand)};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:700}
.done{font-size:.8rem;color:#64748b;display:flex;align-items:center;gap:5px;white-space:nowrap}
.video{position:relative;padding-bottom:56.25%;height:0;margin:14px 0;border-radius:8px;overflow:hidden}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.body{line-height:1.6;color:#334155;margin-top:8px}.foot{text-align:center;color:#9ca3af;font-size:.8rem;padding:20px}</style></head>
<body><div class="top">${agency && agency.logo_url ? `<img src="${esc(agency.logo_url)}" style="max-height:40px;margin-bottom:8px">` : ''}
<h1>${esc(course.title)}</h1>${course.description ? `<p>${esc(course.description)}</p>` : ''}</div>
<div class="wrap"><div class="bar"><div id="prog"></div></div>${lessonHtml || '<p>Próximamente.</p>'}
<div class="foot">${esc(agency ? agency.name : '')}</div></div>
<script>
const KEY='lfcourse_${esc(course.public_token)}';
const done=new Set(JSON.parse(localStorage.getItem(KEY)||'[]'));
const cbs=[...document.querySelectorAll('.cb')];
function paint(){cbs.forEach(cb=>{cb.checked=done.has(cb.dataset.id)});document.getElementById('prog').style.width=(cbs.length?Math.round(done.size/cbs.length*100):0)+'%';}
cbs.forEach(cb=>cb.addEventListener('change',()=>{cb.checked?done.add(cb.dataset.id):done.delete(cb.dataset.id);localStorage.setItem(KEY,JSON.stringify([...done]));paint();}));
paint();
</script></body></html>`;
  res.send(html);
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

  const { n: booked } = await db.get(
    'SELECT COUNT(*)::int AS n FROM appointments WHERE calendar_id = ? AND starts_at = ? AND status != ?',
    [calendar.id, startsAt, 'cancelled']
  );
  if (booked >= (calendar.capacity || 1))
    return res.status(409).json({ error: 'That slot is already taken, pick another time.' });

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

  // Round-robin assignment across the calendar's team members, if configured.
  let assignedUserId = null;
  try {
    const assignees = JSON.parse(calendar.assignees || '[]');
    if (Array.isArray(assignees) && assignees.length) {
      assignedUserId = assignees[(calendar.round_robin_next || 0) % assignees.length] || null;
      await db.run('UPDATE calendars SET round_robin_next = round_robin_next + 1 WHERE id = ?', [calendar.id]);
      if (assignedUserId)
        await db.run('UPDATE contacts SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL', [assignedUserId, contact.id]);
    }
  } catch {
    /* malformed assignees → skip assignment */
  }

  const apptId = await db.insert(
    `INSERT INTO appointments (location_id, calendar_id, contact_id, title, starts_at, ends_at, assigned_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [calendar.location_id, calendar.id, contact.id, `${calendar.name} with ${name}`, startsAt, endsAt, assignedUserId]
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
<h1>${esc(location.name)}</h1><p>${inv.kind === 'quote' ? 'Presupuesto' : 'Factura'} ${esc(inv.number)}</p></div>
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
      : inv.kind === 'quote'
        ? `<form method="post" action="/api/public/pay/${esc(inv.token)}/accept-quote"><button class="btn">✓ Aceptar presupuesto (${inv.total.toFixed(2)} ${esc(inv.currency)})</button></form>
           <p class="muted" style="text-align:center;margin-top:10px">Al aceptarlo se convierte en factura y podrás pagarla.</p>`
        : (await providers.paymentsProvider({ locationId: inv.location_id })) === 'stripe'
        ? `<form method="post" action="/api/public/pay/${esc(inv.token)}/checkout"><button class="btn">Pagar ${inv.total.toFixed(2)} ${esc(inv.currency)} 💳</button></form>
           <p class="muted" style="text-align:center;margin-top:10px">Pago seguro procesado por Stripe</p>`
        : `<form method="post" action="/api/public/pay/${esc(inv.token)}/simulate-paid"><button class="btn">Pagar ${inv.total.toFixed(2)} ${esc(inv.currency)} (modo prueba)</button></form>
           <p class="muted" style="text-align:center;margin-top:10px">Stripe no está conectado todavía — este botón simula el pago para pruebas.</p>`}
</div>
<div class="foot">Powered by LeadFlow</div></div></body></html>`);
});

// Quote acceptance: converts the estimate into a payable invoice and
// notifies the business via an activity + contact tag.
router.post('/pay/:token/accept-quote', async (req, res) => {
  const inv = await db.get('SELECT * FROM invoices WHERE token = ?', [req.params.token]);
  if (!inv || inv.kind !== 'quote') return res.status(404).send('Quote not found');
  await db.run(`UPDATE invoices SET kind = 'invoice', status = 'sent' WHERE id = ?`, [inv.id]);
  if (inv.contact_id) {
    const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [inv.contact_id]);
    await automation.logActivity(inv.location_id, inv.contact_id, 'note', `✅ Presupuesto ${inv.number} ACEPTADO (${inv.total.toFixed(2)} ${inv.currency})`);
    await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [inv.contact_id, 'presupuesto-aceptado']);
    await automation.trigger(inv.location_id, 'tag_added', contact, { tag: 'presupuesto-aceptado' });
  }
  res.redirect(`/pay/${inv.token}`);
});

router.post('/pay/:token/checkout', async (req, res) => {
  const inv = await db.get('SELECT * FROM invoices WHERE token = ?', [req.params.token]);
  if (!inv) return res.status(404).send('Invoice not found');
  if (inv.status === 'paid') return res.redirect(`/pay/${inv.token}`);
  const providers = require('../services/providers');
  const base = `${req.protocol}://${req.get('host')}`;
  try {
    const session = await providers.createCheckoutSession(
      { invoice: inv, successUrl: `${base}/pay/${inv.token}?paid=1`, cancelUrl: `${base}/pay/${inv.token}` },
      { locationId: inv.location_id }
    );
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
  if ((await providers.paymentsProvider({ locationId: inv.location_id })) === 'stripe')
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
  const reviewContact = await db.get('SELECT * FROM contacts WHERE id = ?', [rr.contact_id]);
  await automation.trigger(rr.location_id, 'review_received', reviewContact, { rating });
  res.json({ ok: true });
});

// ---- Trigger links (/l/<slug>?c=<contactId>) ----
// Counts the click, optionally tags the contact (firing tag automations),
// then redirects to the target URL.
router.get('/l/:slug', async (req, res) => {
  const link = await db.get('SELECT * FROM trigger_links WHERE slug = ?', [req.params.slug]);
  if (!link) return res.status(404).send('Link not found');
  await db.run('UPDATE trigger_links SET clicks = clicks + 1 WHERE id = ?', [link.id]);
  const contactId = Number(req.query.c);
  if (contactId) {
    const contact = await db.get('SELECT * FROM contacts WHERE id = ? AND location_id = ?', [
      contactId,
      link.location_id,
    ]);
    if (contact) {
      await automation.logActivity(link.location_id, contact.id, 'note', `Clicked trigger link "${link.name}"`);
      if (link.tag) {
        const info = await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [
          contact.id, link.tag,
        ]);
        if (info.changes) await automation.trigger(link.location_id, 'tag_added', contact, { tag: link.tag });
      }
    }
  }
  res.redirect(link.target_url);
});

// ---- SaaS Mode: branded self-serve signup ----
// Public plan-selection + signup page for an agency (`/signup/<agencySlug>`).
router.get('/signup/:slug', async (req, res) => {
  const agency = await db.get('SELECT * FROM agencies WHERE slug = ?', [req.params.slug]);
  if (!agency) return res.status(404).send('Página de registro no encontrada');
  const plans = await db.all('SELECT * FROM plans WHERE agency_id = ? AND is_public = 1 ORDER BY price', [agency.id]);
  const brand = agency.brand_color || '#4f46e5';
  const planCards = plans.length
    ? plans
        .map(
          (p) => `<label class="plan"><input type="radio" name="plan_id" value="${p.id}" ${p.id === plans[0].id ? 'checked' : ''}>
        <div class="pc"><div class="pn">${esc(p.name)}</div>
          <div class="pp">${Number(p.price).toFixed(2)} ${esc(p.currency)}<span>/${p.interval === 'yearly' ? 'año' : 'mes'}</span></div>
          <div class="pd">${esc(p.description || '')}</div></div></label>`
        )
        .join('')
    : '<p>Este agencia aún no tiene planes disponibles.</p>';
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(agency.name)} — Crea tu cuenta</title>
<style>*{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
.head{background:${brand};color:#fff;padding:34px 20px;text-align:center}.head img{max-height:44px;margin-bottom:10px}
.head h1{margin:0;font-size:26px}.head p{margin:8px 0 0;opacity:.9}
.wrap{max-width:560px;margin:24px auto;padding:0 16px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;margin-bottom:16px}
.plan{display:block;margin-bottom:10px;cursor:pointer}.plan input{position:absolute;opacity:0}
.pc{border:2px solid #e5e7eb;border-radius:10px;padding:14px}.plan input:checked+.pc{border-color:${brand};box-shadow:0 0 0 3px ${brand}22}
.pn{font-weight:700}.pp{font-size:22px;font-weight:800;color:${brand};margin:4px 0}.pp span{font-size:13px;color:#64748b;font-weight:500}.pd{color:#64748b;font-size:13px}
label.field{display:block;margin-bottom:12px}label.field span{display:block;font-size:13px;color:#475569;margin-bottom:4px}
input.in{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px}
.btn{width:100%;background:${brand};color:#fff;border:0;border-radius:9px;padding:13px;font-size:16px;font-weight:600;cursor:pointer}
.msg{padding:12px;border-radius:8px;margin-bottom:12px;display:none}.err{background:#fef2f2;color:#b91c1c}.ok{background:#f0fdf4;color:#15803d}
.foot{text-align:center;color:#94a3b8;font-size:12px;padding:20px}</style></head>
<body><div class="head">${agency.logo_url ? `<img src="${esc(agency.logo_url)}" alt="">` : ''}
<h1>${esc(agency.signup_headline || `Crea tu cuenta en ${agency.name}`)}</h1>
<p>Empieza en menos de un minuto — tu cuenta se configura sola.</p></div>
<div class="wrap"><form id="f">
  <div class="msg" id="msg"></div>
  <div class="card"><strong>Elige tu plan</strong><div style="margin-top:12px">${planCards}</div></div>
  <div class="card">
    <label class="field"><span>Tu nombre</span><input class="in" name="name" required></label>
    <label class="field"><span>Nombre del negocio</span><input class="in" name="business_name" required></label>
    <label class="field"><span>Email</span><input class="in" type="email" name="email" required></label>
    <button class="btn" id="sb">Crear mi cuenta</button>
  </div>
</form><div class="foot">Powered by LeadFlow</div></div>
<script>
const f=document.getElementById('f'),msg=document.getElementById('msg');
f.addEventListener('submit',async e=>{e.preventDefault();const b=document.getElementById('sb');b.disabled=true;b.textContent='Creando…';
const data=Object.fromEntries(new FormData(f).entries());
try{const r=await fetch('/api/public/saas/${esc(agency.slug)}/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const j=await r.json();if(!r.ok)throw new Error(j.error||'Error');
if(j.mode==='stripe'&&j.url){location.href=j.url;return;}
msg.className='msg ok';msg.style.display='block';msg.textContent='¡Cuenta creada! Revisa tu email para acceder.';f.reset();
}catch(err){msg.className='msg err';msg.style.display='block';msg.textContent=err.message;}
b.disabled=false;b.textContent='Crear mi cuenta';});
</script></body></html>`);
});

// Self-serve signup submit. Simulated when the agency has no Stripe connected;
// otherwise redirects to a Stripe subscription checkout (provisioned on paid).
router.post('/saas/:slug/signup', async (req, res) => {
  const agency = await db.get('SELECT * FROM agencies WHERE slug = ?', [req.params.slug]);
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada' });
  const { plan_id, name, email, business_name } = req.body || {};
  if (!name || !email || !business_name) return res.status(400).json({ error: 'Completa todos los campos' });
  const plan = await db.get('SELECT * FROM plans WHERE id = ? AND agency_id = ? AND is_public = 1', [plan_id, agency.id]);
  if (!plan) return res.status(400).json({ error: 'Plan no válido' });
  if (await db.get('SELECT id FROM users WHERE email = ?', [email]))
    return res.status(409).json({ error: 'Ese email ya tiene una cuenta' });

  const providers = require('../services/providers');
  const stripeOn = (await providers.paymentsProvider({ agencyId: agency.id })) === 'stripe';
  if (stripeOn) {
    const base = `${req.protocol}://${req.get('host')}`;
    try {
      const session = await providers.createSubscriptionCheckout(
        {
          plan, customerEmail: email,
          successUrl: `${base}/signup/${agency.slug}?welcome=1`,
          cancelUrl: `${base}/signup/${agency.slug}`,
          metadata: { saas_plan: plan.id, saas_agency: agency.id, saas_name: name, saas_email: email, saas_business: business_name },
        },
        { agencyId: agency.id }
      );
      return res.json({ mode: 'stripe', url: session ? session.url : null });
    } catch (err) {
      return res.status(502).json({ error: 'No se pudo iniciar el pago. Inténtalo de nuevo.', detail: err.message });
    }
  }

  const saas = require('../services/saas');
  const out = await saas.provisionFromPlan({ agency, plan, client: { name, email, business_name } });
  res.status(201).json({ mode: 'simulated', ok: true, location_id: out.locationId, login_url: '/', temp_password: out.password });
});

module.exports = router;
