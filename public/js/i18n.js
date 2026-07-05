// Lightweight bilingual (ES/EN) helper for the SPA chrome. The app is authored
// in Spanish; `t(es, en)` returns the string for the active language. Language
// is stored in localStorage and defaults to the browser's, falling back to ES.
// Kept dependency-free (no imports) so any module can use it without cycles.

const SUPPORTED = ['es', 'en'];

let lang = localStorage.getItem('lf_lang');
if (!SUPPORTED.includes(lang)) {
  const nav = (navigator.language || 'es').slice(0, 2).toLowerCase();
  lang = nav === 'en' ? 'en' : 'es';
}

export function getLang() {
  return lang;
}

export function setLang(next) {
  lang = next === 'en' ? 'en' : 'es';
  localStorage.setItem('lf_lang', lang);
  return lang;
}

// t('Contactos', 'Contacts') → the string for the active language. If the
// English variant is omitted, the Spanish one is used for both.
export function t(es, en) {
  return lang === 'en' ? (en ?? es) : es;
}

// BCP-47 locale for Intl formatters (dates, currency).
export function locale() {
  return lang === 'en' ? 'en-US' : 'es-ES';
}
