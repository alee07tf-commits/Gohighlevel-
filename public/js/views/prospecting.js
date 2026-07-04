import { api } from '../api.js';
import { esc, toast } from '../ui.js';

export async function renderProspecting(view) {
  const status = await api('/prospecting/status');
  let allResults = [];
  let results = [];

  function currentFilters() {
    return {
      ads: view.querySelector('#f-ads')?.value || 'any',
      active_ads: view.querySelector('#f-active')?.value || 'any',
      website: view.querySelector('#f-web')?.value || 'any',
      min_reviews: view.querySelector('#f-rmin')?.value || null,
      max_reviews: view.querySelector('#f-rmax')?.value || null,
      min_rating: view.querySelector('#f-rating')?.value || null,
    };
  }

  function filterLocal() {
    const f = currentFilters();
    results = allResults.filter((r) => {
      if (f.min_reviews && (r.reviews || 0) < Number(f.min_reviews)) return false;
      if (f.max_reviews && (r.reviews || 0) > Number(f.max_reviews)) return false;
      if (f.min_rating && (r.rating || 0) < Number(f.min_rating)) return false;
      if (f.website === 'with' && !r.website) return false;
      if (f.website === 'without' && r.website) return false;
      if (f.ads === 'with' && r.runs_ads !== true) return false;
      if (f.ads === 'without' && r.runs_ads !== false) return false;
      if (f.active_ads === 'with' && r.active_ads !== true) return false;
      if (f.active_ads === 'without' && r.active_ads !== false) return false;
      return true;
    });
    renderResults();
  }

  function render() {
    view.innerHTML = `
    <div class="page-greeting">Encuentra negocios en Google y conviértelos en contactos y oportunidades con un clic.</div>
    <div class="page-header">
      <h1>Prospección</h1>
      ${status.provider === 'simulated'
        ? '<span class="badge amber">demo — conecta GOOGLE_PLACES_API_KEY para datos reales</span>'
        : `<span class="badge green">${esc(status.provider)}</span>`}
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-body">
      <div class="flex">
        <input class="input" id="pq" placeholder='Sector + zona. Ej: "dentistas en Valencia", "gimnasios en Bogotá"' style="flex:1"
          onkeydown="if(event.key==='Enter')document.getElementById('psearch').click()">
        <button class="btn" id="psearch">Buscar y analizar</button>
      </div>
      <label class="flex" style="margin-top:10px;font-size:12.5px"><input type="checkbox" id="live-ads">
        <strong>Comprobar anuncios activos en tiempo real</strong> (consulta Meta Ad Library + Google Ads Transparency — más lento)</label>
      <div class="flex" style="margin-top:10px;flex-wrap:wrap">
        <label class="field mb0" style="width:170px"><span class="label">Píxel de anuncios</span>
          <select class="input" id="f-ads"><option value="any">Todos</option>
          <option value="with">Con píxel</option><option value="without">Sin píxel</option></select></label>
        <label class="field mb0" style="width:190px"><span class="label">Anuncios activos AHORA</span>
          <select class="input" id="f-active"><option value="any">Todos</option>
          <option value="with">Corriendo anuncios</option><option value="without">Sin anuncios activos</option></select></label>
        <label class="field mb0" style="width:150px"><span class="label">Sitio web</span>
          <select class="input" id="f-web"><option value="any">Todos</option>
          <option value="with">Con web</option><option value="without">Sin web</option></select></label>
        <label class="field mb0" style="width:120px"><span class="label">Reseñas mín.</span>
          <input class="input" id="f-rmin" type="number" min="0" placeholder="0"></label>
        <label class="field mb0" style="width:120px"><span class="label">Reseñas máx.</span>
          <input class="input" id="f-rmax" type="number" min="0" placeholder="∞"></label>
        <label class="field mb0" style="width:120px"><span class="label">Rating mín.</span>
          <input class="input" id="f-rating" type="number" min="1" max="5" step="0.1" placeholder="—"></label>
      </div>
      ${status.provider === 'simulated'
        ? '<p class="muted" style="font-size:12px;margin-top:8px">Sin clave configurada verás resultados de ejemplo para probar el flujo. Con <code class="inline">GOOGLE_PLACES_API_KEY</code> (API oficial de Google, con capa gratuita) o <code class="inline">SERPER_API_KEY</code> buscarás negocios reales de Google Maps.</p>'
        : ''}
    </div></div>
    <div id="presults"></div>`;

    view.querySelector('#psearch').addEventListener('click', doSearch);
    ['f-ads', 'f-active', 'f-web', 'f-rmin', 'f-rmax', 'f-rating'].forEach((id) =>
      view.querySelector('#' + id).addEventListener('change', filterLocal)
    );
    renderResults();
  }

  function renderResults() {
    const el = view.querySelector('#presults');
    if (!results.length) {
      el.innerHTML = '<div class="empty card" style="padding:50px"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>Busca un tipo de negocio y una zona para empezar.</div>';
      return;
    }
    el.innerHTML = `
    <div class="card">
      <div class="card-title" style="display:flex;align-items:center;gap:10px;padding-bottom:8px">
        <span>${results.length} de ${allResults.length} resultados</span>
        <label class="flex" style="font-weight:400;font-size:12px"><input type="checkbox" id="sel-all" checked> todos</label>
        <span class="right"></span>
        <input class="input" id="ptag" value="prospecto" style="width:130px" title="Tag para los importados">
        <label class="flex" style="font-weight:400;font-size:12px"><input type="checkbox" id="popp" checked> crear oportunidades</label>
        <button class="btn" id="pimport">Importar seleccionados</button>
      </div>
      <table class="table"><thead><tr><th></th><th>Negocio</th><th>Teléfono</th><th>Web</th><th>Píxel</th><th>Activos ahora</th><th>Google</th></tr></thead>
      <tbody>
        ${results
          .map(
            (r, i) => `<tr>
              <td><input type="checkbox" class="psel" data-i="${i}" ${r.already_contact ? '' : 'checked'} ${r.already_contact ? 'disabled' : ''}></td>
              <td><strong>${esc(r.name)}</strong>${r.demo ? ' <span class="badge gray">demo</span>' : ''}
                ${r.already_contact ? ' <span class="badge indigo">ya es contacto</span>' : ''}</td>
              <td>${esc(r.phone) || '<span class="muted">—</span>'}<div class="muted" style="font-size:11px">${esc(r.address)}</div></td>
              <td>${r.website ? `<a href="${esc(r.website)}" target="_blank">web ↗</a>` : '<span class="badge amber">sin web</span>'}</td>
              <td>${
                r.runs_ads === true
                  ? `<span class="badge green">sí</span> <span class="muted" style="font-size:10px">${[r.tech?.google_ads ? 'Google' : '', r.tech?.meta_pixel ? 'Meta' : '', r.tech?.tiktok_pixel ? 'TikTok' : ''].filter(Boolean).join('+')}</span>`
                  : r.runs_ads === false
                    ? '<span class="badge red">no</span>'
                    : '<span class="badge gray">?</span>'
              }</td>
              <td>${
                r.active_ads === true
                  ? `<span class="badge green">EN VIVO</span>${r.meta_active_ads ? ` <span class="muted" style="font-size:10px">${r.meta_active_ads} en Meta</span>` : ''}`
                  : r.active_ads === false
                    ? '<span class="badge gray">no</span>'
                    : '<span class="muted" style="font-size:11px">— activa la comprobación</span>'
              }</td>
              <td>${r.rating ? `★ ${r.rating} <span class="muted">(${r.reviews})</span>` : '<span class="muted">—</span>'}
                ${r.maps_url ? ` <a href="${esc(r.maps_url)}" target="_blank">maps ↗</a>` : ''}</td>
            </tr>`
          )
          .join('')}
      </tbody></table>
    </div>`;

    el.querySelector('#sel-all').addEventListener('change', (e) => {
      el.querySelectorAll('.psel:not(:disabled)').forEach((cb) => (cb.checked = e.target.checked));
    });
    el.querySelector('#pimport').addEventListener('click', async () => {
      const selected = [...el.querySelectorAll('.psel:checked')].map((cb) => results[Number(cb.dataset.i)]);
      if (!selected.length) return toast('Selecciona al menos un negocio', true);
      const btn = el.querySelector('#pimport');
      btn.disabled = true;
      btn.textContent = 'Importando…';
      try {
        const r = await api('/prospecting/import', {
          method: 'POST',
          body: {
            prospects: selected,
            tag: el.querySelector('#ptag').value.trim() || 'prospecto',
            create_opportunities: el.querySelector('#popp').checked,
          },
        });
        toast(`Importados: ${r.imported} · Omitidos (ya existían): ${r.skipped}`);
        location.hash = '#/contacts';
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = 'Importar seleccionados';
      }
    });
  }

  async function doSearch() {
    const q = view.querySelector('#pq').value.trim();
    if (q.length < 3) return toast('Escribe qué buscar (ej: "dentistas en Madrid")', true);
    const btn = view.querySelector('#psearch');
    btn.disabled = true;
    btn.textContent = view.querySelector('#live-ads').checked ? 'Buscando + comprobando anuncios activos…' : 'Buscando y analizando webs…';
    try {
      const out = await api('/prospecting/search', { method: 'POST', body: { query: q, filters: {}, live_ads: view.querySelector('#live-ads').checked } });
      allResults = out.results;
      filterLocal();
    } catch (err) {
      toast(err.message, true);
    }
    btn.disabled = false;
    btn.textContent = 'Buscar y analizar';
  }

  render();
}
