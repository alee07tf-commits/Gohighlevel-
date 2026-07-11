# Upcro — Estado del proyecto (archivo de memoria)

> Documento vivo. Resume qué es el proyecto, qué está hecho, cómo está montado, qué
> falta y las trampas conocidas. Sirve para retomar el trabajo sin perder contexto
> tras reinicios de contenedor o cambios de sesión.
> **Última actualización:** 2026-07-05

---

## 1. Qué es

**Upcro** — el software es un clon de **GoHighLevel (GHL)**. La marca es **Upcro**, que es a la vez:
(1) el nombre del **software/plataforma**, y (2) la **cuenta de agencia** del usuario (alee07tf@gmail.com), porque
como agencia también presta los servicios (SMS/WhatsApp/Email/IA gestionados) a sus clientes.
Objetivo: paridad total con GHL módulo a módulo + un marketplace de integraciones nativas, más un modelo SaaS (la agencia Upcro revende sub-cuentas a sus clientes).

Idioma del producto: **español primero** (con EN vía i18n). El usuario habla español.

---

## 2. Arquitectura y stack

- **Backend:** Node + **Express 5**. Entry: `server/index.js`. Entry de Vercel: `api/index.js` (envuelve el Express).
- **BD:** Postgres vía `pg` **o** **PGlite** embebido (si no hay `DATABASE_URL`). Capa en `server/db.js`:
  - Reescribe placeholders `?` → `$n`.
  - Helpers: `db.all / db.get / db.run / db.insert` (`insert` añade `RETURNING id`) / `db.tx`.
  - **Versionado de esquema:** `SCHEMA_VERSION` en `server/db.js` (**actualmente 26**). Migraciones idempotentes (`ALTER/CREATE ... IF NOT EXISTS`). **Las tablas se crean solas al arrancar** — no hace falta SQL manual.
- **Multi-tenant recursivo:** `agencies.parent_agency_id`; agencia efectiva por header `X-Agency-Id`; todo scoped por `req.user.agency_id` / `req.location.id`.
- **Auth:** JWT (`requireAuth`), `requireLocation` (header `X-Location-Id`). Secreto en `JWT_SECRET` (con fallback de dev inseguro).
- **Frontend:** SPA en **JS vanilla**. Router por hash en `public/js/app.js`; una función `render*` por vista en `public/js/views/*.js`. Utilidades en `ui.js` (esc/openModal/closeOverlay/formData/toast/fmtDate/fmtMoney/fullName/initials/icon), `api.js` (api/state), `i18n.js` (`t('es','en')`).
- **Tests:** `node:test` + `supertest`. Archivos `tests/vNN.test.js`. **Cada archivo nuevo debe añadirse al script `test` de `package.json`.** Actualmente **198 tests, todos verdes.** SCHEMA_VERSION = **29**.

---

## 0. Novedades (features añadidas tras la paridad base)

- **Claude design con prompt libre** (`ai.js generateFunnelDesign` + `funnels.js`): el usuario describe la landing en lenguaje natural y la IA genera bloques editables. Endpoint `/api/ai/funnel` acepta `prompt`.
- **Centro de notificaciones (campana 🔔)**: tabla `notifications`, `services/notifications.js` (`notify`, `notifyLocationTeam`), `routes/notifications.js`, campana en topbar de `app.js`. Emite en: tarea asignada, assign_owner, notify_user, nuevo lead por formulario.
- **Cupones / descuentos**: tabla `coupons`, `services/coupons.js` (lookup/discountFor/redeem), `routes/coupons.js`, gestor en vista Pagos + `coupon_code` en alta de factura.
- **Documentos y Contratos con e-firma**: tabla `documents`, `routes/documents.js`, página pública `/sign/:token` (lienzo de firma) en `public.js`, vista `documents.js` (nav Crecimiento). Prefijo `/sign` añadido en `index.js`.
- **Launch-readiness**: `middleware/security.js` (cabeceras + rate limiter sin deps), aplicado global y en login/register/forgot/reset. Recuperar contraseña: tabla `password_resets`, `/api/auth/forgot` + `/reset`, vistas `renderForgot`/`renderReset` (#/forgot, #/reset/:token). Legal RGPD: `/legal/privacidad|terminos|cookies` en public.js + banner de cookies en `index.html` (env `COMPANY_NAME`/`COMPANY_EMAIL`).
- **Encuestas (Surveys)**: tablas `surveys` + `survey_responses`, `routes/surveys.js`, página pública `/s/:slug` con lógica condicional en `public.js`, vista `surveys.js` (nav Crecimiento). Mapeo de preguntas a nombre/email/teléfono → captura lead.

SCHEMA_VERSION = **35**. Tests = **224**. Prefijos públicos en index.js: …`/sign`, `/legal`, `/s`.

Añadido después: **email builder visual** (drag-and-drop, `public/js/email-builder.js`, columna `email_templates.design`) · **automations builder visual** (flujo drag-and-drop de pasos en `automations.js`) · **cursos con quiz/drip/certificados** (`lessons.quiz/drip_days`, `courses.certificate`, `course_enrollments`, endpoints quiz + `/courses/:id/certificate`) · **Comunidad** (`community_posts`/`community_comments`, `routes/community.js`, `views/community.js`) · **permisos granulares por módulo** (`users.permissions`, enforcement en `requireAuth` vía `MODULE_BY_BASE`, UI en Ajustes).

### Pendiente real (todo lo "sin claves" ya está hecho)
- **Necesita claves/servicios externos:** sync Google/Outlook Calendar bidireccional, reseñas Google Business Profile, Social Planner, reporting Google/FB Ads, Google Sheets, call tracking / Voice AI, WhatsApp Business API directa, dominios custom.
- **Producto puro que aún NO está:** A/B testing de emails, round-robin de asignación, order bumps/upsells en checkout, **builder web drag-and-drop libre** (el usuario lo aparcó), app móvil nativa (la PWA cubre ~80%).
- El builder web drag-and-drop libre está DESCARTADO por el usuario de momento.

---

## 3. Módulos (paridad con GHL) — TODOS al 100%

Sub-cuenta (menú cliente):
1. **Contactos** — bulk actions, filtros avanzados, empresas, DND, campos custom, quick actions.
2. **Conversaciones** — filtros, asignación, snippets, sugerencia IA.
3. **Oportunidades / Pipelines** — owner, source, lost_reason, filtros.
4. **Automatizaciones / Workflows** — triggers (note_added, task_completed…) + acciones (update_field, assign_owner, set_dnd, enroll_workflow, notify_user).
5. **Calendario** — buffer, min-notice, blocked dates.
6. **Marketing** — campañas email/SMS, stats de apertura/click.
7. **Formularios** — campos custom, requeridos, notificación por email.
8. **Tareas** — asignación, filtros mine/overdue.
9. **Reputación** — solicitudes de reseña en bulk.
10. **Pagos** — catálogo de productos, facturas con descuento/impuesto, checkout.
11. **Funnels / Sites** — SEO por página, head/body code custom.
12. **Membresías / Training** — lecciones agrupadas en módulos/secciones.
13. **Panel / Dashboard** — pipeline abierto, leads calientes (scoring), actividad, informe white-label del cliente.
14. **Informes / Analytics** — atribución por fuente con % reserva y % cierre, ingresos/pipeline por canal.
15. **Prospecting** (extra, GHL no lo tiene) — búsqueda Google Places/Serper + detección de anuncios activos en Meta Ad Library.

Nivel agencia:
- **Ajustes (Settings)** — perfil sub-cuenta, integraciones por sub-cuenta con **herencia** (sub-cuenta → agencia → servidor, secretos cifrados), Conversation AI + widget, campos/valores custom, **Snapshots** (crear/aplicar/exportar/importar/default), equipo + acceso por sub-cuenta.
- **Agencia / SaaS** — overview (MRR, revenue), tabla de sub-cuentas (wallet + uso mensual), **servicios centrales gestionados**, **planes SaaS** con features + **rebilling por canal**, signup self-serve white-label.
- **Marketplace de integraciones + Developers (API/Webhooks)**.

---

## 4. Capa de integraciones (el gran diferenciador)

Dos tipos, como GHL:
- **Servicios gestionados** (la agencia los configura UNA vez y el cliente los usa con CERO setup, sin token): **SMS, WhatsApp, Email, IA**. Se activan según el **plan** que elige el cliente; el cliente solo configura la superficie (p. ej. el prompt de IA), el backend ya está conectado centralmente.
- **Marketplace BYO-account** (el cliente conecta su propia cuenta: Google, Stripe, Shopify, Calendly, Meta…). Estos no requieren plan-gating.

Detalles técnicos:
- Catálogo de **34 apps**, 3 tipos de auth (`oauth` / `apikey` / `builtin`). Archivos: `server/services/apps.js` (CATALOG + CATEGORIES + MANAGED + `managedStatus`), `server/routes/apps.js` (marketplace, connect OAuth, callback, manual, delete).
- **Entitlements por plan** (`FEATURE_KEYS`), OAuth con `state` firmado HMAC, `webhook_token` por conexión.
- **Verificación de firma de webhooks (HMAC-SHA256):** Shopify (base64), Calendly (`t=,v1=` hex), Stripe (`t=,v1=` hex sobre `<t>.<rawBody>`). `req.rawBody` capturado con `express.json({ verify })`.
- **Motor de sincronización saliente** (`server/services/appsync.js`): evento CRM → llamada a API del proveedor con token guardado. Cableado desde `automation.trigger`. Handlers: `appointment_booked → [google, zoom]`, `contact_created → [hubspot]`.
- **Receptores entrantes** (`server/routes/public.js`): `POST /inbound/:token`, `GET/POST /meta/webhook`, `POST /shopify/webhook`, `POST /calendly/:token`, pixel de apertura `GET /e/o/:token`, `GET /unsub/:token`.

### Lógica de integraciones profundizada (últimos commits de esta sesión)
- **Shopify — ciclo de vida del pedido** (`server/services/shopify.js` + `public.js`): UNA oportunidad por pedido que avanza por el pipeline según estado. `shopify.orderStatus(order, topic)`: `paid|partially_refunded → won`, `refunded|voided|cancelado → lost` (con `lost_reason`), resto → `open`. `upsertOrderOpportunity()` hace match por título+source estable (no duplica). Antes cada webhook creaba una oportunidad nueva (bug).
- **Stripe — dunning** (`server/routes/webhooks.js`): `invoice.payment_failed` → suscripción `past_due`; un `invoice.paid` posterior la restaura a `active`.
- **Rebilling de IA** (`server/services/agent.js` + `billing.js`): cada respuesta real de Claude llama `billing.recordUsage(loc, 'ai', 1)` → descuenta del wallet con el multiplicador del plan. Antes SMS/WhatsApp/email se cobraban pero la IA no (el multiplicador "IA ×" del plan estaba muerto).

Tests correspondientes: **v51** (Shopify lifecycle), **v52** (Stripe dunning), **v53** (rebilling IA).

### Rebilling / wallet (cómo gana dinero la agencia)
- `server/services/billing.js`: `recordUsage(loc, category, qty)` mide y descuenta del wallet con markup del plan. `BASE_COSTS = { sms:0.08, whatsapp:0.05, email:0.001, ai:0.02 }` (EUR). `topUp`, `monthlyUsage`, `getWallet`.
- Metering cableado en `messaging.js` (email/sms/whatsapp) y ahora `agent.js` (ai).

---

## 5. Estado de despliegue (Vercel) — ⚠️ IMPORTANTE

- **Repo GitHub:** `alee07tf-commits/Gohighlevel-`.
- **Rama de trabajo (desarrollo):** `claude/gohighlevel-clone-platform-3grqlv`.
- **Rama de producción de Vercel:** `main`. Se fusionó todo el trabajo a `main` (merge commit `8c3e55a` + trigger `08e283f`).
- **URL producción:** `leadflow-zeta.vercel.app`. Vercel reescribe TODO a `/api` (ver `vercel.json`), Express sirve estáticos + SPA fallback a `index.html`.
- `vercel.json`: rewrite `/(.*) → /api`, región `fra1`, función `api/index.js` (maxDuration 30, memory 1024, `includeFiles` de PGlite WASM), cron diario `/api/cron/tick`.

### Problema abierto de despliegue
- La web live estuvo sirviendo un build **intermedio antiguo (v1.10)** porque Vercel no desplegaba los commits nuevos. Se forzó merge a `main` + commit de disparo.
- **Sospecha nº1:** la "Production Branch" en Vercel podría no ser `main` (revisar Settings → Git). Si un preview funciona pero la URL principal no se actualiza, es esto.

### Persistencia de datos — ⚠️ PENDIENTE (bloqueante para producción)
- Si **NO** hay `DATABASE_URL` → usa PGlite en memoria (efímero en serverless) → **aviso rojo en el login** ("La base de datos no es persistente…") y las cuentas no se guardan. (Este aviso es una feature intencional, no un bug.)
- **Para que persista:** poner en Vercel (Settings → Environment Variables, marcar Production+Preview+Development):
  - `DATABASE_URL` = cadena de **Supabase** — usar el **Transaction pooler (puerto 6543)**, NO el directo (5432), por serverless.
  - `JWT_SECRET` = secreto largo aleatorio. (Se generó uno en la sesión; regenerar con `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.)
- SSL de Supabase lo maneja `db.js` solo (`ssl: { rejectUnauthorized: false }` si no es localhost).
- El usuario ya tenía un proyecto Supabase; la "contraseña de la base de datos" (distinta de la de su cuenta) puede resetearse en Supabase → Settings → Database → Reset database password. **No hace falta ejecutar SQL manual: las tablas se crean solas.**

---

## 6. Qué falta para "software perfecto" (roadmap)

### 🔴 Bloque A — Para que funcione de verdad
1. **Persistencia**: `DATABASE_URL` + `JWT_SECRET` en Vercel (en curso).
2. **Conectar APIs reales** (todo va en "simulado" hasta tener claves): Twilio, Email (Resend + dominio verificado), Anthropic, Stripe.
3. **Dominio propio** + deliverability email (SPF/DKIM) para no caer en spam.

### 🟠 Bloque B — Para venderlo con seguridad y legalidad (se puede hacer SIN claves del usuario)
4. **Seguridad**: NO hay rate limiting, ni protección de fuerza bruta en login, ni cabeceras (helmet). Añadir.
5. **Auth completo**: NO hay recuperar contraseña ni verificación de email. Añadir.
6. **Legal (RGPD, España)**: NO hay Privacidad, Términos ni aviso de cookies. Añadir.

### 🟢 Bloque C — Pulido pro (opcional)
7. Monitorización de errores (Sentry) + logs.
8. Permisos granulares por módulo (hoy: admin/miembro + acceso por sub-cuenta).
9. Backups automáticos.
10. Onboarding guiado.

**Orden recomendado:** A(persistencia) → B(seguridad+auth+legal, lo puede hacer Claude ya) → A(APIs reales, cuando haya claves) → dominio propio.

---

## 7. Claves que necesita el usuario (para pasar de simulado a real)

- **Urgente (persistencia):** `DATABASE_URL` (Supabase pooler 6543) + `JWT_SECRET`.
- **Gestionados:** `TWILIO_*` (Account SID, Auth Token, from number, whatsapp from), `RESEND_API_KEY` + `MAIL_FROM` (+ dominio verificado), `ANTHROPIC_API_KEY`.
- **Pagos:** `STRIPE` secret key + `STRIPE_WEBHOOK_SECRET`.
- **Prospecting:** `GOOGLE_PLACES_API_KEY` (o `SERPER_API_KEY`) + `META_AD_LIBRARY_TOKEN`.
- **Webhooks de integraciones:** `SHOPIFY_API_SECRET`, `CALENDLY_WEBHOOK_SIGNING_KEY`, `META_VERIFY_TOKEN`.
- **OAuth marketplace:** client id/secret por app (Google, Meta, etc.).

---

## 8. Trampas conocidas (para no repetir errores)

- **Rollback de contenedor:** el disco local se ha revertido a snapshots antiguos varias veces (archivos "desaparecen" aunque los commits estén). **La fuente de verdad es origin.** Recuperar con `git fetch origin <rama> && git reset --hard origin/<rama>` (no destructivo: todo está pusheado).
- **`crypto` global es Web Crypto** (sin `randomBytes`). En archivos que lo necesiten: `const crypto = require('crypto')` al principio.
- **Backticks en comentarios SQL** dentro de template literals rompen el JS. Evitarlos.
- **Servidor en background flaky:** a veces falla el primer arranque (ECONNREFUSED); reintentar en otro puerto con `run_in_background: true` funciona.
- **Placeholders:** escribir SQL con `?`; `db.js` los convierte a `$n`.
- **Booking devuelve 201**, no 200.
- **Al crear tests:** añadirlos al script `test` de `package.json` o no se ejecutan.
- **Verificación en navegador:** playwright-core con Chromium en `/opt/pw-browsers/…`; auth vía localStorage `lf_token`.
- **Identidad de modelo:** no incluir el identificador del modelo en commits/PR/código.

---

## 9. Comandos útiles

```bash
# Tests completos
npm test

# Arranque local (PGlite si no hay DATABASE_URL)
npm start   # o: node server/index.js

# Seed de datos demo
npm run seed

# Generar JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Login demo: `demo@upcro.app` / `demo123`.

## 10. Sesión Claude design v2 (última)
- **Prospección ELIMINADA por decisión del usuario** (vista/ruta/servicio/nav/permisos/proveedor places/tests). No reintroducir.
- **Claude design v2**: chat conversacional en el builder de funnels (POST `/api/ai/design`, con `history`; `ai.editFunnelDesign` con IA real o `fallbackDesignEdit` por reglas sin clave). Bloques nuevos `split` e `image` + hero con foto de fondo (`image_keywords` → loremflickr sin API key, o `image` URL propia) + CSS de landings mejorado. Preview en vivo real de borradores: `/api/funnels/:id/pages/:pageId/preview` (usa `funnelPageHtml` exportado de public.js).
- Producción Vercel: proyecto `gohighlevel` (URL `gohighlevel-git-main-alee07tf-commits-projects.vercel.app`), Supabase conectado (Session pooler 5432, pool max=1 por instancia serverless), Deployment Protection OFF. Health: `{"ok":true,"database":"postgres","persistent":true}`.
- Tests: **229 en verde** (v64 nuevo). SCHEMA_VERSION sigue en 36.

## 11. Empleado IA (copiloto global)
- `server/services/copilot.js`: 12 herramientas seguras scoped a sub-cuenta (stats, hot_leads, search/create contact, task, note, tag, send_message 1-a-1, draft_campaign SIEMPRE borrador, create_workflow SIEMPRE inactiva, generate_report, list_appointments). SIN herramientas de borrado. Loop tool-use Anthropic (máx 6 turnos), clave por cascada, `configured:false` amable sin clave.
- Ruta `POST /api/copilot` (+rebilling ai por ejecución). Frontend: FAB ✨ + panel en `app.js` (`setupCopilot`), historial en `window.__copilotHistory`, chips de acciones. CSS `.copilot-*`.
- Tests v65 con fetch stub del round-trip tool_use. **235 tests en verde.**
- OJO: las claves puestas en la UI (Agencia→Servicios→IA) solo aplican a ESA agencia; la cuenta de diagnóstico live31606@x.com es otra agencia y siempre verá simulado salvo que haya ANTHROPIC_API_KEY en el env de Vercel.

## 12. Constructor visual propio (Diseño Pro) — prioridad del usuario
- REGLA PERMANENTE del usuario: **móvil primero** — todo lo nuevo debe funcionar muy bien en móvil.
- Modo `html` por página (schema **37**: funnel_pages.mode/html_raw/css_raw). Render público en public.js (rama html de funnelPageHtml): wrap SEO + custom values + script que cablea `<form data-lead>` a /api/public/pages/:id/submit.
- Editor visual embebido: GrapesJS 0.21.13 + preset-webpage por CDN (loadOnce en funnels.js), overlay .ve-shell, bloques Upcro personalizados. Guardar → PUT page mode html.
- IA potenciador: `ai.generateLandingHtml`/`editLandingHtml` (marcadores ===CSS===/===HTML===, fallback plantilla); rutas `/api/ai/landing-html` y `/api/ai/design` (mode-aware). 'Rediseñar' del builder usa landing-html.
- 'Volver a bloques' conserva html guardado. Tests v66. **241 tests.**
- ANTHROPIC_API_KEY del usuario VALIDADA (sk-ant-…44dtMwAA, no está en el repo) — pendiente que la ponga en Vercel y redeploy; el Empleado IA en prod aún respondía configured:false con la cuenta diagnóstico.
