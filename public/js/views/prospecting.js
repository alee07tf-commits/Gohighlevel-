import { api } from '../api.js';
import { esc, toast } from '../ui.js';
import { t } from '../i18n.js';

export async function renderProspecting(view) {
  const status = await api('/prospecting/status');
  let allResults = [];
  let results = [];

  function currentFilters() {
    return {
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
      if (f.active_ads === 'with' && r.active_ads !== true) return false;
      if (f.active_ads === 'without' && r.active_ads !== false) return false;
      return true;
    });
    renderResults();
  }

  function render() {
    view.innerHTML = `
    <div class="page-greeting">${t('Encuentra negocios que están haciendo anuncios AHORA mismo y conviértelos en clientes.', 'Find businesses that are running ads RIGHT NOW and turn them into clients.')}</div>
    <div class="page-header">
      <h1>${t('Prospección', 'Prospecting')}</h1>
      <span class="badge ${status.provider === 'simulated' ? 'amber' : 'green'}">${status.provider === 'simulated' ? t('demo — sin GOOGLE_PLACES_API_KEY', 'demo — no GOOGLE_PLACES_API_KEY') : esc(status.provider)}</span>
      <span class="badge ${status.ads_provider === 'simulated' ? 'amber' : 'green'}">${t('anuncios', 'ads')}: ${esc(status.ads_provider || t('simulado', 'simulated'))}</span>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-body">
      <div class="flex">
        <input class="input" id="pq" placeholder='${t('Sector + zona. Ej: "clínicas dentales en Madrid", "gimnasios en Bogotá"', 'Sector + area. E.g.: "dental clinics in Madrid", "gyms in Bogotá"')}' style="flex:1"
          onkeydown="if(event.key==='Enter')document.getElementById('psearch').click()">
        <button class="btn" id="psearch">${t('Buscar negocios con anuncios activos', 'Search businesses with active ads')}</button>
      </div>
      <p class="muted" style="font-size:12px;margin-top:8px">${t('Cada búsqueda comprueba en tiempo real, de forma automática, qué negocios tienen anuncios activos ahora mismo en <strong>Meta (Facebook/Instagram)</strong>, usando la API oficial de la Biblioteca de Anuncios. Puedes verificar cada resultado con un clic. Google Maps se usa solo para descubrir negocios.', 'Each search checks in real time, automatically, which businesses have active ads right now on <strong>Meta (Facebook/Instagram)</strong>, using the official Ad Library API. You can verify each result with one click. Google Maps is used only to discover businesses.')}</p>
      <div class="flex" style="margin-top:10px;flex-wrap:wrap">
        <label class="field mb0" style="width:200px"><span class="label">${t('Anuncios activos ahora (Meta)', 'Active ads now (Meta)')}</span>
          <select class="input" id="f-active"><option value="any">${t('Todos', 'All')}</option>
          <option value="with">${t('Con anuncios activos', 'With active ads')}</option><option value="without">${t('Sin anuncios', 'Without ads')}</option></select></label>
        <label class="field mb0" style="width:130px"><span class="label">${t('Sitio web', 'Website')}</span>
          <select class="input" id="f-web"><option value="any">${t('Todos', 'All')}</option>
          <option value="with">${t('Con web', 'With website')}</option><option value="without">${t('Sin web', 'Without website')}</option></select></label>
        <label class="field mb0" style="width:110px"><span class="label">${t('Reseñas mín.', 'Min. reviews')}</span>
          <input class="input" id="f-rmin" type="number" min="0" placeholder="0"></label>
        <label class="field mb0" style="width:110px"><span class="label">${t('Reseñas máx.', 'Max. reviews')}</span>
          <input class="input" id="f-rmax" type="number" min="0" placeholder="∞"></label>
        <label class="field mb0" style="width:110px"><span class="label">${t('Rating mín.', 'Min. rating')}</span>
          <input class="input" id="f-rating" type="number" min="1" max="5" step="0.1" placeholder="—"></label>
      </div>
    </div></div>
    <div id="presults"></div>`;

    view.querySelector('#psearch').addEventListener('click', doSearch);
    ['f-active', 'f-web', 'f-rmin', 'f-rmax', 'f-rating'].forEach((id) =>
      view.querySelector('#' + id).addEventListener('change', filterLocal)
    );
    renderResults();
  }

  function metaVerifyUrl(name) {
    return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ES&q=${encodeURIComponent(name)}&media_type=all`;
  }

  function liveCell(r) {
    const l = r.live || {};
    if (l.meta === true) return `<span class="badge green">${t('Sí', 'Yes')} · ${l.meta_count || 0} ${l.meta_count === 1 ? t('anuncio', 'ad') : t('anuncios', 'ads')}</span> <a href="${metaVerifyUrl(r.name)}" target="_blank" style="font-size:10px">${t('verificar ↗', 'verify ↗')}</a>`;
    if (l.meta === false) return `<span class="badge gray">${t('No', 'No')}</span>`;
    return `<span class="badge gray" title="${t('Añade META_AD_LIBRARY_TOKEN para comprobarlo', 'Add META_AD_LIBRARY_TOKEN to check it')}">?</span>`;
  }

  function renderResults() {
    const el = view.querySelector('#presults');
    if (!allResults.length) {
      el.innerHTML = `<div class="empty card" style="padding:50px"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>${t('Busca un sector y una zona para empezar.', 'Search a sector and an area to start.')}</div>`;
      return;
    }
    const withAds = allResults.filter((r) => r.active_ads === true).length;
    el.innerHTML = `
    <div class="card">
      <div class="card-title" style="display:flex;align-items:center;gap:10px;padding-bottom:8px;flex-wrap:wrap">
        <span>${results.length} ${t('de', 'of')} ${allResults.length} · <strong style="color:var(--success)">${withAds} ${t('con anuncios activos', 'with active ads')}</strong></span>
        <label class="flex" style="font-weight:400;font-size:12px"><input type="checkbox" id="sel-all" checked> ${t('todos', 'all')}</label>
        <span class="right"></span>
        <input class="input" id="ptag" value="prospecto" style="width:120px" title="${t('Tag para los importados', 'Tag for imported')}">
        <label class="flex" style="font-weight:400;font-size:12px"><input type="checkbox" id="popp" checked> ${t('oportunidades', 'opportunities')}</label>
        <button class="btn" id="pimport">${t('Importar seleccionados', 'Import selected')}</button>
      </div>
      <table class="table"><thead><tr><th></th><th>${t('Negocio', 'Business')}</th><th>${t('Teléfono', 'Phone')}</th><th>${t('Web', 'Website')}</th><th>${t('Anuncios activos AHORA (Meta)', 'Active ads NOW (Meta)')}</th><th>${t('Reseñas / Maps', 'Reviews / Maps')}</th></tr></thead>
      <tbody>
        ${results
          .map(
            (r, i) => `<tr>
              <td><input type="checkbox" class="psel" data-i="${i}" ${r.already_contact ? '' : 'checked'} ${r.already_contact ? 'disabled' : ''}></td>
              <td><strong>${esc(r.name)}</strong>${r.demo ? ' <span class="badge gray">demo</span>' : ''}${r.already_contact ? ` <span class="badge indigo">${t('ya es contacto', 'already a contact')}</span>` : ''}</td>
              <td>${esc(r.phone) || '<span class="muted">—</span>'}<div class="muted" style="font-size:11px">${esc(r.address)}</div></td>
              <td>${r.website ? `<a href="${esc(r.website)}" target="_blank">${t('web ↗', 'website ↗')}</a>` : `<span class="badge amber">${t('sin web', 'no website')}</span>`}</td>
              <td>${liveCell(r)}</td>
              <td>${r.rating ? `★ ${r.rating} <span class="muted">(${r.reviews})</span>` : '<span class="muted">—</span>'}${r.maps_url ? ` <a href="${esc(r.maps_url)}" target="_blank">${t('maps ↗', 'maps ↗')}</a>` : ''}</td>
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
      if (!selected.length) return toast(t('Selecciona al menos un negocio', 'Select at least one business'), true);
      const btn = el.querySelector('#pimport');
      btn.disabled = true;
      btn.textContent = t('Importando…', 'Importing…');
      try {
        const r = await api('/prospecting/import', {
          method: 'POST',
          body: { prospects: selected, tag: el.querySelector('#ptag').value.trim() || 'prospecto', create_opportunities: el.querySelector('#popp').checked },
        });
        toast(`${t('Importados', 'Imported')}: ${r.imported} · ${t('Omitidos', 'Skipped')}: ${r.skipped}`);
        location.hash = '#/contacts';
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = t('Importar seleccionados', 'Import selected');
      }
    });
  }

  async function doSearch() {
    const q = view.querySelector('#pq').value.trim();
    if (q.length < 3) return toast(t('Escribe qué buscar (ej: "clínicas dentales en Madrid")', 'Type what to search (e.g.: "dental clinics in Madrid")'), true);
    const btn = view.querySelector('#psearch');
    btn.disabled = true;
    btn.textContent = t('Buscando y comprobando anuncios…', 'Searching and checking ads…');
    try {
      const out = await api('/prospecting/search', { method: 'POST', body: { query: q, filters: {} } });
      allResults = out.results;
      filterLocal();
    } catch (err) {
      toast(err.message, true);
    }
    btn.disabled = false;
    btn.textContent = t('Buscar negocios con anuncios activos', 'Search businesses with active ads');
  }

  render();
}
