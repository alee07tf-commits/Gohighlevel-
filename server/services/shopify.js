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

module.exports = { verifyHmac, mapCustomer, mapOrder };
