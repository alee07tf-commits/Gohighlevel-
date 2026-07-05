// Conversation AI: answers inbound messages (chat widget, SMS, WhatsApp)
// with the business context and can book appointments directly.
// With ANTHROPIC_API_KEY → Claude decides the reply and optional booking.
// Without it → a helpful scripted assistant that still captures the lead
// and hands off booking via the public calendar link.
const db = require('../db');
const ai = require('./ai');
const automation = require('./automation');

// Free slots for the next 7 days for one calendar (max ~40 slots).
async function availableSlots(calendar, days = 7) {
  const takenTimes = (
    await db.all(
      `SELECT starts_at FROM appointments WHERE calendar_id = ? AND status != 'cancelled' AND starts_at >= now()`,
      [calendar.id]
    )
  ).map((r) => new Date(r.starts_at).getTime());
  const activeDays = JSON.parse(calendar.days || '[1,2,3,4,5]');
  let blocked = [];
  try { blocked = JSON.parse(calendar.blocked_dates || '[]'); } catch { blocked = []; }
  const buffer = Number(calendar.buffer_minutes || 0) * 60000;
  const minNoticeMs = Number(calendar.min_notice_hours ?? 1) * 3_600_000;
  const dur = calendar.duration_minutes * 60000;
  const slots = [];
  const now = new Date();
  for (let d = 0; d < days && slots.length < 40; d++) {
    const day = new Date(now.getTime() + d * 86_400_000);
    if (!activeDays.includes(day.getUTCDay())) continue;
    const date = day.toISOString().slice(0, 10);
    if (blocked.includes(date)) continue;
    for (let m = calendar.start_hour * 60; m + calendar.duration_minutes <= calendar.end_hour * 60; m += calendar.duration_minutes) {
      const h = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const iso = `${date}T${h}:${mm}`;
      const startMs = new Date(iso + ':00Z').getTime();
      if (startMs < now.getTime() + minNoticeMs) continue;
      // Free if no taken appointment overlaps this slot ± buffer.
      const clash = takenTimes.some((tk) => Math.abs(tk - startMs) < dur + buffer);
      if (!clash) slots.push(iso);
      if (slots.length >= 40) break;
    }
  }
  return slots;
}

async function bookSlot(location, calendar, contact, slotIso) {
  const clash = await db.get(
    `SELECT id FROM appointments WHERE calendar_id = ? AND starts_at = ? AND status != 'cancelled'`,
    [calendar.id, `${slotIso}:00`]
  );
  if (clash) return null;
  const ends = new Date(new Date(slotIso + ':00Z').getTime() + calendar.duration_minutes * 60000)
    .toISOString()
    .slice(0, 19);
  const id = await db.insert(
    `INSERT INTO appointments (location_id, calendar_id, contact_id, title, starts_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      location.id,
      calendar.id,
      contact.id,
      `${calendar.name} — ${[contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'lead'} (agendado por IA)`,
      `${slotIso}:00`,
      ends,
    ]
  );
  await automation.logActivity(location.id, contact.id, 'appointment', `🤖 IA agendó "${calendar.name}" para ${slotIso}`);
  await automation.trigger(location.id, 'appointment_booked', contact, { calendar_id: calendar.id });
  return id;
}

function fmtSlot(iso) {
  return new Date(iso + ':00Z').toLocaleString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });
}

// Scripted fallback when no AI key: capture intent + offer concrete slots.
async function scriptedReply(location, calendar, slots, history, inbound) {
  const text = inbound.toLowerCase();
  const wantsBooking = /cita|reserv|agend|hora|book|appointment|dispon/.test(text);
  if (wantsBooking && calendar && slots.length) {
    return {
      reply:
        `¡Claro! Estos son los próximos huecos disponibles para ${calendar.name}:\n` +
        slots.slice(0, 3).map((s, i) => `${i + 1}. ${fmtSlot(s)}`).join('\n') +
        `\nResponde con el número que te venga bien, o reserva tú mismo aquí: /book/${calendar.slug}`,
      book: null,
    };
  }
  const pick = text.match(/^\s*([1-3])\s*$/);
  if (pick && calendar && slots[Number(pick[1]) - 1]) {
    return { reply: null, book: slots[Number(pick[1]) - 1] };
  }
  return {
    reply: `¡Gracias por escribirnos a ${location.name}! Un miembro del equipo te responderá muy pronto.${
      calendar ? ` Si quieres, puedes reservar cita directamente aquí: /book/${calendar.slug}` : ''
    }`,
    book: null,
  };
}

// Main entry: decide (and possibly execute) the AI response for a conversation.
// Returns { reply } — reply already includes booking confirmations.
async function respond({ location, contact, conversationId, inbound }) {
  const calendars = await db.all('SELECT * FROM calendars WHERE location_id = ? ORDER BY id', [location.id]);
  const calendar = calendars[0] || null;
  const slots = calendar ? await availableSlots(calendar) : [];
  const history = (
    await db.all(
      'SELECT direction, body FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 12',
      [conversationId]
    )
  ).reverse();

  const aiCtx = { locationId: location.id, agencyId: location.agency_id };
  let decision;
  if (!(await ai.ready(aiCtx))) {
    decision = await scriptedReply(location, calendar, slots, history, inbound);
  } else {
    const system = `Eres el asistente virtual de "${location.name}"${location.company ? ` (${location.company})` : ''}. Respondes a clientes y leads por chat/WhatsApp en el idioma del cliente (por defecto español): cercano, útil, respuestas CORTAS (1-3 frases, sin markdown).
Datos del negocio: teléfono ${location.phone || 'n/d'}, email ${location.email || 'n/d'}, web ${location.website || 'n/d'}.
${location.ai_agent_prompt ? `Instrucciones del negocio: ${location.ai_agent_prompt}` : ''}
${calendar ? `Puedes AGENDAR CITAS en el calendario "${calendar.name}" (${calendar.duration_minutes} min). Huecos libres (UTC): ${slots.slice(0, 20).join(', ') || 'ninguno'}.` : 'No hay calendario configurado: no ofrezcas citas.'}
Tu objetivo: resolver dudas, cualificar al lead y llevarle a reservar cita. Si el cliente confirma un hueco concreto de la lista, agenda.
Responde SOLO JSON válido: {"reply":"...", "book": "YYYY-MM-DDTHH:MM" | null, "tags": ["..."] opcional}. "book" SOLO si el cliente aceptó claramente ese hueco exacto de la lista.`;
    const convo = history.map((m) => `${m.direction === 'inbound' ? 'CLIENTE' : 'ASISTENTE'}: ${m.body}`).join('\n');
    try {
      const text = await ai.complete(system, `${convo}\nCLIENTE: ${inbound}\n\nJSON:`, 700, aiCtx);
      const start = text.indexOf('{');
      decision = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
    } catch (err) {
      decision = await scriptedReply(location, calendar, slots, history, inbound);
    }
  }

  let reply = decision.reply || '';
  if (decision.book && calendar) {
    const booked = await bookSlot(location, calendar, contact, decision.book);
    reply = booked
      ? `✅ ¡Cita confirmada! ${calendar.name} — ${fmtSlot(decision.book)}. Te esperamos${contact.first_name ? `, ${contact.first_name}` : ''}.`
      : `Vaya, ese hueco se acaba de ocupar 😅 ${slots.filter((s) => s !== decision.book).slice(0, 3).map(fmtSlot).join(' · ')} — ¿te encaja alguno?`;
  }
  for (const tag of decision.tags || []) {
    await db.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING', [
      contact.id,
      String(tag).slice(0, 40),
    ]);
  }
  return { reply: reply || '¡Gracias por tu mensaje! Enseguida te atendemos.' };
}

module.exports = { respond, availableSlots };
