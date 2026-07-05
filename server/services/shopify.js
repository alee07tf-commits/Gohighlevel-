// Shopify deep integration (v3.5). Receives store webhooks (orders/customers)
// and turns them into CRM contacts + opportunities. The store is matched to a
// connected sub-account by its shop domain; payloads are HMAC-verified with the
// app secret. No outbound API call is needed for ingestion — Shopify posts the
// full order/customer, so this works end-to-end the moment a store is connected.
const crypto = require('crypto');

// Verifies the X-Shopify-Hmac-Sha256 header against the raw body using the app
// secret (base64 HMAC-SHA256). Returns true when it matches.
function verifyHmac(rawBody, hmacHeader, secret) {
  if (!rawBody || !hmacHeader || !secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(String(hmacHeader));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Extracts a contact shape from a Shopify order/customer payload. Shopify orders
// carry `customer` + top-level email; customers/create is the customer object.
function mapCustomer(payload = {}) {
  const c = payload.customer || payload;
  const addr = c.default_address || payload.shipping_address || payload.billing_address || {};
  return {
    email: payload.email || c.email || '',
    phone: c.phone || payload.phone || addr.phone || '',
    first_name: c.first_name || addr.first_name || '',
    last_name: c.last_name || addr.last_name || '',
  };
}

// Summarises an order into custom fields + a title/value for the opportunity.
function mapOrder(order = {}) {
  const total = Number(order.total_price || order.current_total_price || 0);
  const number = order.name || (order.order_number ? `#${order.order_number}` : '');
  return {
    total,
    currency: order.currency || 'EUR',
    number,
    custom: {
      shopify_order: number,
      shopify_order_total: total,
      shopify_currency: order.currency || '',
      shopify_financial_status: order.financial_status || '',
    },
  };
}

// Maps a Shopify order (+ webhook topic) to the CRM opportunity status, so ONE
// opportunity per order moves through the pipeline exactly like GoHighLevel:
//   paid / partially_refunded          → 'won'   (revenue captured)
//   refunded / voided / cancelled      → 'lost'  (with a reason)
//   pending / authorised / anything    → 'open'  (still in the pipeline)
// A cancelled order (topic orders/cancelled or a cancelled_at timestamp) always
// wins — a cancellation is terminal regardless of what was paid.
function orderStatus(order = {}, topic = '') {
  const fin = String(order.financial_status || '').toLowerCase();
  const cancelled = topic === 'orders/cancelled' || Boolean(order.cancelled_at);
  if (cancelled) return { status: 'lost', lost_reason: 'Pedido cancelado en Shopify' };
  if (fin === 'refunded' || fin === 'voided') return { status: 'lost', lost_reason: 'Pedido reembolsado en Shopify' };
  if (fin === 'paid' || fin === 'partially_refunded') return { status: 'won', lost_reason: null };
  return { status: 'open', lost_reason: null };
}

module.exports = { verifyHmac, mapCustomer, mapOrder, orderStatus };
