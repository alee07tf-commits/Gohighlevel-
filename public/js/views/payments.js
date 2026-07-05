import { api } from '../api.js';
import { esc, openModal, closeOverlay, toast, fmtDate, fmtMoney, fullName } from '../ui.js';
import { t } from '../i18n.js';

export async function renderPayments(view) {
  const data = await api('/payments');
  const { invoices, stats } = data;
  const badge = { draft: 'gray', sent: 'amber', paid: 'green', void: 'red' };
  const statusLabel = {
    draft: t('Borrador', 'Draft'),
    sent: t('Enviada', 'Sent'),
    paid: t('Pagada', 'Paid'),
    void: t('Anulada', 'Void'),
  };

  view.innerHTML = `
  <div class="page-header">
    <h1>${t('Pagos', 'Payments')}</h1>
    <div class="spacer"></div>
    <button class="btn" id="new-invoice">${t('+ Factura', '+ Invoice')}</button>
  </div>
  <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
    <div class="stat"><div class="stat-label">${t('Cobrado', 'Collected')}</div><div class="stat-value">${fmtMoney(stats.paid)}</div></div>
    <div class="stat"><div class="stat-label">${t('Pendiente de cobro', 'Outstanding')}</div><div class="stat-value">${fmtMoney(stats.outstanding)}</div></div>
    <div class="stat"><div class="stat-label">${t('Facturas', 'Invoices')}</div><div class="stat-value">${invoices.length}</div></div>
  </div>
  <div class="card">
    ${
      invoices.length
        ? `<table class="table"><thead><tr><th>${t('Nº', 'No.')}</th><th>${t('Cliente', 'Client')}</th><th>${t('Concepto', 'Description')}</th><th>${t('Total', 'Total')}</th><th>${t('Estado', 'Status')}</th><th></th></tr></thead>
          <tbody>${invoices
            .map(
              (i) => `<tr>
                <td><strong>${esc(i.number)}</strong>${i.kind === 'quote' ? ` <span class="badge amber">${t('presupuesto', 'quote')}</span>` : ''}${i.recurring ? ` <span class="badge indigo">${t('mensual', 'monthly')}</span>` : ''}<div class="muted" style="font-size:11px">${fmtDate(i.created_at)}</div></td>
                <td>${i.contact_id ? esc(fullName(i)) : '<span class="muted">—</span>'}</td>
                <td>${esc(i.title || i.items[0]?.name || '')}</td>
                <td><strong>${i.total.toFixed(2)} ${esc(i.currency)}</strong></td>
                <td><span class="badge ${badge[i.status]}">${statusLabel[i.status] || i.status}</span></td>
                <td style="text-align:right;white-space:nowrap">
                  <a class="btn secondary small" href="/pay/${esc(i.token)}" target="_blank">${t('Ver ↗', 'View ↗')}</a>
                  ${i.status !== 'paid' && i.status !== 'void' ? `
                    <button class="btn secondary small send-inv" data-id="${i.id}" ${i.contact_id ? '' : `disabled title="${t('Sin contacto', 'No contact')}"`}>${t('Enviar', 'Send')}</button>
                    <button class="btn small paid-inv" data-id="${i.id}">${t('Cobrada', 'Mark paid')}</button>` : ''}
                  ${i.status !== 'paid' ? `<button class="btn ghost small del-inv" data-id="${i.id}">✕</button>` : ''}
                </td></tr>`
            )
            .join('')}</tbody></table>`
        : `<div class="empty"><div class="big"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>${t('No hay facturas aún. Crea la primera y cóbrala con un link.', 'No invoices yet. Create the first one and collect it with a link.')}</div>`
    }
  </div>`;

  view.querySelector('#new-invoice').addEventListener('click', invoiceModal);
  view.querySelectorAll('.paid-inv').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('¿Marcar como cobrada (efectivo/transferencia)? Disparará las automatizaciones de pago.', 'Mark as paid (cash/transfer)? This will trigger the payment automations.'))) return;
      try {
        await api(`/payments/${b.dataset.id}/mark-paid`, { method: 'POST' });
        toast(t('Factura cobrada', 'Invoice marked paid'));
        renderPayments(view);
      } catch (err) { toast(err.message, true); }
    })
  );
  view.querySelectorAll('.del-inv').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('¿Eliminar factura?', 'Delete invoice?'))) return;
      await api(`/payments/${b.dataset.id}`, { method: 'DELETE' });
      renderPayments(view);
    })
  );
  view.querySelectorAll('.send-inv').forEach((b) =>
    b.addEventListener('click', () => {
      const modal = openModal(`
        <h2>${t('Enviar factura', 'Send invoice')}</h2>
        <label class="field"><span class="label">${t('Canal', 'Channel')}</span><select class="input" id="channel">
          <option value="email">${t('Email', 'Email')}</option><option value="sms">${t('SMS', 'SMS')}</option><option value="whatsapp">${t('WhatsApp', 'WhatsApp')}</option>
        </select></label>
        <div class="modal-actions">
          <button class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
          <button class="btn" id="go">${t('Enviar link de pago', 'Send payment link')}</button>
        </div>`);
      modal.querySelector('#cancel').addEventListener('click', closeOverlay);
      modal.querySelector('#go').addEventListener('click', async () => {
        try {
          await api(`/payments/${b.dataset.id}/send`, {
            method: 'POST',
            body: { channel: modal.querySelector('#channel').value },
          });
          closeOverlay();
          toast(t('Factura enviada', 'Invoice sent'));
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
        <label class="field"><span class="label">Tipo</span><select class="input" id="inv-kind">
          <option value="invoice">Factura</option><option value="quote">Presupuesto</option></select></label>
        <label class="field"><span class="label">Recurrencia</span><select class="input" id="inv-recurring">
          <option value="">Puntual</option><option value="monthly">Mensual (auto)</option></select></label>
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
            kind: modal.querySelector('#inv-kind').value,
            recurring: modal.querySelector('#inv-recurring').value,
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
