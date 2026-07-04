// Wallet & rebilling for a sub-account: view balance, usage and transactions,
// and top up funds. With a real Stripe key the top-up goes through Checkout;
// in simulated mode it credits the wallet directly (connector pattern).
const express = require('express');
const db = require('../db');
const { requireAuth, requireLocation } = require('../auth');
const billing = require('../services/billing');
const providers = require('../services/providers');

const router = express.Router();
router.use(requireAuth, requireLocation);

router.get('/wallet', async (req, res) => {
  const wallet = await billing.getWallet(req.location.id);
  const usage = await billing.monthlyUsage(req.location.id);
  const tx = await db.all(
    'SELECT amount, kind, description, created_at FROM wallet_transactions WHERE location_id = ? ORDER BY id DESC LIMIT 50',
    [req.location.id]
  );
  const sub = await billing.activeSubscription(req.location.id);
  res.json({ wallet, usage, transactions: tx, subscription: sub || null });
});

router.post('/wallet/topup', async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'Importe inválido' });
  // Real Stripe → Checkout for the top-up; simulated → credit directly.
  const provider = await providers.paymentsProvider({ locationId: req.location.id, agencyId: req.user.agency_id });
  if (provider === 'stripe') {
    const base = `${req.protocol}://${req.get('host')}`;
    const fakeInvoice = {
      id: `wallet-${req.location.id}`,
      token: 'wallet',
      total: amount,
      currency: 'EUR',
      title: `Recarga de saldo — ${req.location.name}`,
      number: 'WALLET',
    };
    const session = await providers.createCheckoutSession(
      { invoice: fakeInvoice, successUrl: `${base}/#/agency?topup=ok`, cancelUrl: `${base}/#/agency` },
      { locationId: req.location.id, agencyId: req.user.agency_id }
    );
    return res.json({ mode: 'stripe', url: session ? session.url : null });
  }
  const wallet = await billing.topUp(req.location.id, amount, 'topup', 'Recarga (simulada)');
  res.json({ mode: 'simulated', wallet });
});

module.exports = router;
