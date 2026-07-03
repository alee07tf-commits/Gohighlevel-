import { api } from '../api.js';
import { esc, openModal, closeOverlay, toast, fmtDate, fmtMoney, fullName } from '../ui.js';

export async function renderPayments(view) {
  const data = await api('/payments');
  const { invoices, stats } = data;
  const badge = { draft: 'gray', sent: 'amber', paid: 'green', void: 'red' };

  view.innerHTML = `
  <div class="page-header">
    <h1>Pagos</h1>
    <div class="spacer"></div>
    <button class="btn" id="new-invoice">+ Factura</button>
  </div>
  <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
    <div class="stat"><div class="stat-label">Cobrado</div><div class="stat-value">${fmtMoney(stats.paid)}</div></div>
    <div class="stat"><div class="stat-label">Pendiente de cobro</div><div class="stat-value">${fmtMoney(stats.outstanding)}</div></div>
    <div class="stat"><div class="stat-label">Facturas</div><div class="stat-value">${invoices.length}</div></div>
  </div>
  <div class="card">
    ${
      invoices.length
        ? `<table class="table"><thead><tr><th>Nº</th><th>Cliente</th><th>Concepto</th><th>Total</th><th>Estado</th><th></th></tr></thead>
          <tbody>${invoices
            .map(
              (i) => `<tr>
                <td><strong>${esc(i.number)}</strong><div class="muted" style="font-size:11px">${fmtDate(i.created_at)}</div></td>
                <td>${i.contact_id ? esc(fullName(i)) : '<span class="muted">—</span>'}</td>
                <td>${esc(i.title || i.items[0]?.name || '')}</td>
                <td><strong>${i.total.toFixed(2)} ${esc(i.currency)}</strong></td>
                <td><span class="badge ${badge[i.status]}">${i.status}</span></td>
                <td style="text-align:right;white-space:nowrap">
                  <a class="btn secondary small" href="/pay/${esc(i.token)}" target="_blank">Ver ↗</a>
                  ${i.status !== 'paid' && i.status !== 'void' ? `
                    <button class="btn secondary small send-inv" data-id="${i.id}" ${i.contact_id ? '' : 'disabled title="Sin contacto"'}>Enviar</button>
                    <button class="btn small paid-inv" data-id="${i.id}">Cobrada</button>` : ''}
                  ${i.status !== 'paid' ? `<button class="btn ghost small del-inv" data-id="${i.id}">✕</button>` : ''}
                </td></tr>`
            )
            .join('')}</tbody></table>`
        : '<div class="empty"><div class="big">💳</div>No hay facturas aún. Crea la primera y cóbrala con un link.</div>'
    }
  </div>`;

  view.querySelector('#new-invoice').addEventListener('click', invoiceModal);
  view.querySelectorAll('.paid-inv').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Marcar como cobrada (efectivo/transferencia)? Disparará las automatizaciones de pago.')) return;
      try {
        await api(`/payments/${b.dataset.id}/mark-paid`, { method: 'POST' });
        toast('Factura cobrada');
        renderPayments(view);
      } catch (err) { toast(err.message, true); }
    })
  );
  view.querySelectorAll('.del-inv').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar factura?')) return;
      await api(`/payments/${b.dataset.id}`, { method: 'DELETE' });
      renderPayments(view);
    })
  );
  view.querySelectorAll('.send-inv').forEach((b) =>
    b.addEventListener('click', () => {
      const modal = openModal(`
        <h2>Enviar factura</h2>
        <label class="field"><span class="label">Canal</span><select class="input" id="channel">
          <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
        </select></label>
        <div class="modal-actions">
          <button class="btn secondary" id="cancel">Cancelar</button>
          <button class="btn" id="go">Enviar link de pago</button>
        </div>`);
      modal.querySelector('#cancel').addEventListener('click', closeOverlay);
      modal.querySelector('#go').addEventListener('click', async () => {
        try {
          await api(`/payments/${b.dataset.id}/send`, {
            method: 'POST',
            body: { channel: modal.querySelector('#channel').value },
          });
          closeOverlay();
          toast('Factura enviada');
          renderPayments(view);
        } catch (err) { toast(err.message, true); }
      });
    })
  );

  function invoiceModal() {
    const items = [{ name: '', qty: 1, price: '' }];
    const modal = openModal(`
      <h2>Nueva Factura</h2>
      <label class="field"><span class="label">Concepto / título</span><input class="input" id="inv-title" placeholder="Tratamiento blanqueamiento"></label>
      <label class="field"><span class="label">Contacto (buscar)</span>
        <input class="input" id="inv-contact-search" placeholder="nombre o email" autocomplete="off">
        <input type="hidden" id="inv-contact-id"><div id="inv-contact-results"></div></label>
      <div class="form-row">
        <label class="field"><span class="label">Moneda</span><select class="input" id="inv-currency">
          <option>EUR</option><option>USD</option><option>MXN</option><option>COP</option><option>ARS</option></select></label>
        <label class="field"><span class="label">Vencimiento</span><input class="input" id="inv-due" type="date"></label>
      </div>
      <div class="card-title" style="padding:0;margin-bottom:6px">Líneas</div>
      <div id="inv-items"></div>
      <button type="button" class="btn secondary small" id="add-item">+ línea</button>
      <div class="modal-actions">
        <button class="btn secondary" id="cancel">Cancelar</button>
        <button class="btn" id="save">Crear factura</button>
      </div>`);

    function renderItems() {
      modal.querySelector('#inv-items').innerHTML = items
        .map(
          (it, i) => `<div class="flex" style="margin-bottom:8px">
            <input class="input" data-i="${i}" data-k="name" placeholder="Descripción" value="${esc(it.name)}" style="flex:3">
            <input class="input" data-i="${i}" data-k="qty" type="number" min="1" value="${it.qty}" style="flex:1">
            <input class="input" data-i="${i}" data-k="price" type="number" step="0.01" placeholder="Precio" value="${esc(it.price)}" style="flex:1">
            <button type="button" class="btn ghost small rm-item" data-i="${i}">✕</button>
          </div>`
        )
        .join('');
      modal.querySelectorAll('#inv-items [data-k]').forEach((inp) =>
        inp.addEventListener('input', () => { items[Number(inp.dataset.i)][inp.dataset.k] = inp.value; })
      );
      modal.querySelectorAll('.rm-item').forEach((b) =>
        b.addEventListener('click', () => { items.splice(Number(b.dataset.i), 1); renderItems(); })
      );
    }
    renderItems();
    modal.querySelector('#add-item').addEventListener('click', () => { items.push({ name: '', qty: 1, price: '' }); renderItems(); });

    let timer;
    modal.querySelector('#inv-contact-search').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const results = await api(`/contacts?q=${encodeURIComponent(e.target.value)}&limit=5`);
        const div = modal.querySelector('#inv-contact-results');
        div.innerHTML = results.map((c) => `<a href="#" data-id="${c.id}" class="tag">${esc(fullName(c))}</a>`).join(' ');
        div.querySelectorAll('a').forEach((a) =>
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            modal.querySelector('#inv-contact-id').value = a.dataset.id;
            modal.querySelector('#inv-contact-search').value = a.textContent;
            div.innerHTML = '';
          })
        );
      }, 250);
    });

    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#save').addEventListener('click', async () => {
      try {
        await api('/payments', {
          method: 'POST',
          body: {
            title: modal.querySelector('#inv-title').value,
            contact_id: Number(modal.querySelector('#inv-contact-id').value) || null,
            currency: modal.querySelector('#inv-currency').value,
            due_date: modal.querySelector('#inv-due').value,
            items: items.filter((it) => it.name && Number(it.price) > 0),
          },
        });
        closeOverlay();
        toast('Factura creada');
        renderPayments(view);
      } catch (err) { toast(err.message, true); }
    });
  }
}
