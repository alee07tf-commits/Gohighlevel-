import { api } from '../api.js';
import { esc, openModal, closeOverlay, toast, fmtDate, fullName } from '../ui.js';
import { t } from '../i18n.js';

const BLOCK_TYPES = {
  hero: 'Hero', split: 'Texto + Imagen', image: 'Imagen', text: 'Texto', features: 'Features',
  testimonials: 'Testimonios', pricing: 'Precios', faq: 'FAQ', cta: 'CTA', form: 'Formulario',
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
                  <a class="btn secondary small" href="#/funnels/${f.id}">${t('Editar páginas', 'Edit pages')}</a>
                  <button class="btn ghost small del-funnel" data-id="${f.id}">✕</button></div></div>
              <div class="muted" style="margin:8px 0;font-size:12px">${f.pages.length} ${t('página(s)', 'page(s)')}</div>
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
      : `<div class="empty card" style="padding:60px"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>${t('Aún no hay funnels. Crea landing pages que capturen leads directamente en tu CRM.', 'No funnels yet. Build landing pages that capture leads straight into your CRM.')}</div>`
  }`;

  view.querySelector('#ai-funnel').addEventListener('click', () => {
    const modal = openModal(`
      <h2>Claude design — genera tu landing</h2>
      <p class="muted" style="margin-bottom:12px">Escribe lo que quieres, como se lo dirías a un diseñador. La IA crea la página completa (estructura, textos y tema) y después podrás <strong>editar cada bloque</strong> antes de publicar.</p>
      <label class="field"><span class="label">Describe tu página</span>
        <textarea class="input" id="ai-prompt" rows="4" placeholder="Ej: Una landing para mi clínica dental en Madrid que promocione el blanqueamiento con 20% de descuento este mes. Público adulto 25-50. Que transmita confianza y sea premium, con testimonios y un formulario para pedir cita."></textarea></label>
      <details style="margin-bottom:10px"><summary class="muted" style="cursor:pointer;font-size:13px">Detalles opcionales (afinar)</summary>
        <div style="padding-top:8px">
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
        </div>
      </details>
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
            prompt: modal.querySelector('#ai-prompt').value,
            business: modal.querySelector('#ai-business').value,
            offer: modal.querySelector('#ai-offer').value,
            audience: modal.querySelector('#ai-audience').value,
            goal: modal.querySelector('#ai-goal').value,
            tone: modal.querySelector('#ai-tone').value,
          },
        });
        closeOverlay();
        toast(result.generated_by === 'claude' ? t('Landing diseñada por Claude', 'Landing designed by Claude') : t('Landing generada con plantilla (conecta ANTHROPIC_API_KEY para diseño IA real)', 'Landing generated from template (connect ANTHROPIC_API_KEY for real AI design)'));
        location.hash = `#/funnels/${result.funnel_id}`;
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = 'Generar landing';
      }
    });
  });
  view.querySelector('#new-funnel').addEventListener('click', async () => {
    const name = prompt(t('Nombre del funnel:', 'Funnel name:'));
    if (!name) return;
    const f = await api('/funnels', { method: 'POST', body: { name } });
    location.hash = `#/funnels/${f.id}`;
  });
  view.querySelectorAll('.del-funnel').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('¿Eliminar el funnel y todas sus páginas?', 'Delete funnel and all its pages?'))) return;
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
    <a href="#/funnels" class="btn secondary small">${t('← Funnels', '← Funnels')}</a>
    <h1>${esc(funnel.name)}</h1>
    <select class="input" id="page-select" style="width:180px">
      ${funnel.pages.map((p) => `<option value="${p.id}" ${p.id === page?.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    </select>
    <button class="btn secondary small" id="new-page">${t('+ Página', '+ Page')}</button>
    <button class="btn secondary small" id="view-subs">${t('Envíos', 'Submissions')}</button>
    <div class="spacer"></div>
    <select class="input" id="theme-select" style="width:150px" title="Tema visual">
      ${Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
    </select>
    <button class="btn small" id="visual-editor" title="${t('Constructor visual de páginas (arrastrar y soltar)', 'Visual page builder (drag & drop)')}">🖱️ ${t('Editor visual', 'Visual editor')}</button>
    <button class="btn secondary small" id="ai-redesign" title="La IA rediseña esta página (podrás editarla después)">Rediseñar</button>
    <button class="btn secondary small" id="page-seo">SEO</button>
    <label class="flex" style="font-size:13px"><input type="checkbox" id="published"> ${t('Publicada', 'Published')}</label>
    <a class="btn secondary" target="_blank" id="preview-link">${t('Abrir ↗', 'Open ↗')}</a>
    <button class="btn" id="save-page">${t('Guardar', 'Save')}</button>
  </div>
  <div class="builder">
    <div>
      <div class="card" style="margin-bottom:14px"><div class="card-title" style="display:flex;align-items:center;gap:8px">✨ Claude design
        <span class="muted" style="font-weight:400;font-size:11px">${t('pídele cambios como a un diseñador', 'ask for changes like you would a designer')}</span></div>
        <div class="card-body" style="padding-top:8px">
          <div id="cd-msgs" class="cd-msgs"><div class="cd-msg ai">${t('Hola 👋 Dime qué quieres cambiar en esta página: «hazla más elegante», «añade una sección de precios», «pon una foto del equipo en el hero», «reescribe el titular para sonar más premium»…', 'Hi 👋 Tell me what to change on this page: "make it more elegant", "add a pricing section", "put a team photo in the hero"…')}</div></div>
          <form id="cd-form" class="flex" style="gap:6px;margin-top:8px">
            <input class="input" id="cd-input" placeholder="${t('Pídele algo a Claude design…', 'Ask Claude design…')}" style="flex:1">
            <button class="btn" id="cd-send">➤</button>
          </form>
        </div>
      </div>
      <div class="card"><div class="card-title">${t('Bloques de la página', 'Page Blocks')}</div><div class="card-body">
        <div id="blocks"></div>
        <div class="flex" style="margin-top:10px">
          <select class="input" id="new-block-type">${Object.entries(BLOCK_TYPES)
            .map(([k, v]) => `<option value="${k}">${v}</option>`)
            .join('')}</select>
          <button class="btn secondary" id="add-block">${t('+ Añadir', '+ Add')}</button>
        </div>
      </div></div>
    </div>
    <iframe class="preview-frame" id="preview"></iframe>
  </div>`;

  let blocks = [];

  function loadPage() {
    if (!page) return;
    sessionStorage.setItem('lf_page', page.id);
    blocks = structuredClone(page.content || []);
    view.querySelector('#published').checked = !!page.published;
    view.querySelector('#theme-select').value = page.theme || 'clean';
    view.querySelector('#page-seo').addEventListener('click', () => {
      const modal = openModal(`<h2>${t('SEO y seguimiento', 'SEO & tracking')}</h2>
        <form id="seo-form">
          <label class="field"><span class="label">${t('Título SEO', 'SEO title')}</span><input class="input" name="seo_title" value="${esc(page.seo_title || '')}" placeholder="${esc(page.name)}"></label>
          <label class="field"><span class="label">${t('Descripción SEO', 'SEO description')}</span><textarea class="input" name="seo_description" rows="2">${esc(page.seo_description || '')}</textarea></label>
          <label class="field"><span class="label">${t('Imagen para compartir (URL)', 'Social share image (URL)')}</span><input class="input" name="seo_image" value="${esc(page.seo_image || '')}" placeholder="https://…/og.png"></label>
          <label class="field"><span class="label">${t('Código en <head> (píxeles, GA…)', 'Code in <head> (pixels, GA…)')}</span><textarea class="input" name="head_code" rows="3" placeholder="&lt;script&gt;…&lt;/script&gt;">${esc(page.head_code || '')}</textarea></label>
          <label class="field"><span class="label">${t('Código antes de </body>', 'Code before </body>')}</span><textarea class="input" name="body_code" rows="2">${esc(page.body_code || '')}</textarea></label>
          <div class="modal-actions"><button type="button" class="btn secondary" id="c">${t('Cancelar', 'Cancel')}</button><button class="btn">${t('Guardar', 'Save')}</button></div>
        </form>`);
      modal.querySelector('#c').addEventListener('click', closeOverlay);
      modal.querySelector('#seo-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target).entries());
        Object.assign(page, d);
        try { await api(`/funnels/${funnel.id}/pages/${page.id}`, { method: 'PUT', body: d }); closeOverlay(); toast(t('SEO guardado', 'SEO saved')); }
        catch (err) { toast(err.message, true); }
      });
    });
    view.querySelector('#preview-link').href = `/f/${funnel.slug}/${page.slug}`;
    renderBlocks();
    refreshPreview();
  }

  function blockFields(b, i) {
    const input = (k, ph, val) =>
      `<input class="input" data-i="${i}" data-k="${k}" placeholder="${ph}" value="${esc(val || '')}" style="margin-bottom:6px">`;
    switch (b.type) {
      case 'hero':
        return input('headline', t('Titular', 'Headline'), b.headline) + input('subheadline', t('Subtítulo', 'Subheadline'), b.subheadline) + input('cta', t('Texto del botón', 'Button text'), b.cta) +
          input('badge', t('Badge (ej. "Oferta limitada")', 'Badge (e.g. "Limited offer")'), b.badge) +
          input('image_keywords', t('Foto de fondo — palabras EN INGLÉS (ej. dental clinic)', 'Background photo — EN keywords'), b.image_keywords) +
          input('image', t('…o URL de imagen propia (opcional)', '…or your own image URL (optional)'), b.image);
      case 'split':
        return input('headline', t('Titular', 'Headline'), b.headline) +
          `<textarea class="input" data-i="${i}" data-k="body" rows="3" placeholder="${t('Texto', 'Body')}">${esc(b.body || '')}</textarea>` +
          input('cta', t('Texto del botón (opcional)', 'Button text (optional)'), b.cta) +
          input('image_keywords', t('Foto — palabras EN INGLÉS (ej. gym training)', 'Photo — EN keywords'), b.image_keywords) +
          input('image', t('…o URL de imagen propia (opcional)', '…or your own image URL (optional)'), b.image) +
          `<label class="muted" style="font-size:12px">${t('Imagen a la', 'Image on the')}
            <select class="input" data-i="${i}" data-k="side" style="width:110px;display:inline-block;padding:4px">
              <option value="left" ${b.side !== 'right' ? 'selected' : ''}>${t('izquierda', 'left')}</option>
              <option value="right" ${b.side === 'right' ? 'selected' : ''}>${t('derecha', 'right')}</option>
            </select></label>`;
      case 'image':
        return input('image_keywords', t('Foto — palabras EN INGLÉS', 'Photo — EN keywords'), b.image_keywords) +
          input('image', t('…o URL de imagen propia (opcional)', '…or your own image URL (optional)'), b.image) +
          input('caption', t('Pie de foto (opcional)', 'Caption (optional)'), b.caption);
      case 'text':
        return input('headline', t('Titular', 'Headline'), b.headline) +
          `<textarea class="input" data-i="${i}" data-k="body" rows="3" placeholder="${t('Texto del cuerpo', 'Body text')}">${esc(b.body || '')}</textarea>`;
      case 'features':
        return input('headline', t('Título de la sección', 'Section headline'), b.headline) +
          `<textarea class="input" data-i="${i}" data-k="items_raw" rows="3" placeholder="${t('Una por línea: Título | Descripción', 'One per line: Title | Description')}">${esc(
            (b.items || []).map((f) => `${f.title} | ${f.body}`).join('\n')
          )}</textarea>`;
      case 'testimonials':
        return input('headline', t('Título de la sección', 'Section headline'), b.headline) +
          `<textarea class="input" data-i="${i}" data-k="t_items_raw" rows="3" placeholder="${t('Una por línea: Nombre | Testimonio', 'One per line: Name | Testimonial')}">${esc(
            (b.items || []).map((tm) => `${tm.name} | ${tm.text}`).join('\n')
          )}</textarea>`;
      case 'pricing':
        return input('headline', t('Título de la sección', 'Section headline'), b.headline) + input('button', t('Texto del botón', 'Button text'), b.button) +
          `<textarea class="input" data-i="${i}" data-k="p_items_raw" rows="3" placeholder="${t('Uno por línea: Plan | Precio | característica; característica; …', 'One per line: Plan | Price | feature; feature; …')}">${esc(
            (b.items || []).map((p) => `${p.name} | ${p.price} | ${(p.features || []).join('; ')}`).join('\n')
          )}</textarea>`;
      case 'faq':
        return input('headline', t('Título de la sección', 'Section headline'), b.headline) +
          `<textarea class="input" data-i="${i}" data-k="f_items_raw" rows="4" placeholder="${t('Una por línea: ¿Pregunta? | Respuesta', 'One per line: Question? | Answer')}">${esc(
            (b.items || []).map((f) => `${f.q} | ${f.a}`).join('\n')
          )}</textarea>`;
      case 'cta':
        return input('headline', t('Titular', 'Headline'), b.headline) + input('body', t('Texto de apoyo', 'Support text'), b.body) + input('button', t('Texto del botón', 'Button text'), b.button);
      case 'form':
        return input('headline', t('Titular del formulario', 'Form headline'), b.headline) + input('button', t('Texto del botón', 'Button text'), b.button) +
          input('tag', t('Etiqueta aplicada a los leads (dispara automatizaciones)', 'Tag applied to leads (fires automations)'), b.tag) +
          input('success_message', t('Mensaje de éxito', 'Success message'), b.success_message) +
          `<label style="font-size:12px" class="muted">${t('Campos:', 'Fields:')}
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
    if (page.mode === 'html') {
      el.innerHTML = `<div class="empty" style="padding:24px;text-align:left">
        <strong>🎨 ${t('Esta página usa Diseño Pro', 'This page uses Pro design')}</strong>
        <p class="muted" style="font-size:12.5px;margin:8px 0 12px">${t('Edítala con el <b>editor visual</b> (arrastrar y soltar) o pídele cambios al chat de Claude design. Los bloques clásicos no aplican en este modo.', 'Edit it with the <b>visual editor</b> (drag & drop) or ask the Claude design chat. Classic blocks do not apply in this mode.')}</p>
        <button class="btn secondary small" id="back-to-blocks">↩ ${t('Volver al modo bloques', 'Back to blocks mode')}</button>
      </div>`;
      el.querySelector('#back-to-blocks').addEventListener('click', async () => {
        if (!confirm(t('¿Volver al modo bloques? El diseño Pro se conserva guardado, pero la página volverá a renderizar los bloques clásicos.', 'Back to blocks mode? The Pro design stays saved, but the page will render the classic blocks again.'))) return;
        const updated = await api(`/funnels/${funnel.id}/pages/${page.id}`, { method: 'PUT', body: { mode: 'blocks', content: blocks, published: view.querySelector('#published').checked, theme: view.querySelector('#theme-select').value } });
        page = updated;
        renderBlocks();
        refreshPreview();
      });
      return;
    }
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
      : `<p class="muted">${t('Página vacía — añade un bloque abajo.', 'Empty page — add a block below.')}</p>`;

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
    // Real live preview for drafts AND published pages: persist the blocks, then
    // render through the actual public renderer via the authenticated preview.
    const iframe = view.querySelector('#preview');
    await savePage(true);
    try {
      const res = await fetch(`/api/funnels/${funnel.id}/pages/${page.id}/preview`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('lf_token')}`,
          'X-Location-Id': localStorage.getItem('lf_location') || '',
          ...(localStorage.getItem('lf_agency') ? { 'X-Agency-Id': localStorage.getItem('lf_agency') } : {}),
        },
      });
      iframe.srcdoc = await res.text();
    } catch {
      iframe.srcdoc = `<body style="font-family:system-ui;padding:40px;color:#334155">${t('No se pudo cargar la vista previa.', 'Preview failed to load.')}</body>`;
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
    if (!silent) toast(t('Página guardada', 'Page saved'));
  }

  view.querySelector('#page-select').addEventListener('change', (e) => {
    page = funnel.pages.find((p) => p.id === Number(e.target.value));
    loadPage();
  });
  view.querySelector('#new-page').addEventListener('click', async () => {
    const name = prompt(t('Nombre de la página:', 'Page name:'));
    if (!name) return;
    const p = await api(`/funnels/${funnel.id}/pages`, { method: 'POST', body: { name } });
    funnel.pages.push(p);
    page = p;
    renderBuilder(view, funnelId);
  });
  view.querySelector('#add-block').addEventListener('click', () => {
    const type = view.querySelector('#new-block-type').value;
    const defaults = {
      hero: { type, headline: 'Tu gran promesa', subheadline: 'Explica el valor en una frase', cta: 'Empezar', badge: '', image_keywords: '' },
      split: { type, headline: 'Cuenta tu historia', body: 'Explica qué haces y por qué importa, junto a una foto que lo demuestre.', side: 'left', image_keywords: 'business team' },
      image: { type, image_keywords: 'office workspace', caption: '' },
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
    toast(t('Tema aplicado', 'Theme applied'));
    refreshPreview();
  });
  view.querySelector('#ai-redesign').addEventListener('click', async () => {
    const desc = prompt(t('Describe la página que quieres (negocio, oferta, estilo). La IA diseñará una landing completa a medida que luego puedes retocar en el editor visual:', 'Describe the page you want. The AI will design a complete bespoke landing you can then tweak in the visual editor:'), funnel.name);
    if (!desc) return;
    const btn = view.querySelector('#ai-redesign');
    btn.disabled = true;
    btn.textContent = t('Diseñando… (20-40s)', 'Designing… (20-40s)');
    try {
      const r = await api('/ai/landing-html', { method: 'POST', body: { prompt: desc, funnel_id: funnel.id, page_id: page.id } });
      toast(r.generated_by === 'claude'
        ? t('Landing diseñada a medida por Claude — retócala en el editor visual', 'Bespoke landing designed by Claude — tweak it in the visual editor')
        : t('Landing generada con plantilla (conecta la IA para diseño a medida)', 'Landing generated from template (connect AI for bespoke design)'));
      renderBuilder(view, funnelId);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = 'Rediseñar';
    }
  });
  // ---- Constructor visual propio (drag & drop, motor GrapesJS embebido) ----
  const STARTER_CSS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Inter,system-ui,sans-serif;color:#0f172a;line-height:1.6}
.lp-hero{min-height:60vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:80px 24px;color:#fff;background:linear-gradient(rgba(10,12,30,.6),rgba(10,12,30,.72)),url('https://loremflickr.com/1600/900/business') center/cover}
.lp-hero h1{font-size:clamp(2rem,5vw,3.2rem);font-weight:800;max-width:800px}
.lp-hero p{font-size:1.15rem;opacity:.92;max-width:620px;margin:16px 0 28px}
.lp-btn{display:inline-block;background:#f59e0b;color:#fff;border:none;padding:15px 38px;border-radius:12px;font-size:1.05rem;font-weight:700;cursor:pointer;text-decoration:none}
.lp-sec{max-width:1000px;margin:0 auto;padding:64px 24px}
.lp-grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:22px}
.lp-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:24px;box-shadow:0 2px 10px rgba(15,23,42,.06)}
.lp-form{max-width:440px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(15,23,42,.14);padding:28px}
.lp-form input{width:100%;padding:13px;border:1px solid #cbd5e1;border-radius:9px;font-size:16px;margin-bottom:12px}`;
  const STARTER_HTML = `<section class="lp-hero"><h1>Tu gran promesa aquí</h1><p>Explica en una frase el valor que ofreces y por qué importa.</p><a class="lp-btn" href="#lead">Quiero empezar</a></section>
<section class="lp-sec"><div class="lp-grid3">
<div class="lp-card"><h3>Beneficio 1</h3><p>Describe un beneficio concreto.</p></div>
<div class="lp-card"><h3>Beneficio 2</h3><p>Describe otro beneficio.</p></div>
<div class="lp-card"><h3>Beneficio 3</h3><p>Y uno más para rematar.</p></div>
</div></section>
<section class="lp-sec" id="lead"><form class="lp-form" data-lead data-success="¡Recibido! Te contactamos muy pronto.">
<h2 style="margin-bottom:14px">Solicita información</h2>
<input name="first_name" placeholder="Tu nombre" required><input name="email" type="email" placeholder="Tu email" required><input name="phone" placeholder="Tu teléfono">
<button class="lp-btn" type="submit" style="width:100%">Enviar</button></form></section>`;

  function loadOnce(kind, url, key) {
    return new Promise((ok, fail) => {
      if (document.getElementById(key)) return ok();
      const el = kind === 'css' ? document.createElement('link') : document.createElement('script');
      if (kind === 'css') { el.rel = 'stylesheet'; el.href = url; } else el.src = url;
      el.id = key;
      el.onload = ok;
      el.onerror = () => fail(new Error(t('No se pudo cargar el editor (revisa tu conexión)', 'Editor failed to load (check your connection)')));
      document.head.appendChild(el);
    });
  }

  async function openVisualEditor() {
    // A blocks page converts to Pro mode the first time (starting from a clean skeleton).
    if (page.mode !== 'html' || !(page.html_raw || '').trim()) {
      if (!confirm(t('Esta página pasará al modo Diseño Pro (constructor visual). Empezarás desde una plantilla base editable — o cancela y usa "Rediseñar" para que la IA genere el diseño primero. ¿Continuar?', 'This page will switch to Pro design mode (visual builder), starting from an editable base template. Continue?'))) return;
      page.mode = 'html';
      page.html_raw = STARTER_HTML;
      page.css_raw = STARTER_CSS;
    }
    const btn = view.querySelector('#visual-editor');
    btn.disabled = true; btn.textContent = t('Cargando…', 'Loading…');
    try {
      await loadOnce('css', 'https://unpkg.com/grapesjs@0.21.13/dist/css/grapes.min.css', 'gjs-css');
      await loadOnce('js', 'https://unpkg.com/grapesjs@0.21.13/dist/grapes.min.js', 'gjs-js');
      await loadOnce('js', 'https://unpkg.com/grapesjs-preset-webpage@1.0.3/dist/index.js', 'gjs-preset');
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = '🖱️ ' + t('Editor visual', 'Visual editor'); return; }
    btn.disabled = false; btn.textContent = '🖱️ ' + t('Editor visual', 'Visual editor');

    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="ve-shell">
      <div class="ve-head">
        <strong>🖱️ ${t('Constructor visual', 'Visual builder')} — ${esc(page.name)}</strong>
        <span class="muted" style="font-size:11px;flex:1">${t('arrastra bloques desde la derecha · edita cualquier texto haciendo doble clic', 'drag blocks from the right · double-click any text to edit')}</span>
        <button class="btn secondary" id="ve-cancel">${t('Cancelar', 'Cancel')}</button>
        <button class="btn" id="ve-save">${t('Guardar diseño', 'Save design')}</button>
      </div>
      <div id="gjs"></div>
    </div>`;

    const editor = window.grapesjs.init({
      container: '#gjs',
      height: '100%',
      fromElement: false,
      components: page.html_raw,
      style: page.css_raw,
      storageManager: false,
      plugins: ['grapesjs-preset-webpage'],
      pluginsOpts: { 'grapesjs-preset-webpage': { modalImportButton: false } },
      canvas: { styles: [], scripts: [] },
    });

    // Bloques propios de Upcro, arriba del todo.
    const bm = editor.BlockManager;
    const upcro = (id, label, content) => bm.add(id, { label, category: 'Upcro', content, attributes: { class: 'gjs-block-section' } });
    upcro('u-hero', '🎬 Hero', `<section class="lp-hero"><h1>Titular potente</h1><p>Subtítulo que vende el beneficio.</p><a class="lp-btn" href="#lead">Llamada a la acción</a></section>`);
    upcro('u-benefits', '✨ Beneficios (3)', `<section class="lp-sec"><div class="lp-grid3"><div class="lp-card"><h3>Beneficio</h3><p>Descripción corta.</p></div><div class="lp-card"><h3>Beneficio</h3><p>Descripción corta.</p></div><div class="lp-card"><h3>Beneficio</h3><p>Descripción corta.</p></div></div></section>`);
    upcro('u-cta', '📣 CTA', `<section class="lp-sec" style="text-align:center"><h2>¿Listo para empezar?</h2><p style="margin:10px 0 22px">Da el primer paso hoy mismo.</p><a class="lp-btn" href="#lead">Quiero empezar</a></section>`);
    upcro('u-form', '📩 Formulario de captura', `<section class="lp-sec" id="lead"><form class="lp-form" data-lead data-success="¡Recibido! Te contactamos muy pronto."><h2 style="margin-bottom:14px">Solicita información</h2><input name="first_name" placeholder="Tu nombre" required><input name="email" type="email" placeholder="Tu email" required><input name="phone" placeholder="Tu teléfono"><button class="lp-btn" type="submit" style="width:100%">Enviar</button></form></section>`);
    upcro('u-testimonial', '⭐ Testimonio', `<section class="lp-sec"><div class="lp-card" style="max-width:640px;margin:0 auto;text-align:center"><p style="font-style:italic">“Resultados increíbles, lo recomiendo al 100%.”</p><strong style="display:block;margin-top:10px">María G.</strong></div></section>`);

    root.querySelector('#ve-cancel').addEventListener('click', () => { editor.destroy(); root.innerHTML = ''; });
    root.querySelector('#ve-save').addEventListener('click', async () => {
      const html = editor.getHtml().replace(/^<body[^>]*>|<\/body>$/g, '').trim();
      const css = editor.getCss();
      try {
        const updated = await api(`/funnels/${funnel.id}/pages/${page.id}`, {
          method: 'PUT',
          body: { mode: 'html', html_raw: html, css_raw: css, content: blocks, published: view.querySelector('#published').checked, theme: view.querySelector('#theme-select').value },
        });
        page = updated;
        const idx = funnel.pages.findIndex((p) => p.id === page.id);
        funnel.pages[idx] = updated;
        editor.destroy(); root.innerHTML = '';
        toast(t('Diseño guardado', 'Design saved'));
        renderBlocks();
        refreshPreview();
      } catch (err) { toast(err.message, true); }
    });
  }
  view.querySelector('#visual-editor').addEventListener('click', openVisualEditor);

  // ---- Claude design chat: iterative prompting, like talking to a designer ----
  const cdHistory = [];
  const cdMsgs = view.querySelector('#cd-msgs');
  function cdAdd(role, text) {
    const div = document.createElement('div');
    div.className = `cd-msg ${role}`;
    div.textContent = text;
    cdMsgs.appendChild(div);
    cdMsgs.scrollTop = cdMsgs.scrollHeight;
  }
  view.querySelector('#cd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = view.querySelector('#cd-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    cdAdd('user', text);
    cdHistory.push({ role: 'user', text });
    const thinking = document.createElement('div');
    thinking.className = 'cd-msg ai cd-thinking';
    thinking.textContent = t('Diseñando…', 'Designing…');
    cdMsgs.appendChild(thinking);
    cdMsgs.scrollTop = cdMsgs.scrollHeight;
    const btn = view.querySelector('#cd-send');
    btn.disabled = true;
    try {
      const r = await api('/ai/design', {
        method: 'POST',
        body: { funnel_id: funnel.id, page_id: page.id, prompt: text, history: cdHistory.slice(0, -1) },
      });
      thinking.remove();
      cdAdd('ai', r.reply);
      cdHistory.push({ role: 'ai', text: r.reply });
      if (r.changed) {
        if (r.mode === 'html') {
          // Pro page: the server already saved the new HTML/CSS — just re-render.
          page.mode = 'html';
          refreshPreview();
        } else {
          blocks = r.blocks;
          page.content = r.blocks;
          page.theme = r.theme;
          view.querySelector('#theme-select').value = r.theme;
          renderBlocks();
          refreshPreview();
        }
      }
    } catch (err) {
      thinking.remove();
      cdAdd('ai', `⚠️ ${err.message}`);
    } finally {
      btn.disabled = false;
      input.focus();
    }
  });

  view.querySelector('#view-subs').addEventListener('click', async () => {
    const subs = await api(`/funnels/${funnel.id}/submissions`);
    openModal(`
      <h2>${t('Envíos del formulario', 'Form Submissions')} (${subs.length})</h2>
      ${
        subs.length
          ? subs
              .map(
                (s) => `<div class="block-item">
                  <div class="b-head"><span>${esc(fullName(s))}</span><span class="muted">${fmtDate(s.created_at)}</span></div>
                  <div style="font-size:12px">${Object.entries(s.data)
                    .map(([k, v]) => `<div><strong>${esc(k)}:</strong> ${esc(v)}</div>`)
                    .join('')}</div>
                  ${s.contact_id ? `<a href="#/contacts/${s.contact_id}" onclick="document.getElementById('modal-root').innerHTML=''">${t('Ver contacto →', 'View contact →')}</a>` : ''}
                </div>`
              )
              .join('')
          : `<div class="empty">${t('Aún no hay envíos', 'No submissions yet')}</div>`
      }`);
  });

  loadPage();
}
