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

module.exports = { enabled, complete, generateCopy, reportNarrative };
