// Claude-powered content generation. The API key resolves per context via the
// integrations cascade (location → agency → ANTHROPIC_API_KEY env), so each
// sub-account/agency can bring its own key; callers get a fallback otherwise.
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

// Platform-level quick check (used by the AI status endpoint).
function enabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Resolve the effective AI key/model for a context ({ locationId }/{ agencyId }).
async function resolveAi(ctx) {
  if (!ctx) return { apiKey: process.env.ANTHROPIC_API_KEY || '', model: DEFAULT_MODEL };
  const { config } = await require('./integrations').resolve('ai', ctx);
  return { apiKey: config.api_key || '', model: config.model || DEFAULT_MODEL };
}

// True when AI is configured for this context (per-location, agency or env).
async function ready(ctx) {
  return Boolean((await resolveAi(ctx)).apiKey);
}

async function complete(system, userPrompt, maxTokens = 1024, ctx) {
  const { apiKey, model } = await resolveAi(ctx);
  if (!apiKey) {
    const err = new Error('AI no configurada: añade una API key de Anthropic (por estancia, agencia o ANTHROPIC_API_KEY)');
    err.status = 501;
    throw err;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
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
async function generateCopy({ kind, prompt, business, ctx }) {
  const system = `Eres un copywriter senior de marketing directo para negocios locales. Escribes en el idioma del usuario (por defecto español), con tono cercano y profesional. Usa merge fields {{first_name}} cuando tenga sentido. Responde SOLO con JSON válido, sin markdown.`;
  const spec =
    kind === 'email'
      ? `Devuelve JSON: {"subject": "...", "body": "..."} para un email de marketing.`
      : kind === 'funnel'
        ? `Devuelve JSON: {"headline": "...", "subheadline": "...", "cta": "...", "form_headline": "..."} para una landing page.`
        : `Devuelve JSON: {"body": "..."} para un mensaje corto de ${kind} (máx 300 caracteres).`;
  const text = await complete(system, `Negocio: ${business || 'negocio local'}\nTarea: ${prompt}\n${spec}`, 1024, ctx);
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
async function reportNarrative(locationName, stats, periodDays, ctx) {
  const fallback =
    `En los últimos ${periodDays} días, ${locationName} generó ${stats.new_contacts} contactos nuevos, ` +
    `${stats.form_submissions} formularios recibidos y ${stats.appointments} citas. ` +
    `El pipeline abierto suma $${stats.pipeline_value} y se ganaron $${stats.won_value} en oportunidades cerradas. ` +
    `Se enviaron ${stats.messages_sent} mensajes a clientes y leads.`;
  if (!(await ready(ctx))) return fallback;
  try {
    return await complete(
      'Eres el director de una agencia de marketing escribiendo el resumen mensual para tu cliente. Español, claro, positivo pero honesto, 2 párrafos cortos, sin markdown ni saludos.',
      `Negocio: ${locationName}. Periodo: últimos ${periodDays} días. Datos: ${JSON.stringify(stats)}. Escribe el resumen destacando logros y una recomendación.`,
      1024, ctx
    );
  } catch {
    return fallback;
  }
}


// ---- Claude design: full landing page generation ----
// Returns { name, theme, blocks } using the SAME block schema the visual
// editor understands, so everything the AI produces stays fully editable.
const BLOCK_SCHEMA = `Bloques permitidos (array "blocks", en este orden logico aunque puedes variar):
- {"type":"hero","headline":str,"subheadline":str,"cta":str,"badge":str opcional,"image_keywords":str opcional (2-3 palabras EN INGLES para foto de fondo, ej "dental clinic smile")}
- {"type":"split","headline":str,"body":str,"cta":str opcional,"side":"left"|"right","image_keywords":str (2-3 palabras EN INGLES)} — seccion texto+imagen a dos columnas, alterna side entre splits
- {"type":"image","image_keywords":str (EN INGLES),"caption":str opcional} — foto a ancho completo
- {"type":"text","headline":str,"body":str}
- {"type":"features","headline":str,"items":[{"title":str,"body":str}] (3 items)}
- {"type":"testimonials","headline":str,"items":[{"name":str,"text":str}] (2-3 items)}
- {"type":"pricing","headline":str,"items":[{"name":str,"price":str,"features":[str,...]}] (1-3 planes),"button":str}
- {"type":"faq","headline":str,"items":[{"q":str,"a":str}] (3-4 items)}
- {"type":"cta","headline":str,"body":str,"button":str}
- {"type":"form","headline":str,"button":str,"fields":["first_name","email","phone"],"success_message":str,"tag":str}
En cualquier bloque puedes usar "image" con una URL https directa si el usuario te la da (tiene prioridad sobre image_keywords).
Temas permitidos ("theme"): "clean" | "bold" | "warm" | "elegant".`;

function fallbackFunnelDesign({ business, offer, goal }) {
  const biz = business || 'tu negocio';
  const off = offer || 'nuestra oferta especial';
  // Keyword for the hero/split photos: strip stopwords from the business text.
  const kw = String(biz).toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !['para', 'como', 'este', 'esta'].includes(w)).slice(0, 2).join(' ') || 'business team';
  return {
    name: off.slice(0, 60),
    theme: 'clean',
    blocks: [
      { type: 'hero', headline: off, subheadline: `${biz} — resultados reales, sin complicaciones. Plazas limitadas este mes.`, cta: 'Quiero mi plaza', badge: 'Oferta por tiempo limitado', image_keywords: kw },
      { type: 'split', headline: 'Hecho para ti, sin letra pequeña', body: `En ${biz} nos ocupamos de todo el proceso de principio a fin. Tú solo tienes que dar el primer paso: nosotros nos encargamos del resto y te acompañamos en cada momento.`, side: 'left', image_keywords: kw, cta: 'Quiero saber más' },
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

async function generateFunnelDesign({ business, offer, audience, goal, tone, prompt: brief, locationName, ctx }) {
  if (!(await ready(ctx))) return { ...fallbackFunnelDesign({ business: business || brief, offer: offer || brief, goal }), generated_by: 'template' };
  const system = `Eres un diseñador de landing pages de conversion (CRO) senior para negocios locales. Escribes copy persuasivo en español (o el idioma del usuario), especifico y creible, nunca generico: cifras concretas, beneficios tangibles, urgencia honesta. Respondes SOLO con JSON valido, sin markdown ni comentarios.
${BLOCK_SCHEMA}
Reglas de diseño (siguelas siempre):
- Un "hero" al principio SIEMPRE con "image_keywords" (foto de fondo) y "badge".
- 6-9 bloques en total. Incluye al menos 1-2 bloques "split" (alternando side left/right) para que la pagina respire con imagenes.
- Incluye SIEMPRE exactamente un bloque "form" (al final o tras el hero). Su "tag" debe ser una palabra corta relacionada con la oferta.
- image_keywords: SIEMPRE en ingles, 2-3 palabras concretas del sector (ej: "dentist smile clinic", "gym training woman").
- Elige el "theme" que mejor pegue con el negocio (premium → elegant, energico → bold, hogareño → warm, tecnologico/sanitario → clean).`;
  const prompt = `Diseña una landing page completa.
${brief ? `Descripcion del usuario (PRIORITARIA, sigue esto sobre todo lo demas): ${brief}\n` : ''}Negocio: ${business || locationName || 'negocio local'}
Oferta/servicio a promocionar: ${offer || 'servicio principal'}
Publico objetivo: ${audience || 'clientes locales'}
Objetivo de la pagina: ${goal || 'captar leads'}
Tono: ${tone || 'cercano y profesional'}
Devuelve JSON: {"name": "nombre corto del funnel", "theme": "...", "blocks": [...]}`;
  const text = await complete(system, prompt, 3000, ctx);
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
    return { ...fallbackFunnelDesign({ business: business || brief, offer: offer || brief, goal }), generated_by: 'template-after-parse-error' };
  }
}

// ---- Claude design chat: iterative page editing from natural language ----
// The user talks to the designer ("hazlo más oscuro", "añade una sección de
// precios", "pon una foto del equipo") and gets the updated page back.
// With a real key Claude rewrites the JSON; without one, a small rule engine
// covers the common asks so the chat still works in demo mode.

function fallbackDesignEdit({ blocks, theme, prompt }) {
  const p = String(prompt || '').toLowerCase();
  const out = blocks.map((b) => ({ ...b }));
  let newTheme = theme;
  const did = [];

  if (/(oscur|dark|negro)/.test(p)) { newTheme = 'bold'; did.push('tema oscuro'); }
  else if (/(elegant|premium|lujo)/.test(p)) { newTheme = 'elegant'; did.push('tema elegante'); }
  else if (/(c[aá]lid|warm|acogedor)/.test(p)) { newTheme = 'warm'; did.push('tema cálido'); }
  else if (/(clar|limpio|clean|blanco)/.test(p)) { newTheme = 'clean'; did.push('tema claro'); }

  const kwMatch = p.match(/(?:foto|imagen|photo)[^a-z0-9]*(?:de|del|de la|of)?\s+([a-záéíóúñ ]{3,40})/);
  const kw = kwMatch ? kwMatch[1].trim().split(/\s+/).slice(0, 3).join(' ') : '';
  const has = (type) => out.some((b) => b.type === type);

  const quita = p.match(/(?:quita|elimina|borra|remove)\s+(?:la |el |los |las |seccion(?:es)? de )?([a-záéíóúñ]+)/);
  if (quita) {
    const map = { faq: 'faq', preguntas: 'faq', precios: 'pricing', precio: 'pricing', testimonios: 'testimonials', imagen: 'image', foto: 'image', hero: 'hero' };
    const type = map[quita[1]];
    if (type && has(type)) {
      const idx = out.findIndex((b) => b.type === type);
      out.splice(idx, 1); did.push(`quitada la sección ${quita[1]}`);
    }
  }
  const before = () => Math.max(0, out.findIndex((b) => b.type === 'form'));
  if (/(añade|agrega|pon|mete|add).*(faq|preguntas)/.test(p) && !has('faq')) {
    out.splice(before(), 0, { type: 'faq', headline: 'Preguntas frecuentes', items: [
      { q: '¿Cómo empiezo?', a: 'Déjanos tus datos en el formulario y te contactamos en menos de 24h.' },
      { q: '¿Tiene compromiso?', a: 'No, puedes cancelar cuando quieras.' },
      { q: '¿Cuánto tarda?', a: 'La mayoría de clientes ve resultados en las primeras semanas.' },
    ] });
    did.push('añadida sección de FAQ');
  }
  if (/(añade|agrega|pon|mete|add).*(precio|pricing|planes)/.test(p) && !has('pricing')) {
    out.splice(before(), 0, { type: 'pricing', headline: 'Planes y precios', button: 'Empezar', items: [
      { name: 'Básico', price: '49€/mes', features: ['Lo esencial para empezar', 'Soporte por email'] },
      { name: 'Pro', price: '99€/mes', features: ['Todo lo del Básico', 'Soporte prioritario', 'Resultados más rápidos'] },
    ] });
    did.push('añadida sección de precios');
  }
  if (/(añade|agrega|pon|mete|add).*(testimoni)/.test(p) && !has('testimonials')) {
    out.splice(before(), 0, { type: 'testimonials', headline: 'Lo que dicen nuestros clientes', items: [
      { name: 'María G.', text: 'Trato excelente y resultados mejores de lo que esperaba.' },
      { name: 'Carlos L.', text: 'Profesionales de verdad, cumplieron los plazos.' },
    ] });
    did.push('añadidos testimonios');
  }
  if (/(añade|agrega|pon|mete|add).*(foto|imagen|photo)/.test(p) && kw) {
    const hero = out.find((b) => b.type === 'hero');
    if (/(hero|portada|fondo)/.test(p) && hero) { hero.image_keywords = kw; did.push(`foto de "${kw}" en el hero`); }
    else { out.splice(before(), 0, { type: 'image', image_keywords: kw, caption: '' }); did.push(`añadida imagen de "${kw}"`); }
  }

  return {
    blocks: out,
    theme: newTheme,
    reply: did.length
      ? `Hecho: ${did.join(', ')}. (Modo demo — conecta la IA para ediciones libres de texto y diseño.)`
      : 'En modo demo puedo cambiar el tema (oscuro/elegante/cálido/claro) y añadir/quitar secciones (FAQ, precios, testimonios, fotos). Conecta ANTHROPIC_API_KEY para edición libre total.',
    generated_by: 'rules',
    changed: did.length > 0,
  };
}

async function editFunnelDesign({ blocks, theme, prompt, history = [], locationName, ctx }) {
  if (!(await ready(ctx))) return fallbackDesignEdit({ blocks, theme, prompt });
  const system = `Eres Claude design: un diseñador de landing pages senior que edita una pagina existente conversando con el usuario. Mantienes todo lo que el usuario no pide cambiar (respeta ids, tags y el bloque form salvo orden). Escribes copy persuasivo y especifico en el idioma del usuario. Respondes SOLO JSON valido: {"reply": "resumen corto y cercano de lo que has cambiado (1-2 frases, como un diseñador)", "theme": "...", "blocks": [...]}.
${BLOCK_SCHEMA}
Reglas: conserva SIEMPRE exactamente un bloque "form". Si el usuario pide imagenes, usa "image_keywords" en ingles (o "image" si te da una URL). Si pide algo imposible, explica la alternativa en "reply" y haz lo mas parecido.`;
  const convo = history.slice(-6).map((m) => `${m.role === 'user' ? 'USUARIO' : 'TU'}: ${m.text}`).join('\n');
  const userPrompt = `Negocio: ${locationName || 'negocio local'}
Pagina actual (JSON): {"theme":"${theme}","blocks":${JSON.stringify(blocks)}}
${convo ? `Conversacion previa:\n${convo}\n` : ''}Peticion del usuario: ${prompt}
Devuelve el JSON completo actualizado.`;
  const text = await complete(system, userPrompt, 4000, ctx);
  try {
    const start = text.indexOf('{');
    const parsed = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
    if (!Array.isArray(parsed.blocks) || !parsed.blocks.length) throw new Error('no blocks');
    if (!parsed.blocks.some((b) => b.type === 'form')) parsed.blocks.push(blocks.find((b) => b.type === 'form') || fallbackFunnelDesign({}).blocks.at(-1));
    return {
      blocks: parsed.blocks,
      theme: ['clean', 'bold', 'warm', 'elegant'].includes(parsed.theme) ? parsed.theme : theme,
      reply: parsed.reply || 'Cambios aplicados.',
      generated_by: 'claude',
      changed: true,
    };
  } catch {
    return fallbackDesignEdit({ blocks, theme, prompt });
  }
}

// ---- Workflow AI: generate an automation from a plain-language goal ----
const WF_TRIGGERS = ['contact_created', 'tag_added', 'form_submitted', 'appointment_booked', 'opportunity_stage_changed', 'message_received', 'invoice_paid', 'appointment_status_changed', 'review_received'];
const WF_ACTIONS = ['add_tag', 'remove_tag', 'send_email', 'send_sms', 'send_whatsapp', 'add_note', 'create_opportunity', 'wait', 'branch', 'create_task', 'send_review_request', 'webhook'];

function fallbackWorkflow(goal) {
  return {
    name: (goal || 'Seguimiento automático').slice(0, 60),
    trigger_type: 'contact_created',
    trigger_config: {},
    actions: [
      { type: 'add_tag', config: { tag: 'nuevo' } },
      { type: 'send_email', config: { subject: 'Hola {{first_name}}', body: 'Gracias por tu interés. En breve te contactamos.' } },
      { type: 'wait', config: { amount: 1, unit: 'days' } },
      { type: 'create_task', config: { title: 'Llamar a {{first_name}} (seguimiento)', due_in_days: 0 } },
    ],
    generated_by: 'template',
  };
}

async function generateWorkflow({ goal, business, ctx }) {
  if (!(await ready(ctx))) return fallbackWorkflow(goal);
  const system = `Eres experto en automatización de marketing para negocios locales. Respondes SOLO JSON válido.
Triggers permitidos: ${WF_TRIGGERS.join(', ')}. trigger_config opcional: {"tag":...} para tag_added, {"status":"no_show"|"completed"} para appointment_status_changed.
Acciones permitidas: ${WF_ACTIONS.join(', ')} con configs: add_tag/remove_tag {"tag"}, send_email {"subject","body"}, send_sms/send_whatsapp/add_note {"body"}, wait {"amount",unit:"minutes"|"hours"|"days"}, create_task {"title","due_in_days"}, send_review_request {"channel"}, create_opportunity {"title","value"}, webhook {"url"}.
Usa merge fields {{first_name}} en los textos. 2-6 acciones. Español.`;
  const text = await complete(system, `Negocio: ${business}. Objetivo de la automatización: ${goal}.
Devuelve JSON: {"name":"...","trigger_type":"...","trigger_config":{...},"actions":[{"type":"...","config":{...}}]}`, 1500, ctx);
  try {
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!WF_TRIGGERS.includes(parsed.trigger_type)) throw new Error('bad trigger');
    parsed.actions = (parsed.actions || []).filter((a) => WF_ACTIONS.includes(a.type));
    if (!parsed.actions.length) throw new Error('no actions');
    return { ...parsed, generated_by: 'claude' };
  } catch {
    return fallbackWorkflow(goal);
  }
}

// ---- Reviews AI: suggest a public-quality response to feedback ----
async function suggestReviewReply({ business, rating, comment, contactName, ctx }) {
  const fallback =
    rating >= 4
      ? `¡Mil gracias por tu valoración${contactName ? `, ${contactName}` : ''}! Nos alegra muchísimo que hayas tenido una buena experiencia. ¡Te esperamos pronto!`
      : `Sentimos que tu experiencia no fuera la esperada${contactName ? `, ${contactName}` : ''}. Gracias por contárnoslo: nos ayuda a mejorar. Nos pondremos en contacto contigo para solucionarlo.`;
  if (!(await ready(ctx))) return { reply: fallback, generated_by: 'template' };
  try {
    const reply = await complete(
      `Eres el responsable de ${business}. Redacta una respuesta breve (2-3 frases), empática y profesional a la opinión de un cliente. Español, sin markdown, sin comillas.`,
      `Valoración: ${rating}/5. Comentario: "${comment || '(sin comentario)'}". Cliente: ${contactName || 'anónimo'}.`,
      1024, ctx
    );
    return { reply: reply.trim(), generated_by: 'claude' };
  } catch {
    return { reply: fallback, generated_by: 'template' };
  }
}

module.exports = { enabled, ready, resolveAi, complete, generateCopy, reportNarrative, generateFunnelDesign, editFunnelDesign, generateWorkflow, suggestReviewReply };
