// Claude-powered content generation. Optional: enabled when
// ANTHROPIC_API_KEY is set; callers get a clear error otherwise.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

function enabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function complete(system, userPrompt, maxTokens = 1024) {
  if (!enabled()) {
    const err = new Error('AI no configurada: añade ANTHROPIC_API_KEY en las variables de entorno');
    err.status = 501;
    throw err;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const err = new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    err.status = 502;
    throw err;
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// Returns {subject, body} for emails, {body} for sms/whatsapp.
async function generateCopy({ kind, prompt, business }) {
  const system = `Eres un copywriter senior de marketing directo para negocios locales. Escribes en el idioma del usuario (por defecto español), con tono cercano y profesional. Usa merge fields {{first_name}} cuando tenga sentido. Responde SOLO con JSON válido, sin markdown.`;
  const spec =
    kind === 'email'
      ? `Devuelve JSON: {"subject": "...", "body": "..."} para un email de marketing.`
      : kind === 'funnel'
        ? `Devuelve JSON: {"headline": "...", "subheadline": "...", "cta": "...", "form_headline": "..."} para una landing page.`
        : `Devuelve JSON: {"body": "..."} para un mensaje corto de ${kind} (máx 300 caracteres).`;
  const text = await complete(system, `Negocio: ${business || 'negocio local'}\nTarea: ${prompt}\n${spec}`);
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return { body: text.trim() };
  }
}

// Narrative for the monthly client report; falls back to a template when
// AI is not configured so reports always work.
async function reportNarrative(locationName, stats, periodDays) {
  const fallback =
    `En los últimos ${periodDays} días, ${locationName} generó ${stats.new_contacts} contactos nuevos, ` +
    `${stats.form_submissions} formularios recibidos y ${stats.appointments} citas. ` +
    `El pipeline abierto suma $${stats.pipeline_value} y se ganaron $${stats.won_value} en oportunidades cerradas. ` +
    `Se enviaron ${stats.messages_sent} mensajes a clientes y leads.`;
  if (!enabled()) return fallback;
  try {
    return await complete(
      'Eres el director de una agencia de marketing escribiendo el resumen mensual para tu cliente. Español, claro, positivo pero honesto, 2 párrafos cortos, sin markdown ni saludos.',
      `Negocio: ${locationName}. Periodo: últimos ${periodDays} días. Datos: ${JSON.stringify(stats)}. Escribe el resumen destacando logros y una recomendación.`
    );
  } catch {
    return fallback;
  }
}


// ---- Claude design: full landing page generation ----
// Returns { name, theme, blocks } using the SAME block schema the visual
// editor understands, so everything the AI produces stays fully editable.
const BLOCK_SCHEMA = `Bloques permitidos (array "blocks", en este orden logico aunque puedes variar):
- {"type":"hero","headline":str,"subheadline":str,"cta":str}
- {"type":"text","headline":str,"body":str}
- {"type":"features","headline":str,"items":[{"title":str,"body":str}] (3 items)}
- {"type":"testimonials","headline":str,"items":[{"name":str,"text":str}] (2-3 items)}
- {"type":"pricing","headline":str,"items":[{"name":str,"price":str,"features":[str,...]}] (1-3 planes),"button":str}
- {"type":"faq","headline":str,"items":[{"q":str,"a":str}] (3-4 items)}
- {"type":"cta","headline":str,"body":str,"button":str}
- {"type":"form","headline":str,"button":str,"fields":["first_name","email","phone"],"success_message":str,"tag":str}
Temas permitidos ("theme"): "clean" | "bold" | "warm" | "elegant".`;

function fallbackFunnelDesign({ business, offer, goal }) {
  const biz = business || 'tu negocio';
  const off = offer || 'nuestra oferta especial';
  return {
    name: off.slice(0, 60),
    theme: 'clean',
    blocks: [
      { type: 'hero', headline: off, subheadline: `${biz} — resultados reales, sin complicaciones. Plazas limitadas este mes.`, cta: 'Quiero mi plaza' },
      { type: 'features', headline: 'Por qué elegirnos', items: [
        { title: 'Atencion cercana', body: 'Te acompañamos en cada paso, sin letra pequeña.' },
        { title: 'Resultados visibles', body: 'Nuestros clientes notan la diferencia desde la primera visita.' },
        { title: 'Garantia total', body: 'Si no quedas satisfecho, lo arreglamos o te devolvemos el dinero.' },
      ] },
      { type: 'testimonials', headline: 'Lo que dicen nuestros clientes', items: [
        { name: 'María G.', text: 'Trato excelente y resultados mejores de lo que esperaba. Repetiré seguro.' },
        { name: 'Carlos L.', text: 'Profesionales de verdad. Me explicaron todo y cumplieron los plazos.' },
      ] },
      { type: 'faq', headline: 'Preguntas frecuentes', items: [
        { q: '¿Cuánto cuesta?', a: 'Depende de tu caso — déjanos tus datos y te preparamos un presupuesto sin compromiso.' },
        { q: '¿Cuánto tarda?', a: 'La mayoría de nuestros clientes ven resultados en las primeras semanas.' },
        { q: '¿Hay permanencia?', a: 'No. Puedes cancelar cuando quieras, sin penalizaciones.' },
      ] },
      { type: 'form', headline: goal === 'booking' ? 'Reserva tu cita ahora' : 'Déjanos tus datos y te llamamos', button: 'Enviar', fields: ['first_name', 'email', 'phone'], success_message: '¡Recibido! Te contactamos en menos de 24h.', tag: 'lead' },
    ],
  };
}

async function generateFunnelDesign({ business, offer, audience, goal, tone, locationName }) {
  if (!enabled()) return { ...fallbackFunnelDesign({ business, offer, goal }), generated_by: 'template' };
  const system = `Eres un diseñador de landing pages de conversion (CRO) senior para negocios locales. Escribes copy persuasivo en español (o el idioma del usuario), especifico y creible, nunca generico. Respondes SOLO con JSON valido, sin markdown ni comentarios.
${BLOCK_SCHEMA}
Reglas: incluye SIEMPRE exactamente un bloque "form" (al final o tras el hero), un "hero" al principio, y 4-7 bloques en total. El "tag" del form debe ser una palabra corta relacionada con la oferta. Elige el "theme" que mejor pegue con el negocio.`;
  const prompt = `Diseña una landing page completa.
Negocio: ${business || locationName || 'negocio local'}
Oferta/servicio a promocionar: ${offer || 'servicio principal'}
Publico objetivo: ${audience || 'clientes locales'}
Objetivo de la pagina: ${goal || 'captar leads'}
Tono: ${tone || 'cercano y profesional'}
Devuelve JSON: {"name": "nombre corto del funnel", "theme": "...", "blocks": [...]}`;
  const text = await complete(system, prompt, 3000);
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed.blocks) || !parsed.blocks.length) throw new Error('no blocks');
    if (!parsed.blocks.some((b) => b.type === 'form')) {
      parsed.blocks.push(fallbackFunnelDesign({ business, offer, goal }).blocks.at(-1));
    }
    return { ...parsed, generated_by: 'claude' };
  } catch {
    return { ...fallbackFunnelDesign({ business, offer, goal }), generated_by: 'template-after-parse-error' };
  }
}

module.exports = { enabled, complete, generateCopy, reportNarrative, generateFunnelDesign };
