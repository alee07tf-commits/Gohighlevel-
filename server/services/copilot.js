// Empleado IA (AI employee): a global copilot that not only answers but ACTS,
// via Anthropic tool use. Every tool is scoped to the caller's sub-account and
// deliberately low-risk: it can create (tasks, notes, tags, draft campaigns,
// inactive workflows, reports, contacts) and send single messages when the user
// explicitly asks — it can never delete or mass-send anything.
const db = require('../db');
const ai = require('./ai');

// ---- Tool definitions (Anthropic Messages API `tools` format) ----
const TOOLS = [
  {
    name: 'get_stats',
    description: 'Resumen actual de la sub-cuenta: contactos, oportunidades abiertas, valor del pipeline, citas próximas y conversaciones sin leer.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'hot_leads',
    description: 'Los leads más calientes (mayor puntuación de interés) para llamar hoy.',
    input_schema: { type: 'object', properties: { limit: { type: 'integer', description: 'Cuántos (por defecto 5)' } }, additionalProperties: false },
  },
  {
    name: 'search_contacts',
    description: 'Busca contactos por nombre, email o teléfono. Úsalo también para resolver a qué contacto se refiere el usuario.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'create_contact',
    description: 'Crea un contacto nuevo en el CRM.',
    input_schema: {
      type: 'object',
      properties: { first_name: { type: 'string' }, last_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, tag: { type: 'string' } },
      required: ['first_name'], additionalProperties: false,
    },
  },
  {
    name: 'create_task',
    description: 'Crea una tarea para el equipo (opcionalmente ligada a un contacto por email/nombre/teléfono).',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string' }, notes: { type: 'string' }, due_in_days: { type: 'integer' }, contact: { type: 'string', description: 'email, teléfono o nombre del contacto (opcional)' } },
      required: ['title'], additionalProperties: false,
    },
  },
  {
    name: 'add_note',
    description: 'Añade una nota a la ficha de un contacto.',
    input_schema: { type: 'object', properties: { contact: { type: 'string' }, body: { type: 'string' } }, required: ['contact', 'body'], additionalProperties: false },
  },
  {
    name: 'add_tag',
    description: 'Añade una etiqueta a un contacto (puede disparar automatizaciones de tag_added).',
    input_schema: { type: 'object', properties: { contact: { type: 'string' }, tag: { type: 'string' } }, required: ['contact', 'tag'], additionalProperties: false },
  },
  {
    name: 'send_message',
    description: 'Envía UN mensaje (sms, whatsapp o email) a UN contacto. Úsalo solo cuando el usuario pida explícitamente enviar algo.',
    input_schema: {
      type: 'object',
      properties: { contact: { type: 'string' }, channel: { type: 'string', enum: ['sms', 'whatsapp', 'email'] }, body: { type: 'string' }, subject: { type: 'string' } },
      required: ['contact', 'channel', 'body'], additionalProperties: false,
    },
  },
  {
    name: 'draft_campaign',
    description: 'Crea una campaña de marketing EN BORRADOR (nunca la envía; el usuario la revisa y la envía desde Marketing).',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, channel: { type: 'string', enum: ['email', 'sms', 'whatsapp'] }, subject: { type: 'string' }, body: { type: 'string' }, tag_filter: { type: 'string', description: 'Etiqueta de audiencia (vacío = todos)' } },
      required: ['name', 'channel', 'body'], additionalProperties: false,
    },
  },
  {
    name: 'create_workflow',
    description: 'Crea una automatización DESACTIVADA para que el usuario la revise y active. Triggers: contact_created, tag_added, form_submitted, appointment_booked, message_received, invoice_paid, review_received. Acciones: add_tag, remove_tag, send_email, send_sms, send_whatsapp, add_note, create_task, wait, create_opportunity.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        trigger_type: { type: 'string' },
        trigger_tag: { type: 'string', description: 'Solo para tag_added' },
        actions: {
          type: 'array',
          items: { type: 'object', properties: { type: { type: 'string' }, config: { type: 'object' } }, required: ['type'] },
        },
      },
      required: ['name', 'trigger_type', 'actions'], additionalProperties: false,
    },
  },
  {
    name: 'generate_report',
    description: 'Genera el informe white-label de resultados para el cliente (devuelve el enlace público para compartir).',
    input_schema: { type: 'object', properties: { period_days: { type: 'integer', description: '7, 30 o 90 (por defecto 30)' } }, additionalProperties: false },
  },
  {
    name: 'list_appointments',
    description: 'Lista las próximas citas confirmadas.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', description: 'Ventana en días (por defecto 7)' } }, additionalProperties: false },
  },
];

const WF_TRIGGERS = ['contact_created', 'tag_added', 'form_submitted', 'appointment_booked', 'message_received', 'invoice_paid', 'review_received', 'opportunity_stage_changed', 'appointment_status_changed', 'note_added', 'task_completed'];
const WF_ACTIONS = ['add_tag', 'remove_tag', 'send_email', 'send_sms', 'send_whatsapp', 'add_note', 'create_task', 'wait', 'create_opportunity', 'update_field', 'assign_owner', 'notify_user'];

// Resolve a fuzzy contact reference (email > phone > name) within the location.
async function findContact(locationId, query) {
  const q = String(query || '').trim();
  if (!q) return null;
  let c = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND lower(email) = lower(?) AND email != ''`, [locationId, q]);
  if (!c) c = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND phone = ? AND phone != ''`, [locationId, q]);
  if (!c) c = await db.get(
    `SELECT * FROM contacts WHERE location_id = ? AND lower(first_name || ' ' || COALESCE(last_name,'')) LIKE lower(?) ORDER BY id DESC LIMIT 1`,
    [locationId, `%${q}%`]
  );
  return c;
}

const short = (c) => ({ id: c.id, name: `${c.first_name || ''} ${c.last_name || ''}`.trim(), email: c.email || '', phone: c.phone || '', score: c.score || 0 });

// Executes one tool call. Returns { label (for the UI chips), data (for Claude) }.
async function executeTool(name, input = {}, ctx) {
  const { locationId, userId } = ctx;
  switch (name) {
    case 'get_stats': {
      const g = (sql) => db.get(sql, [locationId]);
      const [contacts, opps, pipeline, unread, upcoming] = await Promise.all([
        g('SELECT COUNT(*)::int AS n FROM contacts WHERE location_id = ?'),
        g(`SELECT COUNT(*)::int AS n FROM opportunities WHERE location_id = ? AND status = 'open'`),
        g(`SELECT COALESCE(SUM(value),0)::float AS v FROM opportunities WHERE location_id = ? AND status = 'open'`),
        g('SELECT COUNT(*)::int AS n FROM conversations WHERE location_id = ? AND unread > 0'),
        g(`SELECT COUNT(*)::int AS n FROM appointments WHERE location_id = ? AND starts_at >= now() AND status = 'confirmed'`),
      ]);
      return { label: 'Estadísticas consultadas', data: { contactos: contacts.n, oportunidades_abiertas: opps.n, valor_pipeline: pipeline.v, conversaciones_sin_leer: unread.n, citas_proximas: upcoming.n } };
    }
    case 'hot_leads': {
      const rows = await require('./scoring').hotLeads(locationId, Math.min(Number(input.limit) || 5, 20));
      return { label: 'Leads calientes consultados', data: rows.map(short) };
    }
    case 'search_contacts': {
      const q = `%${String(input.query || '').trim()}%`;
      const rows = await db.all(
        `SELECT * FROM contacts WHERE location_id = ? AND (lower(first_name || ' ' || COALESCE(last_name,'')) LIKE lower(?) OR lower(email) LIKE lower(?) OR phone LIKE ?)
         ORDER BY updated_at DESC LIMIT ?`,
        [locationId, q, q, q, Math.min(Number(input.limit) || 8, 25)]
      );
      return { label: `Búsqueda: "${input.query}"`, data: rows.map(short) };
    }
    case 'create_contact': {
      const id = await db.insert(
        `INSERT INTO contacts (location_id, first_name, last_name, email, phone, source) VALUES (?, ?, ?, ?, ?, 'copilot')`,
        [locationId, String(input.first_name).slice(0, 80), String(input.last_name || '').slice(0, 80), String(input.email || '').slice(0, 160), String(input.phone || '').slice(0, 40)]
      );
      if (input.tag) await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [id, String(input.tag).slice(0, 40)]);
      return { label: `Contacto creado: ${input.first_name}`, data: { ok: true, contact_id: id } };
    }
    case 'create_task': {
      const contact = input.contact ? await findContact(locationId, input.contact) : null;
      const id = await db.insert(
        'INSERT INTO tasks (location_id, contact_id, user_id, title, notes, due_at) VALUES (?, ?, ?, ?, ?, ?)',
        [locationId, contact ? contact.id : null, userId || null, String(input.title).slice(0, 200), String(input.notes || '').slice(0, 1000),
          input.due_in_days ? new Date(Date.now() + Number(input.due_in_days) * 86_400_000).toISOString().slice(0, 19) : null]
      );
      return { label: `Tarea creada: ${input.title}`, data: { ok: true, task_id: id, contacto: contact ? short(contact) : null } };
    }
    case 'add_note': {
      const contact = await findContact(locationId, input.contact);
      if (!contact) return { label: 'Contacto no encontrado', data: { error: `No encuentro el contacto "${input.contact}"` } };
      await db.run('INSERT INTO notes (contact_id, body) VALUES (?, ?)', [contact.id, String(input.body).slice(0, 2000)]);
      return { label: `Nota añadida a ${contact.first_name}`, data: { ok: true, contacto: short(contact) } };
    }
    case 'add_tag': {
      const contact = await findContact(locationId, input.contact);
      if (!contact) return { label: 'Contacto no encontrado', data: { error: `No encuentro el contacto "${input.contact}"` } };
      await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [contact.id, String(input.tag).slice(0, 40)]);
      try { await require('./automation').trigger(locationId, 'tag_added', contact, { tag: input.tag }); } catch { /* best effort */ }
      return { label: `Etiqueta "${input.tag}" → ${contact.first_name}`, data: { ok: true } };
    }
    case 'send_message': {
      const contact = await findContact(locationId, input.contact);
      if (!contact) return { label: 'Contacto no encontrado', data: { error: `No encuentro el contacto "${input.contact}"` } };
      const messaging = require('./messaging');
      const result = await messaging.sendByChannel(input.channel, locationId, contact, { subject: input.subject || '', body: String(input.body) });
      return { label: `${input.channel.toUpperCase()} enviado a ${contact.first_name}`, data: { ok: Boolean(result), simulado: !result || result.simulated !== false } };
    }
    case 'draft_campaign': {
      const channel = ['sms', 'whatsapp'].includes(input.channel) ? input.channel : 'email';
      const id = await db.insert(
        `INSERT INTO campaigns (location_id, name, channel, subject, body, tag_filter, status) VALUES (?, ?, ?, ?, ?, ?, 'draft')`,
        [locationId, String(input.name).slice(0, 120), channel, String(input.subject || '').slice(0, 200), String(input.body).slice(0, 8000), String(input.tag_filter || '').slice(0, 60)]
      );
      return { label: `Campaña en borrador: ${input.name}`, data: { ok: true, campaign_id: id, nota: 'Creada como BORRADOR; se revisa y envía desde Marketing.' } };
    }
    case 'create_workflow': {
      if (!WF_TRIGGERS.includes(input.trigger_type)) return { label: 'Trigger inválido', data: { error: `trigger_type debe ser uno de: ${WF_TRIGGERS.join(', ')}` } };
      const actions = (Array.isArray(input.actions) ? input.actions : []).filter((a) => WF_ACTIONS.includes(a.type));
      if (!actions.length) return { label: 'Acciones inválidas', data: { error: `Ninguna acción válida. Usa: ${WF_ACTIONS.join(', ')}` } };
      const wfId = await db.tx(async (t) => {
        const id = await t.insert(
          'INSERT INTO workflows (location_id, name, trigger_type, trigger_config, active) VALUES (?, ?, ?, ?, 0)',
          [locationId, String(input.name).slice(0, 120), input.trigger_type, JSON.stringify(input.trigger_tag ? { tag: input.trigger_tag } : {})]
        );
        for (let i = 0; i < actions.length; i++) {
          await t.run('INSERT INTO workflow_actions (workflow_id, position, type, config) VALUES (?, ?, ?, ?)', [
            id, i, actions[i].type, JSON.stringify(actions[i].config || {}),
          ]);
        }
        return id;
      });
      return { label: `Automatización creada (pausada): ${input.name}`, data: { ok: true, workflow_id: wfId, nota: 'Creada DESACTIVADA; el usuario la revisa y activa en Automatizaciones.' } };
    }
    case 'generate_report': {
      const days = Math.min(Math.max(Number(input.period_days) || 30, 1), 365);
      const { computeStats } = require('../routes/reports');
      const stats = await computeStats(locationId, days);
      const loc = await db.get('SELECT name FROM locations WHERE id = ?', [locationId]);
      const narrative = await ai.reportNarrative(loc ? loc.name : '', stats, days, { locationId, agencyId: ctx.agencyId });
      const token = require('crypto').randomBytes(12).toString('hex');
      await db.insert('INSERT INTO reports (location_id, token, period_days, narrative, data) VALUES (?, ?, ?, ?, ?)', [
        locationId, token, days, narrative, JSON.stringify(stats),
      ]);
      return { label: `Informe generado (${days} días)`, data: { ok: true, url: `/r/${token}`, stats } };
    }
    case 'list_appointments': {
      const days = Math.min(Number(input.days) || 7, 60);
      const rows = await db.all(
        `SELECT a.title, a.starts_at, c.first_name, c.last_name FROM appointments a
         LEFT JOIN contacts c ON c.id = a.contact_id
         WHERE a.location_id = ? AND a.status = 'confirmed' AND a.starts_at BETWEEN now() AND now() + ?::interval
         ORDER BY a.starts_at LIMIT 25`,
        [locationId, `${days} days`]
      );
      return { label: 'Citas consultadas', data: rows };
    }
    default:
      return { label: `Herramienta desconocida: ${name}`, data: { error: 'unknown tool' } };
  }
}

// ---- Agent loop: Claude ↔ tools until it produces a final answer ----
async function run({ locationId, agencyId, userId, locationName, userName, message, history = [] }) {
  const { apiKey, model } = await ai.resolveAi({ locationId, agencyId });
  if (!apiKey) {
    return {
      configured: false,
      generated_by: 'none',
      actions: [],
      reply: 'Aún no tengo conectada la IA (falta la API key de Anthropic). Pídele al administrador que la añada en Agencia → Servicios de la plataforma → IA, y estaré operativo al momento. 🙂',
    };
  }

  const system = `Eres el Empleado IA de "${locationName}", el asistente operativo del CRM Upcro. Hablas con ${userName || 'el usuario'} en su idioma (por defecto español), con tono cercano, profesional y RESUELTO: usas las herramientas para hacer el trabajo de verdad, no solo para describirlo.
Reglas:
- Usa herramientas siempre que aporten datos reales o ejecuten lo pedido. No inventes datos: si no lo sabes, consúltalo con una herramienta.
- Acciones de escritura: crea campañas SOLO en borrador y automatizaciones SOLO desactivadas (ya lo hacen las herramientas); dilo al usuario para que las revise.
- send_message solo si el usuario pide explícitamente enviar un mensaje, y a UN contacto concreto.
- Nunca borres nada (no tienes herramientas para ello, no lo prometas).
- Respuestas finales: breves, con lo importante, y menciona enlaces/dónde revisar lo creado (ej. "en Marketing → Campañas").
Fecha actual: ${new Date().toISOString().slice(0, 10)}.`;

  const msgs = [];
  for (const m of history.slice(-12)) {
    if (m && m.text) msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: [{ type: 'text', text: String(m.text).slice(0, 4000) }] });
  }
  msgs.push({ role: 'user', content: [{ type: 'text', text: String(message).slice(0, 4000) }] });

  const actions = [];
  const ctx = { locationId, agencyId, userId };

  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2000, system, tools: TOOLS, messages: msgs }),
    });
    if (!res.ok) {
      const err = new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      err.status = 502;
      throw err;
    }
    const data = await res.json();
    msgs.push({ role: 'assistant', content: data.content || [] });

    const toolUses = (data.content || []).filter((b) => b.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || !toolUses.length) {
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      return { configured: true, generated_by: 'claude', actions, reply: text || 'Hecho ✅' };
    }

    const results = [];
    for (const tu of toolUses) {
      let out;
      try {
        out = await executeTool(tu.name, tu.input || {}, ctx);
        if (out.label) actions.push(out.label);
      } catch (err) {
        out = { data: { error: err.message } };
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out.data) });
    }
    msgs.push({ role: 'user', content: results });
  }

  return { configured: true, generated_by: 'claude', actions, reply: 'He ejecutado varias acciones (mira las etiquetas de arriba), pero la petición era muy larga — dime cómo seguimos.' };
}

module.exports = { run, executeTool, findContact, TOOLS };
