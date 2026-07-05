# Upcro vs GoHighLevel — Mapa de funcionalidades y roadmap

> Actualizado tras **v1.7** — feature-complete: núcleo de las 14 categorías de GHL cubierto. Basado en investigación propia + listado detallado de las ~14 categorías de GHL (2026).
>
> Dificultad de lo pendiente: 🟢 Fácil (1–3 días) · 🟡 Media (~1–2 semanas) · 🔴 Difícil (semanas + servicios externos) · 🟣 Muy difícil (nivel producto)

## ✅ Implementado en Upcro (v1.7)

| Categoría GHL | Lo que ya tenemos |
|---|---|
| **1. CRM y contactos** | Contactos ilimitados, tags, notas, timeline unificado, lead source tracking automático (funnel/booking/whatsapp-inbound/manual), import/export CSV, **custom fields con UI y merge fields**, **owner/responsable por contacto**, DND, **lead scoring** con alerta de leads calientes. |
| **2. Pipelines** | Pipelines ilimitados, etapas custom, kanban drag & drop, valores, won/lost, movimientos disparan automatizaciones. |
| **3. Automatizaciones** | 9 triggers (+**reseña recibida**), 12 acciones (+**webhook saliente** hacia Zapier/Make/lo que sea), **Workflow AI** (describe el objetivo y la IA monta el workflow), 8 triggers (contacto, tag, formulario, cita, etapa, mensaje recibido, **factura pagada**, **estado de cita**), 11 acciones (tags, email, SMS, WhatsApp, nota, oportunidad, **espera temporal**, **rama if/else**, **crear tarea**, **pedir reseña**), historial de ejecuciones, **biblioteca de 6 recetas instalables con un clic** (nurture, no-show recovery, reseña post-cita, agradecimiento post-pago, lead que responde, reactivación 30 días). |
| **4. Comunicación multicanal** | Inbox unificado email + SMS + WhatsApp + **chat web** por contacto, **widget de chat embebible** en cualquier web (1 línea de código), webhook entrante de Twilio, merge fields, campañas segmentadas por tag (email/SMS/WhatsApp) con **envío programado**, recordatorios de cita automáticos, **missed-call text-back**. Conectores listos: **Resend/SendGrid (email), Twilio (SMS/WhatsApp)** — se activan con las claves. |
| **5. Funnels y formularios** | Builder por bloques (hero/texto/features/form), publicación pública, captura → CRM + tag + automatizaciones, submissions, **branding por sub-cuenta (color + logo)** en todas las páginas públicas. |
| **6. Calendarios** | Calendarios de reserva, página pública de auto-agendado, anti-doble-reserva, **reservas grupales (capacidad por hueco)**, estados (completada/no-show → disparan workflows), recordatorios pre-cita programados. |
| **7. IA** | **Content AI** (redacción con Claude) + **Claude design** (landing pages completas generadas y editables) + **Conversation AI**: chatbot en widget/SMS/WhatsApp que responde con el contexto del negocio y **agenda citas solo**, con pausa por conversación (human takeover) y modo guiado sin clave. |
| **8. Reputación** | **Reviews AI** (respuestas sugeridas con IA), trigger al recibir reseña, solicitudes de reseña por SMS/WhatsApp/email (manual + acción de workflow), **página pública con filtro**: 4-5★ → tu link de Google, 1-3★ → feedback privado, métricas (nota media, promotores, detractores). |
| **11. Pagos** | **Presupuestos con aceptación online**, **facturas recurrentes mensuales automáticas**, **facturas con líneas**, link de pago público con marca, **text-to-pay** (envío por SMS/WhatsApp/email), **Stripe Checkout** (conector listo, con modo prueba integrado), webhook de confirmación, marcar cobrada manual, trigger `invoice_paid`, métricas cobrado/pendiente. |
| **12. Agencia/SaaS** | Sub-cuentas ilimitadas, selector, aislamiento total, equipo admin/member con **permisos por sub-cuenta**, **Snapshots** (exportar/importar configuración completa de sub-cuenta en JSON). |
| **13. Reporting** | Dashboard con 8 métricas + **informe white-label para el cliente final** con narrativa (compartible por link/email) + **briefing diario** automático por email (citas, leads calientes, tareas vencidas). |
| **14. Extras** | **PWA instalable** (manifest, service worker, offline, iconos, accesos directos), webhooks entrantes, endpoint de salud, tareas con vencimiento. |

## ❌ Pendiente, por dificultad

**🟢/🟡 Detalles menores**
- Triggers extra: "Payment Failed", "Form Partially Completed"
- A/B testing y validación de emails · cupones/mini-tienda
- Round-robin entre miembros del equipo
- Conector Google Sheets · editor visual de ramas if/else
- Drip multi-paso dentro de campañas (hoy se hace con workflows + waits)

**🔴 Difícil**
- Builder drag & drop libre estilo ClickFunnels (alternativa: GrapesJS 🟡) + order bumps/upsells
- Sincronización Google/Outlook Calendar bidireccional
- Dominios custom por sub-cuenta/funnel
- Monitoreo/respuesta de reseñas de Google Business Profile (API GBP) y publicación en GBP
- Social Planner (FB/IG/LinkedIn/TikTok/X/GMB) — aprobaciones de apps de terceros
- Cursos/membresías/comunidades
- Documentos y contratos con e-firma
- SaaS mode con rebilling (Stripe Connect) y provisioning
- Call tracking con grabación, voicemail drops, RCS
- Reporting de atribución + Google/Facebook Ads + rendimiento por agente
- WhatsApp Business API directa (hoy vía Twilio)

**🟣 Muy difícil**
- Voice AI (llamadas en tiempo real con STT/TTS)
- App móvil nativa white-label iOS/Android (la PWA cubre el 80% del caso)
- Marketplace de apps

## Conectores (estado actual)

| Conector | Variable(s) | Estado |
|---|---|---|
| Email real | `RESEND_API_KEY` (o `SENDGRID_API_KEY`) + `MAIL_FROM` | Listo — falta clave |
| SMS | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` | Listo — falta clave |
| WhatsApp | + `TWILIO_WHATSAPP_FROM` | Listo — falta clave |
| Pagos | `STRIPE_SECRET_KEY` (webhook: `/api/webhooks/stripe`) | Listo — falta clave |
| IA (Content AI) | `ANTHROPIC_API_KEY` | Listo — falta clave |
| Inbound SMS/WA | webhook Twilio → `/api/webhooks/twilio/<locationId>` | Listo |

Todo funciona en modo simulado sin claves (registrado en el inbox), y cambia a envío real al añadir cada clave en Vercel.

## Roadmap sugerido

1. **Conectar claves reales** (Resend + Twilio + Stripe + Claude) — 0 código, solo configuración.
2. **v1.4**: smart lists, drip sequences, trigger links + QR, duplicados, estimates, chat widget.
3. **v1.5**: Conversation AI (chatbot que agenda) + Reviews AI — el diferenciador grande.
4. **v2.0**: SaaS mode con rebilling (Stripe Connect) para revender Upcro como producto propio.
