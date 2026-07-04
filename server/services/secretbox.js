// Symmetric encryption for integration credentials at rest. AES-256-GCM with a
// key derived (scrypt) from the app secret, so provider keys (Stripe, Twilio…)
// are never stored in plaintext. Format: "v1:<iv>:<tag>:<ciphertext>" (hex).
const crypto = require('crypto');
const { JWT_SECRET } = require('../auth');

const KEY = crypto.scryptSync(process.env.APP_SECRET || JWT_SECRET, 'leadflow-secrets-v1', 32);

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const plaintext = JSON.stringify(obj ?? {});
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(str) {
  if (!str || typeof str !== 'string' || !str.startsWith('v1:')) return {};
  try {
    const [, ivHex, tagHex, dataHex] = str.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch {
    return {};
  }
}

// Shows a credential exists without leaking it: keeps last 4 chars.
function mask(value) {
  if (!value) return '';
  const s = String(value);
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
}

module.exports = { encrypt, decrypt, mask };
