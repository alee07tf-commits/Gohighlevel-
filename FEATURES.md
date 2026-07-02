# LeadFlow vs GoHighLevel — Mapa de funcionalidades y roadmap

> Investigación: julio 2026. Fuentes: gohighlevel.com, listas de features 2026 (getautomized.com, profunnelbuilder.com, centripe.ai, saaswithcass.com), documentación de HighLevel (help.gohighlevel.com, ideas.gohighlevel.com).
>
> Dificultad: 🟢 Fácil (1–3 días) · 🟡 Media (~1–2 semanas) · 🔴 Difícil (varias semanas, a menudo con servicios externos) · 🟣 Muy difícil (nivel producto/ecosistema)

## ✅ Lo que LeadFlow YA tiene (v1.1)

| Área | Funcionalidad | Estado vs GHL |
|---|---|---|
| Multi-tenant | Agencia → sub-cuentas ilimitadas, selector, aislamiento de datos | Núcleo equivalente |
| Equipo | Usuarios admin/member por agencia | Básico (sin permisos granulares) |
| CRM | Contactos: CRUD, búsqueda, tags, notas, timeline, DND, fuente del lead | Núcleo equivalente |
| Oportunidades | Pipelines múltiples, etapas configurables, kanban drag & drop, valores, won/lost | Núcleo equivalente |
| Conversaciones | Inbox unificado por contacto, SMS/email, merge fields, no-leídos, endpoint inbound | ⚠️ Envío **simulado** (falta proveedor real) |
| Calendario | Calendarios de reserva, página pública de auto-agendado, anti-doble-reserva, estados de cita | Básico funcional |
| Marketing | Plantillas email con merge fields, campañas email/SMS segmentadas por tag, log de envíos | ⚠️ Envío simulado |
| Automatizaciones | 5 triggers × 6 acciones, filtros por tag/funnel/calendario/etapa, historial de ejecuciones | Núcleo (sin esperas ni ramas) |
| Funnels | Constructor por bloques (hero/texto/features/form), publicación pública, captura de leads → CRM + automatizaciones, submissions | Básico funcional |
| Formularios | Formulario integrado en funnels con campos configurables y tag | Básico |
| Dashboard | 8 métricas + actividad reciente + próximas citas | Básico |
| Infraestructura | Postgres (Supabase), deploy Vercel, tests API + E2E navegador | — |

## ❌ Lo que FALTA, por prioridad y dificultad

### Nivel 1 — Lo que convierte LeadFlow en usable con clientes reales

| Funcionalidad | Qué hace en GHL | Dificultad | Notas |
|---|---|---|---|
| **Email real (SMTP/SendGrid/Resend)** | Envío real de campañas y automatizaciones (LC Email) | 🟢 | La abstracción `services/messaging.js` ya existe; es conectar el proveedor |
| **SMS real (Twilio)** | Envío/recepción SMS (LC Phone) | 🟡 | API sencilla + webhook inbound; requiere cuenta Twilio y registro A2P |
| **Webhooks entrantes → inbox** | Respuestas de email/SMS llegan a Conversaciones | 🟡 | Endpoint + verificación de firmas |
| **Esperas (wait/delay) en workflows** | Secuencias: "espera 1 día → envía seguimiento" | 🟡 | Cola de acciones programadas + cron (Vercel Cron / Supabase pg_cron) |
| **Ramas if/else en workflows** | Lógica condicional por datos del contacto | 🟡 | Modelo de árbol en vez de lista lineal |
| **Recordatorios de cita** | Email/SMS automático antes de la cita | 🟢 | Trivial una vez exista el scheduler de esperas |
| **Custom fields con UI** | Campos personalizados por sub-cuenta, usables en forms y merge fields | 🟢 | La columna JSON ya existe; falta UI + integración |
| **Importar/exportar CSV de contactos** | Migración de datos | 🟢 | |
| **Tareas (tasks)** | To-dos ligados a contacto/oportunidad con vencimiento | 🟢 | |

### Nivel 2 — Paridad comercial (lo que los clientes esperan ver)

| Funcionalidad | Qué hace en GHL | Dificultad | Notas |
|---|---|---|---|
| **Pagos: Stripe (checkout, links, text-to-pay)** | Cobros, links de pago, suscripciones | 🟡 | Stripe Checkout hace el trabajo pesado |
| **Facturación (invoicing)** | Facturas con estados, recordatorios de cobro | 🟡 | CRUD + PDF + trigger "invoice paid" |
| **Reputación: solicitudes de reseña** | Pide reseñas Google/Facebook tras cita/pago | 🟢 | Es un workflow + landing de reseña; monitoreo de reseñas es 🔴 (APIs de Google) |
| **Constructor drag & drop de páginas** | Editor visual completo estilo ClickFunnels | 🔴 | Nuestro builder por bloques es el 20% que da el 80%; un editor libre es un proyecto grande (alternativa: integrar GrapesJS 🟡) |
| **Plantillas de funnels/emails** | Biblioteca de templates listos | 🟢 | Contenido más que código |
| **Formularios y encuestas standalone** | Form/survey builder embebible fuera de funnels | 🟡 | |
| **Widget de chat web** | Chat embebible que crea contacto + conversación | 🟡 | Script embed + polling |
| **Dominios personalizados por funnel** | funnel del cliente en su propio dominio | 🔴 | En Vercel: API de dominios + verificación DNS por sub-cuenta |
| **Google/Outlook Calendar sync** | Citas sincronizadas en dos direcciones | 🔴 | OAuth + APIs + resolución de conflictos |
| **Round-robin y citas de grupo** | Reparto entre vendedores, clases | 🟡 | |
| **Smart lists / segmentos guardados** | Filtros complejos guardados de contactos | 🟡 | |
| **Permisos granulares y asignación usuario↔sub-cuenta** | Miembros que solo ven ciertas sub-cuentas | 🟡 | |
| **Asignación de leads a usuarios** | Owner por contacto/oportunidad | 🟢 | |

### Nivel 3 — Diferenciadores grandes de GHL

| Funcionalidad | Qué hace en GHL | Dificultad | Notas |
|---|---|---|---|
| **Content AI** (emails, SMS, posts, páginas) | Genera copy dentro de la app | 🟡 | Con la API de Claude es de lo más rentable a implementar |
| **Conversation AI (chatbot que agenda)** | Responde leads 24/7 y agenda citas | 🔴 | LLM + function calling contra calendario; viable con Claude |
| **Reviews AI** | Respuestas automáticas a reseñas | 🟡 | Depende de tener reputación (Nivel 2) |
| **Voice AI (llamadas)** | Atiende llamadas entrantes | 🟣 | Telefonía tiempo real + STT/TTS (Twilio Voice + proveedor de voz) |
| **Social Planner** | Programar posts FB/IG/LinkedIn/TikTok/X/GMB + inbox social | 🔴 | Muchas APIs de terceros, aprobaciones de apps (Meta review, etc.) |
| **Membresías y cursos** | Cursos en video, drip content, certificados | 🔴 | Producto entero: player, progreso, acceso pagado |
| **Comunidades** | Foros/grupos estilo Skool | 🔴 | |
| **Documentos y contratos (e-firma)** | Propuestas con firma electrónica | 🔴 | Validez legal, audit trail (alternativa: integrar Documenso/DocuSign 🟡) |
| **E-commerce store / order bumps / upsells** | Tiendas y embudos de venta con 1-click upsell | 🔴 | |
| **Snapshots** | Clonar una sub-cuenta completa como plantilla | 🟡 | Export/import JSON de todas las entidades; muy valioso para agencias |
| **SaaS mode (rebilling)** | Revender la plataforma con markup automático | 🔴 | Stripe Connect + planes + medición de uso |
| **White-label por agencia** | Logo/dominio/colores propios | 🟡 | Branding por agencia + dominio custom (la parte DNS es 🔴) |
| **Blogs / sitios completos / WordPress** | CMS y hosting | 🔴/🟣 | |
| **App móvil** | iOS/Android white-label | 🟣 | Alternativa: PWA 🟢 |
| **Llamadas, call tracking, voicemail drop** | Números de seguimiento, grabación | 🔴 | Twilio Voice |
| **WhatsApp / FB Messenger / IG DM** | Canales extra en el inbox | 🔴 | WhatsApp Business API es la más viable |
| **API pública + Zapier + webhooks salientes** | Integraciones con 5000+ apps | 🟡 | Webhooks salientes 🟢; app de Zapier publicada 🔴 |
| **Reporting avanzado / atribución / ads** | Informes de Facebook/Google Ads, atribución | 🔴 | APIs de ads + modelo de atribución |
| **Prospecting tool / data enrichment** | Enriquecer leads automáticamente | 🔴 | Depende de proveedores de datos |

## Orden recomendado de implementación

1. **v1.2 — "Envíos reales"** 🟢🟡: SendGrid/Resend + Twilio + webhooks inbound + recordatorios de cita. *Con esto ya puedes operar clientes reales.*
2. **v1.3 — "Automatización seria"** 🟡: waits + if/else + más triggers (pago recibido, cita completada) + plantillas de workflows.
3. **v1.4 — "Dinero"** 🟡: Stripe (links de pago, checkout) + facturas + trigger invoice-paid + reseñas post-pago.
4. **v1.5 — "Agencia pro"** 🟡: snapshots + custom fields UI + CSV import + smart lists + permisos + white-label básico.
5. **v2.0 — "AI"** 🟡🔴: Content AI y Conversation AI con la API de Claude.
