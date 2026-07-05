// Documents & Contracts with e-signature. The agency drafts a document, sends
// it to a contact (a public /sign/<token> link), and the client signs it there.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const automation = require('../services/automation');

const router = express.Router();
router.use(requireAuth, requireLocation);

const withContact = `SELECT d.*, c.first_name, c.last_name, c.email FROM documents d
  LEFT JOIN contacts c ON c.id = d.contact_id`;

router.get('/', async (req, res) => {
  res.json(await db.all(`${withContact} WHERE d.location_id = ? ORDER BY d.id DESC`, [req.location.id]));
});

router.get('/:id', async (req, res) => {
  const doc = await db.get(`${withContact} WHERE d.id = ? AND d.location_id = ?`, [req.params.id, req.location.id]);
  if (!doc) return res.status(404).json({ error: 'No encontrado' });
  res.json(doc);
});

router.post('/', async (req, res) => {
  const { title, body, contact_id } = req.body || {};
  if (!title) return res.status(400).json({ error: 'El título es obligatorio' });
  if (contact_id) {
    const ok = await db.get('SELECT id FROM contacts WHERE id = ? AND location_id = ?', [contact_id, req.location.id]);
    if (!ok) return res.status(400).json({ error: 'Contacto no encontrado en esta sub-cuenta' });
  }
  const id = await db.insert(
    'INSERT INTO documents (location_id, contact_id, title, body, token) VALUES (?, ?, ?, ?, ?)',
    [req.location.id, contact_id || null, title, body || '', crypto.randomBytes(16).toString('hex')]
  );
  res.status(201).json(await db.get('SELECT * FROM documents WHERE id = ?', [id]));
});

router.put('/:id', async (req, res) => {
  const doc = await db.get('SELECT * FROM documents WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!doc) return res.status(404).json({ error: 'No encontrado' });
  if (doc.status === 'signed') return res.status(400).json({ error: 'Un documento firmado no se puede editar' });
  const b = req.body || {};
  await db.run('UPDATE documents SET title = ?, body = ?, contact_id = ? WHERE id = ?', [
    b.title ?? doc.title, b.body ?? doc.body, b.contact_id !== undefined ? (b.contact_id || null) : doc.contact_id, doc.id,
  ]);
  res.json(await db.get('SELECT * FROM documents WHERE id = ?', [doc.id]));
});

// Send: mark as sent and (best-effort) email the sign link to the contact.
router.post('/:id/send', async (req, res) => {
  const doc = await db.get(`${withContact} WHERE d.id = ? AND d.location_id = ?`, [req.params.id, req.location.id]);
  if (!doc) return res.status(404).json({ error: 'No encontrado' });
  if (!doc.contact_id) return res.status(400).json({ error: 'Asigna un contacto antes de enviar' });
  await db.run("UPDATE documents SET status = 'sent' WHERE id = ?", [doc.id]);
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const link = `${base}/sign/${doc.token}`;
  let delivery = 'no-email';
  if (doc.email) {
    try {
      const providers = require('../services/providers');
      const r = await providers.deliverEmail({
        to: doc.email, subject: `Documento para firmar: ${doc.title}`, fromName: req.location.name,
        text: `Hola${doc.first_name ? ` ${doc.first_name}` : ''},\n\nTienes un documento pendiente de firma: ${doc.title}\nFírmalo aquí: ${link}\n\nGracias.`,
      });
      delivery = r.provider === 'simulated' ? 'simulated' : 'sent';
    } catch { delivery = 'failed'; }
  }
  if (doc.contact_id) await automation.logActivity(req.location.id, doc.contact_id, 'note', `Documento enviado para firma: ${doc.title}`);
  res.json({ ok: true, url: link, delivery });
});

router.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM documents WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!info.changes) return res.status(404).json({ error: 'No encontrado' });
  res.json({ ok: true });
});

module.exports = router;
