// Companies / businesses (GoHighLevel parity): a first-class object that groups
// contacts. Scoped per sub-account like everything else.
const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireLocation);

const FIELDS = ['name', 'website', 'phone', 'email', 'industry', 'address', 'notes'];

// List with a contact count per company.
router.get('/', async (req, res) => {
  const rows = await db.all(
    `SELECT co.*, (SELECT COUNT(*) FROM contacts c WHERE c.company_id = co.id) AS contact_count
     FROM companies co WHERE co.location_id = ? ORDER BY co.name`,
    [req.location.id]
  );
  res.json(rows);
});

// Detail + the contacts linked to it.
router.get('/:id', async (req, res) => {
  const company = await db.get('SELECT * FROM companies WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  company.contacts = await db.all(
    `SELECT id, first_name, last_name, email, phone FROM contacts WHERE company_id = ? AND location_id = ? ORDER BY first_name`,
    [company.id, req.location.id]
  );
  res.json(company);
});

router.post('/', async (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: 'name is required' });
  const vals = FIELDS.map((f) => req.body[f] || '');
  const id = await db.insert(
    `INSERT INTO companies (location_id, ${FIELDS.join(', ')}) VALUES (?, ${FIELDS.map(() => '?').join(', ')})`,
    [req.location.id, ...vals]
  );
  res.status(201).json(await db.get('SELECT * FROM companies WHERE id = ?', [id]));
});

router.put('/:id', async (req, res) => {
  const company = await db.get('SELECT * FROM companies WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const merged = { ...company, ...req.body };
  await db.run(
    `UPDATE companies SET ${FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
    [...FIELDS.map((f) => merged[f] || ''), company.id]
  );
  res.json(await db.get('SELECT * FROM companies WHERE id = ?', [company.id]));
});

router.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM companies WHERE id = ? AND location_id = ?', [req.params.id, req.location.id]);
  if (!info.changes) return res.status(404).json({ error: 'Company not found' });
  res.json({ ok: true });
});

module.exports = router;
