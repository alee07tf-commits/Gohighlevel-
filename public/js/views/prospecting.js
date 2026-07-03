import { api } from '../api.js';
import { esc, toast } from '../ui.js';

export async function renderProspecting(view) {
  const status = await api('/prospecting/status');
  let results = [];

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
        <input class="input" id="pq" placeholder='Ej: "dentistas en Valencia", "gimnasios en Bogotá", "restaurantes en Malasaña"' style="flex:1"
          onkeydown="if(event.key==='Enter')document.getElementById('psearch').click()">
        <button class="btn" id="psearch">🔎 Buscar</button>
      </div>
      ${status.provider === 'simulated'
        ? '<p class="muted" style="font-size:12px;margin-top:8px">Sin clave configurada verás resultados de ejemplo para probar el flujo. Con <code class="inline">GOOGLE_PLACES_API_KEY</code> (API oficial de Google, con capa gratuita) o <code class="inline">SERPER_API_KEY</code> buscarás negocios reales de Google Maps.</p>'
        : ''}
    </div></div>
    <div id="presults"></div>`;

    view.querySelector('#psearch').addEventListener('click', doSearch);
    renderResults();
  }

  function renderResults() {
    const el = view.querySelector('#presults');
    if (!results.length) {
      el.innerHTML = '<div class="empty card" style="padding:50px"><div class="big">🔎</div>Busca un tipo de negocio y una zona para empezar.</div>';
      return;
    }
    el.innerHTML = `
    <div class="card">
      <div class="card-title" style="display:flex;align-items:center;gap:10px;padding-bottom:8px">
        <span>${results.length} resultados</span>
        <label class="flex" style="font-weight:400;font-size:12px"><input type="checkbox" id="sel-all" checked> todos</label>
        <span class="right"></span>
        <input class="input" id="ptag" value="prospecto" style="width:130px" title="Tag para los importados">
        <label class="flex" style="font-weight:400;font-size:12px"><input type="checkbox" id="popp" checked> crear oportunidades</label>
        <button class="btn" id="pimport">⬇ Importar seleccionados</button>
      </div>
      <table class="table"><thead><tr><th></th><th>Negocio</th><th>Dirección</th><th>Teléfono</th><th>Web</th><th>Google</th></tr></thead>
      <tbody>
        ${results
          .map(
            (r, i) => `<tr>
              <td><input type="checkbox" class="psel" data-i="${i}" ${r.already_contact ? '' : 'checked'} ${r.already_contact ? 'disabled' : ''}></td>
              <td><strong>${esc(r.name)}</strong>${r.demo ? ' <span class="badge gray">demo</span>' : ''}
                ${r.already_contact ? ' <span class="badge indigo">ya es contacto</span>' : ''}</td>
              <td class="muted" style="font-size:12px">${esc(r.address)}</td>
              <td>${esc(r.phone) || '<span class="muted">—</span>'}</td>
              <td>${r.website ? `<a href="${esc(r.website)}" target="_blank">web ↗</a>` : '<span class="muted">sin web 🎯</span>'}</td>
              <td>${r.rating ? `⭐ ${r.rating} <span class="muted">(${r.reviews})</span>` : '<span class="muted">—</span>'}
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
        btn.textContent = '⬇ Importar seleccionados';
      }
    });
  }

  async function doSearch() {
    const q = view.querySelector('#pq').value.trim();
    if (q.length < 3) return toast('Escribe qué buscar (ej: "dentistas en Madrid")', true);
    const btn = view.querySelector('#psearch');
    btn.disabled = true;
    btn.textContent = 'Buscando…';
    try {
      const out = await api('/prospecting/search', { method: 'POST', body: { query: q } });
      results = out.results;
      renderResults();
    } catch (err) {
      toast(err.message, true);
    }
    btn.disabled = false;
    btn.textContent = '🔎 Buscar';
  }

  render();
}
