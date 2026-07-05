import { api } from '../api.js';
import { esc, openModal, closeOverlay, toast, fmtDate, fullName } from '../ui.js';

const BLOCK_TYPES = {
  hero: 'Hero', text: 'Texto', features: 'Features', testimonials: 'Testimonios',
  pricing: 'Precios', faq: 'FAQ', cta: 'CTA', form: 'Formulario',
};
const THEMES = { clean: 'Clean (claro)', bold: 'Bold (oscuro)', warm: 'Warm (cálido)', elegant: 'Elegant (serif)' };

export async function renderFunnels(view, rest = []) {
  if (rest[0]) return renderBuilder(view, Number(rest[0]));
  const funnels = await api('/funnels');

  view.innerHTML = `
  <div class="page-header">
    <h1>Sites & Funnels</h1>
    <div class="spacer"></div>
    <button class="btn" id="ai-funnel">Crear con IA (Claude design)</button>
    <button class="btn secondary" id="new-funnel">+ Funnel en blanco</button>
  </div>
  ${
    funnels.length
      ? `<div class="grid-2">${funnels
          .map(
            (f) => `<div class="card"><div class="card-body">
              <div class="flex"><strong style="font-size:15px">${esc(f.name)}</strong>
                <div class="right">
                  <a class="btn secondary small" href="#/funnels/${f.id}">Edit pages</a>
                  <button class="btn ghost small del-funnel" data-id="${f.id}">✕</button></div></div>
              <div class="muted" style="margin:8px 0;font-size:12px">${f.pages.length} page(s)</div>
              ${f.pages
                .map(
                  (p) => `<div style="font-size:13px;margin:3px 0">
                    ${p.published ? '' : ''} ${esc(p.name)} —
                    <a href="/f/${esc(f.slug)}/${esc(p.slug)}" target="_blank"><code class="inline">/f/${esc(f.slug)}/${esc(p.slug)}</code> ↗</a></div>`
                )
                .join('')}
            </div></div>`
          )
          .join('')}</div>`
      : '<div class="empty card" style="padding:60px"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>No funnels yet. Build landing pages that capture leads straight into your CRM.</div>'
  }`;

  view.querySelector('#ai-funnel').addEventListener('click', () => {
    const modal = openModal(`
      <h2>Claude design — genera tu landing</h2>
      <p class="muted" style="margin-bottom:12px">Describe el negocio y la oferta; la IA diseña la página completa (estructura, textos y tema). Después podrás <strong>editar cada bloque</strong> antes de publicar.</p>
      <label class="field"><span class="label">Negocio</span><input class="input" id="ai-business" placeholder="Clínica dental en Madrid especializada en estética"></label>
      <label class="field"><span class="label">Oferta / servicio a promocionar</span><input class="input" id="ai-offer" placeholder="Blanqueamiento dental con 20% de descuento este mes"></label>
      <div class="form-row">
        <label class="field"><span class="label">Público objetivo</span><input class="input" id="ai-audience" placeholder="Adultos 25-50 de la zona"></label>
        <label class="field"><span class="label">Objetivo</span><select class="input" id="ai-goal">
          <option value="captar leads">Captar leads</option><option value="booking">Reservar citas</option>
          <option value="vender">Vender directamente</option></select></label>
      </div>
      <label class="field"><span class="label">Tono</span><select class="input" id="ai-tone">
        <option>cercano y profesional</option><option>premium y elegante</option><option>directo y urgente</option><option>divertido y fresco</option>
      </select></label>
      <div class="modal-actions">
        <button class="btn secondary" id="cancel">Cancelar</button>
        <button class="btn" id="gen">Generar landing</button>
      </div>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#gen').addEventListener('click', async () => {
      const btn = modal.querySelector('#gen');
      btn.disabled = true;
      btn.textContent = 'Diseñando… (10-20s)';
      try {
        const result = await api('/ai/funnel', {
          method: 'POST',
          body: {
            business: modal.querySelector('#ai-business').value,
            offer: modal.querySelector('#ai-offer').value,
            audience: modal.querySelector('#ai-audience').value,
            goal: modal.querySelector('#ai-goal').value,
            tone: modal.querySelector('#ai-tone').value,
          },
        });
        closeOverlay();
        toast(result.generated_by === 'claude' ? 'Landing diseñada por Claude' : 'Landing generada con plantilla (conecta ANTHROPIC_API_KEY para diseño IA real)');
        location.hash = `#/funnels/${result.funnel_id}`;
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = 'Generar landing';
      }
    });
  });
  view.querySelector('#new-funnel').addEventListener('click', async () => {
    const name = prompt('Funnel name:');
    if (!name) return;
    const f = await api('/funnels', { method: 'POST', body: { name } });
    location.hash = `#/funnels/${f.id}`;
  });
  view.querySelectorAll('.del-funnel').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete funnel and all its pages?')) return;
      await api(`/funnels/${b.dataset.id}`, { method: 'DELETE' });
      renderFunnels(view);
    })
  );
}

async function renderBuilder(view, funnelId) {
  const funnels = await api('/funnels');
  const funnel = funnels.find((f) => f.id === funnelId);
  if (!funnel) {
    location.hash = '#/funnels';
    return;
  }
  let pageId = Number(sessionStorage.getItem('lf_page')) || funnel.pages[0]?.id;
  let page = funnel.pages.find((p) => p.id === pageId) || funnel.pages[0];

  view.innerHTML = `
  <div class="page-header">
    <a href="#/funnels" class="btn secondary small">← Funnels</a>
    <h1>${esc(funnel.name)}</h1>
    <select class="input" id="page-select" style="width:180px">
      ${funnel.pages.map((p) => `<option value="${p.id}" ${p.id === page?.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    </select>
    <button class="btn secondary small" id="new-page">+ Page</button>
    <button class="btn secondary small" id="view-subs">Submissions</button>
    <div class="spacer"></div>
    <select class="input" id="theme-select" style="width:150px" title="Tema visual">
      ${Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
    </select>
    <button class="btn secondary small" id="ai-redesign" title="La IA rediseña esta página (podrás editarla después)">Rediseñar</button>
    <label class="flex" style="font-size:13px"><input type="checkbox" id="published"> Published</label>
    <a class="btn secondary" target="_blank" id="preview-link">Open ↗</a>
    <button class="btn" id="save-page">Save</button>
  </div>
  <div class="builder">
    <div class="card"><div class="card-title">Page Blocks</div><div class="card-body">
      <div id="blocks"></div>
      <div class="flex" style="margin-top:10px">
        <select class="input" id="new-block-type">${Object.entries(BLOCK_TYPES)
          .map(([k, v]) => `<option value="${k}">${v}</option>`)
          .join('')}</select>
        <button class="btn secondary" id="add-block">+ Add</button>
      </div>
    </div></div>
    <iframe class="preview-frame" id="preview"></iframe>
  </div>`;

  let blocks = [];

  function loadPage() {
    if (!page) return;
    sessionStorage.setItem('lf_page', page.id);
    blocks = structuredClone(page.content || []);
    view.querySelector('#published').checked = !!page.published;
    view.querySelector('#theme-select').value = page.theme || 'clean';
    view.querySelector('#preview-link').href = `/f/${funnel.slug}/${page.slug}`;
    renderBlocks();
    refreshPreview();
  }

  function blockFields(b, i) {
    const input = (k, ph, val) =>
      `<input class="input" data-i="${i}" data-k="${k}" placeholder="${ph}" value="${esc(val || '')}" style="margin-bottom:6px">`;
    switch (b.type) {
      case 'hero':
        return input('headline', 'Headline', b.headline) + input('subheadline', 'Subheadline', b.subheadline) + input('cta', 'Button text', b.cta);
      case 'text':
        return input('headline', 'Headline', b.headline) +
          `<textarea class="input" data-i="${i}" data-k="body" rows="3" placeholder="Body text">${esc(b.body || '')}</textarea>`;
      case 'features':
        return input('headline', 'Section headline', b.headline) +
          `<textarea class="input" data-i="${i}" data-k="items_raw" rows="3" placeholder="One per line: Title | Description">${esc(
            (b.items || []).map((f) => `${f.title} | ${f.body}`).join('\n')
          )}</textarea>`;
      case 'testimonials':
        return input('headline', 'Título de la sección', b.headline) +
          `<textarea class="input" data-i="${i}" data-k="t_items_raw" rows="3" placeholder="Una por línea: Nombre | Testimonio">${esc(
            (b.items || []).map((t) => `${t.name} | ${t.text}`).join('\n')
          )}</textarea>`;
      case 'pricing':
        return input('headline', 'Título de la sección', b.headline) + input('button', 'Texto del botón', b.button) +
          `<textarea class="input" data-i="${i}" data-k="p_items_raw" rows="3" placeholder="Uno por línea: Plan | Precio | característica; característica; …">${esc(
            (b.items || []).map((p) => `${p.name} | ${p.price} | ${(p.features || []).join('; ')}`).join('\n')
          )}</textarea>`;
      case 'faq':
        return input('headline', 'Título de la sección', b.headline) +
          `<textarea class="input" data-i="${i}" data-k="f_items_raw" rows="4" placeholder="Una por línea: ¿Pregunta? | Respuesta">${esc(
            (b.items || []).map((f) => `${f.q} | ${f.a}`).join('\n')
          )}</textarea>`;
      case 'cta':
        return input('headline', 'Titular', b.headline) + input('body', 'Texto de apoyo', b.body) + input('button', 'Texto del botón', b.button);
      case 'form':
        return input('headline', 'Form headline', b.headline) + input('button', 'Button text', b.button) +
          input('tag', 'Tag applied to leads (fires automations)', b.tag) +
          input('success_message', 'Success message', b.success_message) +
          `<label style="font-size:12px" class="muted">Fields:
            ${['first_name', 'last_name', 'email', 'phone', 'message']
              .map(
                (f) => `<label style="margin-right:8px"><input type="checkbox" data-i="${i}" data-field="${f}" ${
                  (b.fields || []).includes(f) ? 'checked' : ''
                }> ${f}</label>`
              )
              .join('')}</label>`;
      default:
        return '';
    }
  }

  function renderBlocks() {
    const el = view.querySelector('#blocks');
    el.innerHTML = blocks.length
      ? blocks
          .map(
            (b, i) => `<div class="block-item">
              <div class="b-head"><span>${BLOCK_TYPES[b.type] || b.type}</span>
                <span>
                  <button class="btn ghost small mv" data-i="${i}" data-d="-1">↑</button>
                  <button class="btn ghost small mv" data-i="${i}" data-d="1">↓</button>
                  <button class="btn ghost small rm" data-i="${i}">✕</button></span></div>
              ${blockFields(b, i)}
            </div>`
          )
          .join('')
      : '<p class="muted">Empty page — add a block below.</p>';

    el.querySelectorAll('.rm').forEach((b) =>
      b.addEventListener('click', () => { blocks.splice(Number(b.dataset.i), 1); renderBlocks(); refreshPreview(); })
    );
    el.querySelectorAll('.mv').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i), d = Number(b.dataset.d), j = i + d;
        if (j < 0 || j >= blocks.length) return;
        [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
        renderBlocks();
        refreshPreview();
      })
    );
    el.querySelectorAll('[data-k]').forEach((input) =>
      input.addEventListener('input', () => {
        const b = blocks[Number(input.dataset.i)];
        if (input.dataset.k === 'items_raw') {
          b.items = input.value.split('\n').filter(Boolean).map((line) => {
            const [title, ...restParts] = line.split('|');
            return { title: (title || '').trim(), body: restParts.join('|').trim() };
          });
        } else if (input.dataset.k === 't_items_raw') {
          b.items = input.value.split('\n').filter(Boolean).map((line) => {
            const [name, ...restParts] = line.split('|');
            return { name: (name || '').trim(), text: restParts.join('|').trim() };
          });
        } else if (input.dataset.k === 'p_items_raw') {
          b.items = input.value.split('\n').filter(Boolean).map((line) => {
            const [name, price, feats] = line.split('|');
            return { name: (name || '').trim(), price: (price || '').trim(),
              features: (feats || '').split(';').map((f) => f.trim()).filter(Boolean) };
          });
        } else if (input.dataset.k === 'f_items_raw') {
          b.items = input.value.split('\n').filter(Boolean).map((line) => {
            const [q, ...restParts] = line.split('|');
            return { q: (q || '').trim(), a: restParts.join('|').trim() };
          });
        } else b[input.dataset.k] = input.value;
        refreshPreviewDebounced();
      })
    );
    el.querySelectorAll('[data-field]').forEach((cb) =>
      cb.addEventListener('change', () => {
        const b = blocks[Number(cb.dataset.i)];
        b.fields = b.fields || [];
        if (cb.checked) b.fields.push(cb.dataset.field);
        else b.fields = b.fields.filter((f) => f !== cb.dataset.field);
        refreshPreviewDebounced();
      })
    );
  }

  let previewTimer;
  function refreshPreviewDebounced() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 600);
  }
  async function refreshPreview() {
    // Save-less live preview: temporarily render via srcdoc using the same block structure.
    // For fidelity we just save-then-reload if published; otherwise show a lightweight preview.
    const iframe = view.querySelector('#preview');
    if (page.published) {
      await savePage(true);
      iframe.src = `/f/${funnel.slug}/${page.slug}?t=${Date.now()}`;
    } else {
      iframe.srcdoc = `<body style="font-family:system-ui;padding:40px;color:#334155">
        <h2>Draft preview</h2><p>Publish the page to see the live rendered version.</p>
        <pre style="background:#f1f5f9;padding:14px;border-radius:8px;font-size:12px;white-space:pre-wrap">${esc(
          JSON.stringify(blocks, null, 2)
        )}</pre></body>`;
    }
  }

  async function savePage(silent = false) {
    const updated = await api(`/funnels/${funnel.id}/pages/${page.id}`, {
      method: 'PUT',
      body: { content: blocks, published: view.querySelector('#published').checked, theme: view.querySelector('#theme-select').value },
    });
    page = updated;
    const idx = funnel.pages.findIndex((p) => p.id === page.id);
    funnel.pages[idx] = updated;
    if (!silent) toast('Page saved');
  }

  view.querySelector('#page-select').addEventListener('change', (e) => {
    page = funnel.pages.find((p) => p.id === Number(e.target.value));
    loadPage();
  });
  view.querySelector('#new-page').addEventListener('click', async () => {
    const name = prompt('Page name:');
    if (!name) return;
    const p = await api(`/funnels/${funnel.id}/pages`, { method: 'POST', body: { name } });
    funnel.pages.push(p);
    page = p;
    renderBuilder(view, funnelId);
  });
  view.querySelector('#add-block').addEventListener('click', () => {
    const type = view.querySelector('#new-block-type').value;
    const defaults = {
      hero: { type, headline: 'Tu gran promesa', subheadline: 'Explica el valor en una frase', cta: 'Empezar' },
      text: { type, headline: 'Título de sección', body: 'Escribe algo persuasivo aquí.' },
      features: { type, headline: 'Por qué elegirnos', items: [{ title: 'Rápido', body: 'Entregamos con rapidez.' }] },
      form: { type, headline: 'Solicita tu presupuesto gratis', button: 'Enviar', fields: ['first_name', 'email', 'phone'], success_message: '¡Gracias! Te contactaremos muy pronto.', tag: '' },
      testimonials: { type, headline: 'Lo que dicen nuestros clientes', items: [{ name: 'María G.', text: 'Servicio excelente, lo recomiendo.' }] },
      pricing: { type, headline: 'Planes y precios', button: 'Empezar', items: [{ name: 'Básico', price: '49€/mes', features: ['Incluye A', 'Incluye B'] }] },
      faq: { type, headline: 'Preguntas frecuentes', items: [{ q: '¿Cómo funciona?', a: 'Muy sencillo: nos dejas tus datos y te contactamos.' }] },
      cta: { type, headline: '¿Listo para empezar?', body: 'Da el primer paso hoy.', button: 'Quiero empezar' },
    };
    blocks.push(defaults[type]);
    renderBlocks();
    refreshPreview();
  });
  view.querySelector('#save-page').addEventListener('click', async () => {
    await savePage();
    refreshPreview();
  });
  view.querySelector('#published').addEventListener('change', () => savePage());
  view.querySelector('#theme-select').addEventListener('change', async () => {
    await savePage(true);
    toast('Tema aplicado');
    refreshPreview();
  });
  view.querySelector('#ai-redesign').addEventListener('click', async () => {
    if (!confirm('La IA rediseñará esta página (estructura y textos). Podrás editar el resultado. ¿Continuar?')) return;
    const btn = view.querySelector('#ai-redesign');
    btn.disabled = true;
    btn.textContent = 'Diseñando…';
    try {
      const offer = prompt('¿Qué quieres promocionar en esta página?', funnel.name) || funnel.name;
      await api('/ai/funnel', { method: 'POST', body: { offer, funnel_id: funnel.id, page_id: page.id } });
      toast('Página rediseñada — revisa y edita antes de guardar');
      renderBuilder(view, funnelId);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = 'Rediseñar';
    }
  });
  view.querySelector('#view-subs').addEventListener('click', async () => {
    const subs = await api(`/funnels/${funnel.id}/submissions`);
    openModal(`
      <h2>Form Submissions (${subs.length})</h2>
      ${
        subs.length
          ? subs
              .map(
                (s) => `<div class="block-item">
                  <div class="b-head"><span>${esc(fullName(s))}</span><span class="muted">${fmtDate(s.created_at)}</span></div>
                  <div style="font-size:12px">${Object.entries(s.data)
                    .map(([k, v]) => `<div><strong>${esc(k)}:</strong> ${esc(v)}</div>`)
                    .join('')}</div>
                  ${s.contact_id ? `<a href="#/contacts/${s.contact_id}" onclick="document.getElementById('modal-root').innerHTML=''">View contact →</a>` : ''}
                </div>`
              )
              .join('')
          : '<div class="empty">No submissions yet</div>'
      }`);
  });

  loadPage();
}
