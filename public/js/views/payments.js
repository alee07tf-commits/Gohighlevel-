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
    <button class="btn secondary" id="coupons-btn">${t('Cupones', 'Coupons')}</button>
    <button class="btn secondary" id="products-btn">${t('Productos', 'Products')}</button>
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
  view.querySelector('#products-btn').addEventListener('click', productsModal);
  view.querySelector('#coupons-btn').addEventListener('click', couponsModal);

  async function couponsModal() {
    const list = await api('/coupons');
    const modal = openModal(`
      <h2>${t('Cupones de descuento', 'Discount coupons')}</h2>
      <p class="muted" style="margin-bottom:12px;font-size:13px">${t('Códigos reutilizables que aplican descuento al crear una factura o en el checkout.', 'Reusable codes that apply a discount when creating an invoice or at checkout.')}</p>
      <div id="cp-list" style="margin-bottom:14px">${list.length ? list.map(couponRow).join('') : `<p class="muted">${t('Sin cupones todavía.', 'No coupons yet.')}</p>`}</div>
      <form id="cp-form" class="card" style="padding:12px">
        <div class="form-row">
          <label class="field"><span class="label">${t('Código', 'Code')}</span><input class="input" name="code" placeholder="VERANO20" required></label>
          <label class="field" style="max-width:130px"><span class="label">${t('Tipo', 'Type')}</span>
            <select class="input" name="type"><option value="percent">%</option><option value="fixed">${t('fijo', 'fixed')}</option></select></label>
          <label class="field" style="max-width:120px"><span class="label">${t('Valor', 'Value')}</span><input class="input" name="value" type="number" step="0.01" min="0" required></label>
        </div>
        <div class="form-row">
          <label class="field"><span class="label">${t('Usos máx. (0 = ilimitado)', 'Max uses (0 = unlimited)')}</span><input class="input" name="max_uses" type="number" min="0" value="0"></label>
          <label class="field"><span class="label">${t('Caduca (opcional)', 'Expires (optional)')}</span><input class="input" name="expires_at" type="date"></label>
        </div>
        <button class="btn">${t('+ Crear cupón', '+ Create coupon')}</button>
      </form>`);
    const reload = () => { closeOverlay(); couponsModal(); };
    modal.querySelectorAll('.cp-del').forEach((b) => b.addEventListener('click', async () => {
      await api(`/coupons/${b.dataset.id}`, { method: 'DELETE' }); reload();
    }));
    modal.querySelectorAll('.cp-toggle').forEach((b) => b.addEventListener('click', async () => {
      await api(`/coupons/${b.dataset.id}`, { method: 'PUT', body: { active: b.dataset.active === '0' } }); reload();
    }));
    modal.querySelector('#cp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try { await api('/coupons', { method: 'POST', body: { ...f, value: Number(f.value), max_uses: Number(f.max_uses), expires_at: f.expires_at || null } }); reload(); }
      catch (err) { toast(err.message, true); }
    });
  }
  function couponRow(c) {
    const val = c.type === 'percent' ? `${c.value}%` : fmtMoney(c.value);
    const exp = c.expires_at ? ` · ${t('caduca', 'exp')} ${fmtDate(c.expires_at)}` : '';
    const uses = c.max_uses ? `${c.uses}/${c.max_uses}` : `${c.uses}`;
    return `<div class="appt-row"><div style="flex:1"><strong>${esc(c.code)}</strong> <span class="badge ${c.active ? 'green' : 'gray'}">${c.active ? t('activo', 'active') : t('inactivo', 'off')}</span>
      <div class="muted" style="font-size:11px">${val} ${t('dto', 'off')} · ${t('usos', 'uses')} ${uses}${exp}</div></div>
      <button class="btn ghost small cp-toggle" data-id="${c.id}" data-active="${c.active}">${c.active ? t('Desactivar', 'Disable') : t('Activar', 'Enable')}</button>
      <button class="btn ghost small cp-del" data-id="${c.id}">✕</button></div>`;
  }

  async function productsModal() {
    const products = await api('/payments/products').catch(() => []);
    const modal = openModal(`<h2>${t('Productos y servicios', 'Products & services')}</h2>
      <div id="pr-list">${products.length
        ? products.map((p) => `<div class="appt-row"><div style="flex:1"><strong>${esc(p.name)}</strong> · ${fmtMoney(p.price, p.currency)}${p.recurring ? ` <span class="badge indigo">${t('mensual', 'monthly')}</span>` : ''}${p.description ? `<div class="muted" style="font-size:12px">${esc(p.description)}</div>` : ''}</div>
            <button class="btn ghost small pr-del" data-id="${p.id}">✕</button></div>`).join('')
        : `<p class="muted">${t('Sin productos aún.', 'No products yet.')}</p>`}</div>
      <form id="pr-form" style="margin-top:10px"><div class="form-row">
        <label class="field" style="flex:2"><span class="label">${t('Nombre', 'Name')}</span><input class="input" name="name" required></label>
        <label class="field"><span class="label">${t('Precio', 'Price')}</span><input class="input" name="price" type="number" step="0.01" required></label>
        <label class="field"><span class="label">${t('Recurrencia', 'Recurrence')}</span><select class="input" name="recurring"><option value="">${t('Puntual', 'One-time')}</option><option value="monthly">${t('Mensual', 'Monthly')}</option></select></label>
      </div>
        <div class="modal-actions"><button type="button" class="btn secondary" id="c">${t('Cerrar', 'Close')}</button><button class="btn">+ ${t('Añadir', 'Add')}</button></div></form>`);
    const reload = () => { closeOverlay(); productsModal(); };
    modal.querySelector('#c').addEventListener('click', closeOverlay);
    modal.querySelectorAll('.pr-del').forEach((b) => b.addEventListener('click', async () => { await api(`/payments/products/${b.dataset.id}`, { method: 'DELETE' }); reload(); }));
    modal.querySelector('#pr-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target).entries());
      try { await api('/payments/products', { method: 'POST', body: d }); reload(); }
      catch (err) { toast(err.message, true); }
    });
  }
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

  async function invoiceModal() {
    const items = [{ name: '', qty: 1, price: '' }];
    const products = await api('/payments/products').catch(() => []);
    const modal = openModal(`
      <h2>${t('Nueva Factura', 'New Invoice')}</h2>
      <label class="field"><span class="label">${t('Concepto / título', 'Description / title')}</span><input class="input" id="inv-title" placeholder="${t('Tratamiento blanqueamiento', 'Whitening treatment')}"></label>
      <label class="field"><span class="label">${t('Contacto (buscar)', 'Contact (search)')}</span>
        <input class="input" id="inv-contact-search" placeholder="${t('nombre o email', 'name or email')}" autocomplete="off">
        <input type="hidden" id="inv-contact-id"><div id="inv-contact-results"></div></label>
      <div class="form-row">
        <label class="field"><span class="label">${t('Tipo', 'Type')}</span><select class="input" id="inv-kind">
          <option value="invoice">${t('Factura', 'Invoice')}</option><option value="quote">${t('Presupuesto', 'Quote')}</option></select></label>
        <label class="field"><span class="label">${t('Recurrencia', 'Recurrence')}</span><select class="input" id="inv-recurring">
          <option value="">${t('Puntual', 'One-time')}</option><option value="monthly">${t('Mensual (auto)', 'Monthly (auto)')}</option></select></label>
        <label class="field"><span class="label">${t('Moneda', 'Currency')}</span><select class="input" id="inv-currency">
          <option>EUR</option><option>USD</option><option>MXN</option><option>COP</option><option>ARS</option></select></label>
        <label class="field"><span class="label">${t('Vencimiento', 'Due date')}</span><input class="input" id="inv-due" type="date"></label>
      </div>
      <div class="card-title" style="padding:0;margin-bottom:6px">${t('Líneas', 'Line items')}</div>
      <div id="inv-items"></div>
      <div class="flex" style="gap:6px;margin-top:4px">
        <button type="button" class="btn secondary small" id="add-item">${t('+ línea', '+ line')}</button>
        ${products.length ? `<select class="input" id="prod-pick" style="width:auto"><option value="">${t('+ producto…', '+ product…')}</option>${products.map((p) => `<option value="${p.id}">${esc(p.name)} · ${p.price} ${esc(p.currency)}</option>`).join('')}</select>` : ''}
      </div>
      <div class="form-row" style="margin-top:8px">
        <label class="field"><span class="label">${t('Descuento (importe)', 'Discount (amount)')}</span><input class="input" id="inv-discount" type="number" step="0.01" min="0" value="0"></label>
        <label class="field"><span class="label">${t('Impuesto (%)', 'Tax (%)')}</span><input class="input" id="inv-tax" type="number" step="0.01" min="0" value="0"></label>
        <label class="field"><span class="label">${t('Cupón (opcional)', 'Coupon (optional)')}</span><input class="input" id="inv-coupon" placeholder="VERANO20"></label>
      </div>
      <label class="field"><span class="label">${t('Order bumps / upsells (opcional) — una por línea: Nombre | Precio', 'Order bumps / upsells (optional) — one per line: Name | Price')}</span>
        <textarea class="input" id="inv-bumps" rows="2" placeholder="${t('Soporte premium | 30', 'Premium support | 30')}"></textarea>
        <span class="muted" style="font-size:11px">${t('El cliente podrá añadirlos en la página de pago.', 'The client can add them on the payment page.')}</span></label>
      <div class="modal-actions">
        <button class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
        <button class="btn" id="save">${t('Crear factura', 'Create invoice')}</button>
      </div>`);

    function renderItems() {
      modal.querySelector('#inv-items').innerHTML = items
        .map(
          (it, i) => `<div class="flex" style="margin-bottom:8px">
            <input class="input" data-i="${i}" data-k="name" placeholder="${t('Descripción', 'Description')}" value="${esc(it.name)}" style="flex:3">
            <input class="input" data-i="${i}" data-k="qty" type="number" min="1" value="${it.qty}" style="flex:1">
            <input class="input" data-i="${i}" data-k="price" type="number" step="0.01" placeholder="${t('Precio', 'Price')}" value="${esc(it.price)}" style="flex:1">
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
    modal.querySelector('#prod-pick')?.addEventListener('change', (e) => {
      const p = products.find((x) => x.id === Number(e.target.value));
      if (p) { if (items.length === 1 && !items[0].name && !items[0].price) items.pop(); items.push({ name: p.name, qty: 1, price: p.price }); renderItems(); }
      e.target.value = '';
    });

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
            discount: Number(modal.querySelector('#inv-discount').value) || 0,
            tax_rate: Number(modal.querySelector('#inv-tax').value) || 0,
            coupon_code: modal.querySelector('#inv-coupon').value.trim() || undefined,
            bumps: modal.querySelector('#inv-bumps').value.split('\n').map((l) => l.split('|')).filter((p) => p[0] && p[0].trim() && p[1]).map((p) => ({ name: p[0].trim(), price: Number(p[1]) || 0 })).filter((b) => b.price > 0),
            items: items.filter((it) => it.name && Number(it.price) > 0),
          },
        });
        closeOverlay();
        toast(t('Factura creada', 'Invoice created'));
        renderPayments(view);
      } catch (err) { toast(err.message, true); }
    });
  }
}
