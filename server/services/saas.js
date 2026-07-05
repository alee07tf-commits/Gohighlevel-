// SaaS self-serve provisioning: turn a paid (or simulated) signup into a fully
// configured sub-account — load the plan's snapshot, create the client login,
// open a subscription, and email the credentials. Used by the simulated signup
// path and the Stripe subscription webhook.
const crypto = require('crypto');
const db = require('../db');
const provisioning = require('./provisioning');

function tempPassword() {
  return crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) + '9a';
}

// agency: row, plan: row, client: { name, email }, stripe: { subscription_id, customer_id }
async function provisionFromPlan({ agency, plan, client, stripe = {} }) {
  const password = tempPassword();
  // provisionSubAccount owns its transaction; the subscription is recorded
  // right after (kept separate to avoid nesting transactions on the single
  // embedded connection).
  const result = await provisioning.provisionSubAccount({
    agencyId: agency.id,
    profile: { name: client.business_name || client.name, email: client.email },
    snapshotId: plan.snapshot_id || undefined,
    client: { name: client.name, email: client.email, password },
  });
  await db.run(
    `INSERT INTO subscriptions (agency_id, location_id, plan_id, client_user_id, status, stripe_subscription_id, stripe_customer_id)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    [agency.id, result.locId, plan.id, result.clientUserId, stripe.subscription_id || '', stripe.customer_id || '']
  );

  // Email the credentials (best effort; uses the agency's email integration).
  try {
    const providers = require('./providers');
    const appUrl = process.env.APP_URL || '';
    await providers.deliverEmail(
      {
        to: client.email,
        subject: `Tu cuenta de ${agency.name} está lista`,
        text: `¡Bienvenido/a${client.name ? `, ${client.name}` : ''}!\n\nTu cuenta ya está activa.\nAccede en: ${appUrl || '(tu panel)'}\nUsuario: ${client.email}\nContraseña temporal: ${password}\n\nCámbiala al entrar.`,
        fromName: agency.name,
      },
      { agencyId: agency.id }
    );
  } catch {
    /* email optional */
  }

  return { locationId: result.locId, clientUserId: result.clientUserId, password, provisioned: result.provisioned };
}

module.exports = { provisionFromPlan };
