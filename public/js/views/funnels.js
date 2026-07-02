import { api } from '../api.js';
import { esc, openModal, closeOverlay, toast, fmtDate, fullName } from '../ui.js';

const BLOCK_TYPES = { hero: '🎬 Hero', text: '📄 Text', features: '✨ Features', form: '📩 Lead Form' };

export async function renderFunnels(view, rest = []) {
  if (rest[0]) return renderBuilder(view, Number(rest[0]));
  const funnels = await api('/funnels');

  view.innerHTML = `
  <div class="page-header">
    <h1>Sites & Funnels</h1>
    <div class="spacer"></div>
    <button class="btn" id="new-funnel">+ Funnel</button>
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
                    ${p.published ? '🟢' : '⚪'} ${esc(p.name)} —
                    <a href="/f/${esc(f.slug)}/${esc(p.slug)}" target="_blank"><code class="inline">/f/${esc(f.slug)}/${esc(p.slug)}</code> ↗</a></div>`
                )
                .join('')}
            </div></div>`
          )
          .join('')}</div>`
      : '<div class="empty card" style="padding:60px"><div class="big">🌐</div>No funnels yet. Build landing pages that capture leads straight into your CRM.</div>'
  }`;

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
      body: { content: blocks, published: view.querySelector('#published').checked },
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
      hero: { type, headline: 'Your big promise', subheadline: 'Explain the value in one sentence', cta: 'Get Started' },
      text: { type, headline: 'Section title', body: 'Write something persuasive here.' },
      features: { type, headline: 'Why choose us', items: [{ title: 'Fast', body: 'We deliver quickly.' }] },
      form: { type, headline: 'Get your free quote', button: 'Submit', fields: ['first_name', 'email', 'phone'], success_message: 'Thanks! We will reach out soon.', tag: '' },
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
