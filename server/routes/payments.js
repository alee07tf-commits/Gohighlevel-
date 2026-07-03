const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const messaging = require('../services/messaging');
const automation = require('../services/automation');

const router = express.Router();
router.use(requireAuth, requireLocation);

function parsed(inv) {
  return inv ? { ...inv, items: JSON.parse(inv.items || '[]') } : inv;
}

async function nextNumber(locationId) {
  const { n } = await db.get('SELECT COUNT(*)::int AS n FROM invoices WHERE location_id = ?', [locationId]);
  return `INV-${String(n + 1).padStart(4, '0')}`;
}

router.get('/', async (req, res) => {
  const rows = await db.all(
    `SELECT i.*, c.first_name, c.last_name, c.email FROM invoices i
     LEFT JOIN contacts c ON c.id = i.contact_id
     WHERE i.location_id = ? ORDER BY i.id DESC LIMIT 200`,
    [req.location.id]
  );
  const stats = await db.get(
    `SELECT COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0)::float AS paid,
            COALESCE(SUM(total) FILTER (WHERE status = 'sent'), 0)::float AS outstanding
     FROM invoices WHERE location_id = ?`,
    [req.location.id]
  );
  res.json({ invoices: rows.map(parsed), stats });
});

router.post('/', async (req, res) => {
  const { contact_id, title, items, currency, due_date, kind, recurring } = req.body || {};
  const list = Array.isArray(items) ? items : [];
  const total = list.reduce((sum, it) => sum + (Number(it.qty) || 1) * (Number(it.price) || 0), 0);
  if (!list.length || total <= 0) return res.status(400).json({ error: 'At least one item with a price is required' });
  const id = await db.insert(
    `INSERT INTO invoices (location_id, contact_id, number, title, items, currency, total, due_date, token, kind, recurring)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.location.id,
      contact_id || null,
      await nextNumber(req.location.id),
      title || '',
      JSON.stringify(list),
      currency || 'EUR',
      total,
      due_date || '',
      crypto.randomBytes(16).toString('hex'),
      kind === 'quote' ? 'quote' : 'invoice',
      recurring === 'monthly' ? 'monthly' : '',
    ]
  );
  res.status(201).json(parsed(await db.get('SELECT * FROM invoices WHERE id = ?', [id])));
});

async function getInvoice(req, res, next) {
  const inv = await db.get('SELECT * FROM invoices WHERE id = ? AND location_id = ?', [
    req.params.id,
    req.location.id,
  ]);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  req.invoice = inv;
  next();
}

// Send the invoice to its contact (email + SMS/WhatsApp text-to-pay link).
router.post('/:id/send', getInvoice, async (req, res) => {
  const inv = req.invoice;
  if (!inv.contact_id) return res.status(400).json({ error: 'Invoice has no contact' });
  if (inv.status === 'paid') return res.status(400).json({ error: 'Invoice already paid' });
  const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [inv.contact_id]);
  const { channel = 'email' } = req.body || {};
  const url = `${req.protocol}://${req.get('host')}/pay/${inv.token}`;
  const text = `Hola {{first_name}}, aquí tienes tu factura ${inv.number} (${inv.total.toFixed(2)} ${inv.currency}) de ${req.location.name}. Puedes pagarla aquí: ${url}`;
  if (channel === 'email') {
    await messaging.sendEmail(req.location.id, contact, `Factura ${inv.number} — ${req.location.name}`, text);
  } else if (channel === 'whatsapp') {
    await messaging.sendWhatsapp(req.location.id, contact, text);
  } else {
    await messaging.sendSms(req.location.id, contact, text);
  }
  if (inv.status === 'draft') {
    await db.run(`UPDATE invoices SET status = 'sent' WHERE id = ?`, [inv.id]);
  }
  await automation.logActivity(req.location.id, contact.id, 'note', `Invoice ${inv.number} sent (${channel})`);
  res.json({ ok: true, url });
});

// Manually mark paid (cash/transfer). Fires the invoice_paid trigger.
router.post('/:id/mark-paid', getInvoice, async (req, res) => {
  if (req.invoice.status === 'paid') return res.status(400).json({ error: 'Already paid' });
  await module.exports.settleInvoice(req.invoice.id, 'manual');
  res.json(parsed(await db.get('SELECT * FROM invoices WHERE id = ?', [req.invoice.id])));
});

router.post('/:id/void', getInvoice, async (req, res) => {
  await db.run(`UPDATE invoices SET status = 'void' WHERE id = ?`, [req.invoice.id]);
  res.json({ ok: true });
});

router.delete('/:id', getInvoice, async (req, res) => {
  if (req.invoice.status === 'paid') return res.status(400).json({ error: 'Paid invoices cannot be deleted' });
  await db.run('DELETE FROM invoices WHERE id = ?', [req.invoice.id]);
  res.json({ ok: true });
});

// Shared settle path: manual mark-paid, simulated pay page, Stripe webhook.
module.exports = router;
module.exports.settleInvoice = async function settleInvoice(invoiceId, method) {
  const inv = await db.get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!inv || inv.status === 'paid') return false;
  await db.run(`UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = ?`, [inv.id]);
  if (inv.recurring === 'monthly') {
    const scheduler = require('../services/scheduler');
    await scheduler.schedule(inv.location_id, new Date(Date.now() + 30 * 86_400_000).toISOString(), 'recurring_invoice', {
      invoice_id: inv.id,
    });
  }
  if (inv.contact_id) {
    const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [inv.contact_id]);
    await automation.logActivity(
      inv.location_id,
      inv.contact_id,
      'note',
      `Invoice ${inv.number} paid (${method}) — ${inv.total.toFixed(2)} ${inv.currency}`
    );
    await automation.trigger(inv.location_id, 'invoice_paid', contact, { invoice_id: inv.id });
  }
  return true;
};
