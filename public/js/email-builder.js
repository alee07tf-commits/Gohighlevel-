// Visual (drag-and-drop) email builder. Blocks are edited in place, reordered
// by dragging, and compiled to email-safe inline-styled HTML on save. The block
// list is stored as `design` (JSON) so the email stays re-editable; the compiled
// HTML is stored as `body` and is what actually gets sent.
import { esc, closeOverlay, toast } from './ui.js';
import { t } from './i18n.js';

const PALETTE = [
  ['heading', () => t('Título', 'Heading')],
  ['text', () => t('Texto', 'Text')],
  ['button', () => t('Botón', 'Button')],
  ['image', () => t('Imagen', 'Image')],
  ['divider', () => t('Separador', 'Divider')],
  ['spacer', () => t('Espacio', 'Spacer')],
];

function defaults(type) {
  switch (type) {
    case 'heading': return { type, text: t('Tu titular aquí', 'Your headline here'), align: 'center', size: 26 };
    case 'text': return { type, text: t('Escribe tu mensaje. Puedes usar {{first_name}} para personalizar.', 'Write your message. You can use {{first_name}} to personalize.'), align: 'left' };
    case 'button': return { type, text: t('Ver más', 'Learn more'), url: 'https://', align: 'center' };
    case 'image': return { type, src: '', alt: '', align: 'center', width: 100 };
    case 'divider': return { type };
    case 'spacer': return { type, height: 24 };
    default: return { type: 'text', text: '' };
  }
}

// ---- Compile blocks → email-safe HTML (inline styles, 600px container) ----
export function renderEmailHtml(blocks, brand = '#4f46e5') {
  const inner = (blocks || []).map((b) => {
    const align = b.align || 'left';
    switch (b.type) {
      case 'heading':
        return `<h1 style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:${Number(b.size) || 26}px;font-weight:700;color:#111827;text-align:${align}">${esc(b.text || '')}</h1>`;
      case 'text':
        return `<p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#374151;text-align:${align}">${esc(b.text || '').replace(/\n/g, '<br>')}</p>`;
      case 'button':
        return `<div style="text-align:${align};margin:8px 0 18px"><a href="${esc(b.url || '#')}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-family:Arial,sans-serif;font-size:15px;font-weight:600">${esc(b.text || 'Button')}</a></div>`;
      case 'image':
        return b.src ? `<div style="text-align:${align};margin:8px 0"><img src="${esc(b.src)}" alt="${esc(b.alt || '')}" style="max-width:${Number(b.width) || 100}%;border-radius:6px"></div>` : '';
      case 'divider':
        return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">`;
      case 'spacer':
        return `<div style="height:${Number(b.height) || 24}px"></div>`;
      default: return '';
    }
  }).join('\n');
  return `<div style="background:#f3f4f6;padding:24px 0"><div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">${inner}</div></div>`;
}

// Opens the builder as a full overlay. onSave receives { name, subject, body, design }.
export function openEmailBuilder(template, onSave, brand = '#4f46e5') {
  let blocks = [];
  try { blocks = template && template.design ? JSON.parse(template.design) : []; } catch { blocks = []; }
  if (!blocks.length && template && template.body && !template.design) blocks = [defaults('text')];
  if (!blocks.length) blocks = [defaults('heading'), defaults('text'), defaults('button')];
  let selected = 0;

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="overlay">
      <div class="eb-shell">
        <div class="eb-head">
          <input class="input" id="eb-name" placeholder="${t('Nombre de la plantilla', 'Template name')}" value="${esc(template?.name || '')}" style="max-width:220px">
          <input class="input" id="eb-subject" placeholder="${t('Asunto del email', 'Email subject')}" value="${esc(template?.subject || '')}" style="flex:1">
          <button class="btn secondary" id="eb-cancel">${t('Cancelar', 'Cancel')}</button>
          <button class="btn" id="eb-save">${t('Guardar', 'Save')}</button>
        </div>
        <div class="eb-body">
          <div class="eb-palette">
            <div class="eb-palette-title">${t('Bloques', 'Blocks')}</div>
            ${PALETTE.map(([type, label]) => `<button class="eb-add" data-type="${type}">+ ${label()}</button>`).join('')}
            <div class="eb-palette-title" style="margin-top:14px">${t('Ajustes del bloque', 'Block settings')}</div>
            <div id="eb-inspector"></div>
          </div>
          <div class="eb-canvas-wrap"><div class="eb-canvas" id="eb-canvas"></div></div>
        </div>
      </div>
    </div>`;

  const canvas = root.querySelector('#eb-canvas');
  const inspector = root.querySelector('#eb-inspector');

  function drawCanvas() {
    canvas.innerHTML = blocks.map((b, i) => `
      <div class="eb-block ${i === selected ? 'sel' : ''}" draggable="true" data-i="${i}">
        <div class="eb-block-preview">${renderEmailHtml([b], brand)}</div>
        <div class="eb-block-tools">
          <button class="eb-up" data-i="${i}" title="↑">↑</button>
          <button class="eb-down" data-i="${i}" title="↓">↓</button>
          <button class="eb-del" data-i="${i}" title="✕">✕</button>
        </div>
      </div>`).join('') || `<div class="empty" style="padding:40px">${t('Añade bloques desde la izquierda', 'Add blocks from the left')}</div>`;
    canvas.querySelectorAll('.eb-block').forEach((el) => {
      el.addEventListener('click', () => { selected = +el.dataset.i; drawCanvas(); drawInspector(); });
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', el.dataset.i); el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = +e.dataTransfer.getData('text/plain'); const to = +el.dataset.i;
        if (from === to || Number.isNaN(from)) return;
        const [m] = blocks.splice(from, 1); blocks.splice(to, 0, m);
        selected = to; drawCanvas(); drawInspector();
      });
    });
    canvas.querySelectorAll('.eb-up').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const i = +b.dataset.i; if (i > 0) { [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]]; selected = i - 1; drawCanvas(); drawInspector(); } }));
    canvas.querySelectorAll('.eb-down').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const i = +b.dataset.i; if (i < blocks.length - 1) { [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]]; selected = i + 1; drawCanvas(); drawInspector(); } }));
    canvas.querySelectorAll('.eb-del').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); blocks.splice(+b.dataset.i, 1); selected = Math.max(0, selected - 1); drawCanvas(); drawInspector(); }));
  }

  const field = (label, html) => `<label class="field" style="margin-top:8px"><span class="label">${label}</span>${html}</label>`;
  const alignPicker = (v) => `<select class="eb-f input" data-k="align">${['left', 'center', 'right'].map((a) => `<option value="${a}" ${v === a ? 'selected' : ''}>${a}</option>`).join('')}</select>`;

  function drawInspector() {
    const b = blocks[selected];
    if (!b) { inspector.innerHTML = `<p class="muted" style="font-size:12px">${t('Selecciona un bloque', 'Select a block')}</p>`; return; }
    let html = '';
    if (b.type === 'heading') html = field(t('Texto', 'Text'), `<input class="eb-f input" data-k="text" value="${esc(b.text || '')}">`) + field(t('Tamaño', 'Size'), `<input class="eb-f input" data-k="size" type="number" value="${b.size || 26}">`) + field(t('Alineación', 'Align'), alignPicker(b.align));
    else if (b.type === 'text') html = field(t('Texto', 'Text'), `<textarea class="eb-f input" data-k="text" rows="4">${esc(b.text || '')}</textarea>`) + field(t('Alineación', 'Align'), alignPicker(b.align));
    else if (b.type === 'button') html = field(t('Texto', 'Text'), `<input class="eb-f input" data-k="text" value="${esc(b.text || '')}">`) + field('URL', `<input class="eb-f input" data-k="url" value="${esc(b.url || '')}">`) + field(t('Alineación', 'Align'), alignPicker(b.align));
    else if (b.type === 'image') html = field(t('URL de la imagen', 'Image URL'), `<input class="eb-f input" data-k="src" value="${esc(b.src || '')}" placeholder="https://…">`) + field(t('Ancho (%)', 'Width (%)'), `<input class="eb-f input" data-k="width" type="number" value="${b.width || 100}">`) + field(t('Alineación', 'Align'), alignPicker(b.align));
    else if (b.type === 'spacer') html = field(t('Altura (px)', 'Height (px)'), `<input class="eb-f input" data-k="height" type="number" value="${b.height || 24}">`);
    else html = `<p class="muted" style="font-size:12px">${t('Sin ajustes', 'No settings')}</p>`;
    inspector.innerHTML = html;
    inspector.querySelectorAll('.eb-f').forEach((el) => {
      const ev = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        const k = el.dataset.k;
        b[k] = (k === 'size' || k === 'width' || k === 'height') ? Number(el.value) : el.value;
        drawCanvas();
      });
    });
  }

  root.querySelectorAll('.eb-add').forEach((b) => b.addEventListener('click', () => {
    blocks.push(defaults(b.dataset.type)); selected = blocks.length - 1; drawCanvas(); drawInspector();
    canvas.scrollTop = canvas.scrollHeight;
  }));
  root.querySelector('#eb-cancel').addEventListener('click', closeOverlay);
  root.querySelector('#eb-save').addEventListener('click', async () => {
    const name = root.querySelector('#eb-name').value.trim();
    if (!name) return toast(t('Ponle un nombre a la plantilla', 'Name the template'), true);
    const payload = {
      name,
      subject: root.querySelector('#eb-subject').value.trim(),
      design: JSON.stringify(blocks),
      body: renderEmailHtml(blocks, brand),
    };
    try { await onSave(payload); closeOverlay(); toast(t('Plantilla guardada', 'Template saved')); }
    catch (err) { toast(err.message, true); }
  });

  drawCanvas(); drawInspector();
}
