# ⚡ LeadFlow — v1.2

Plataforma todo-en-uno de CRM y marketing para agencias, estilo **GoHighLevel**: multi-tenant (agencia → sub-cuentas de clientes), CRM, pipelines, calendarios con reservas públicas, inbox unificado, email marketing, automatizaciones y constructor de funnels con captura de leads.

**Stack**: Node.js + Express 5 + **Postgres** (Supabase en producción, PGlite embebido en local) + SPA JavaScript sin build step. Pensada para desplegarse con **GitHub + Vercel + Supabase**.

## Inicio rápido (local)

```bash
npm install
npm run seed     # (opcional) datos de demo — login: demo@leadflow.app / demo123
npm start        # abre http://localhost:3000
```

Sin configurar nada usa un Postgres embebido (PGlite) guardado en `data/`. Con la variable `DATABASE_URL` usa tu Postgres real (Supabase).

- **App de administración**: `http://localhost:3000`
- **Funnel público de demo**: `http://localhost:3000/f/teeth-whitening/home`
- **Widget de reservas de demo**: `http://localhost:3000/book/free-consult`

```bash
npm test         # suite de tests de API (21 tests, corre sobre Postgres en memoria)
```

## 🚀 Desplegar en Vercel + Supabase (paso a paso)

### 1. Supabase (base de datos persistente)
1. Crea un proyecto en [supabase.com](https://supabase.com) (plan free sirve).
2. Ve a **Project Settings → Database → Connection string** y copia la URI del **Transaction pooler** (puerto `6543`), algo como:
   `postgresql://postgres.xxxx:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
3. Sustituye `[PASSWORD]` por la contraseña de tu base de datos.

No hace falta crear tablas: el servidor ejecuta el esquema (`CREATE TABLE IF NOT EXISTS …`) automáticamente al arrancar.

### 2. Vercel (hosting)
1. En [vercel.com](https://vercel.com) → **Add New → Project** → importa este repositorio de GitHub.
2. Framework preset: **Other** (no hace falta build command ni output directory).
3. En **Environment Variables** añade:
   - `DATABASE_URL` = la URI del pooler de Supabase del paso 1
   - `JWT_SECRET` = una cadena larga aleatoria (p. ej. `openssl rand -hex 32`)
   - (opcional) `AUTO_SEED=1` la primera vez si quieres la agencia demo precargada; quítala después.
4. Deploy. Tu app queda en `https://<proyecto>.vercel.app`.

> Nota: si despliegas **sin** `DATABASE_URL`, la app funciona igualmente en "modo demo" con una base de datos efímera en `/tmp` que se reinicia en cada arranque en frío. Para datos reales, configura Supabase.

### 3. GitHub (CI del código)
Cada push a la rama conectada redespliega automáticamente en Vercel. La rama de producción se configura en **Vercel → Settings → Git → Production Branch**.

## Módulos incluidos (paridad núcleo con GoHighLevel)

| Módulo | Qué hace |
|---|---|
| **Multi-tenant** | Una agencia con N sub-cuentas (clientes). Selector de sub-cuenta en la barra superior; todos los datos aislados por sub-cuenta y agencia. |
| **Contactos (CRM)** | CRUD, búsqueda, tags, notas, timeline de actividad, DND, fuente del lead (funnel/booking/manual). |
| **Opportunities** | Pipelines con etapas configurables, tablero kanban con drag & drop, valor de pipeline, won/lost. |
| **Conversaciones** | Inbox unificado por contacto (SMS/email simulados), envío con merge fields, no-leídos, endpoint para simular mensajes entrantes (stand-in de webhooks Twilio/Mailgun). |
| **Calendario** | Calendarios de reserva con duración/horario, página pública de auto-agendado (`/book/<slug>`), anti-doble-reserva, citas con estados. |
| **Marketing** | Plantillas de email con merge fields (`{{first_name}}`…), campañas email/SMS segmentadas por tag, log de destinatarios. |
| **Automatizaciones** | Workflows *WHEN → THEN*: triggers (contacto creado, tag añadido, formulario enviado, cita reservada, cambio de etapa) y acciones (añadir/quitar tag, enviar email/SMS, nota, crear oportunidad), con historial de ejecuciones. |
| **Sites & Funnels** | Constructor de páginas por bloques (hero, texto, features, formulario), publicación en `/f/<funnel>/<página>`, captura de leads que crea/actualiza el contacto, lo etiqueta y dispara automatizaciones. |
| **Dashboard** | Métricas: contactos, valor de pipeline, revenue ganado, citas próximas, conversaciones sin leer, submissions. |
| **Equipo y ajustes** | Usuarios de agencia (admin/member), perfil de cada sub-cuenta, creación de sub-cuentas, panel de estado de integraciones. |
| **Envíos reales (v1.2)** | Email vía Resend/SendGrid, SMS y WhatsApp vía Twilio, con fallback simulado sin claves. Webhook de entrada `/api/webhooks/twilio/:locationId` alimenta el inbox. |
| **Scheduler (v1.2)** | Acción "wait" en workflows (secuencias de seguimiento) y recordatorios de cita automáticos. Corre con cron de Vercel, pinger externo o lazy tick con el tráfico. |
| **Lead scoring (v1.2)** | Puntos por comportamiento (formularios, mensajes, citas, oportunidades) y tarjeta "🔥 Leads calientes" en el dashboard. |
| **Informe del cliente (v1.2)** | Informe white-label con link público (`/r/<token>`), narrativa escrita por IA (o plantilla), envío por email al cliente. |
| **Content AI (v1.2)** | Botón "✨ Generar con IA" en campañas: redacta emails/SMS/WhatsApp con Claude (`ANTHROPIC_API_KEY`). |
| **CSV (v1.2)** | Importación/exportación de contactos con deduplicación (sin disparar automatizaciones en masa). |
| **Plantillas + alta automática (v1.8)** | Biblioteca de snapshots a nivel agencia: guarda la config de una sub-cuenta como plantilla reutilizable y marca una por defecto. Al crear una sub-cuenta nueva se carga la plantilla automáticamente (pipelines, workflows, funnels, calendarios, plantillas, campos) y se siembran sus **Valores del negocio** (`{{custom_values.business_name}}`…) — lista para trabajar en segundos. |

## Arquitectura

```
api/index.js         # entrypoint serverless de Vercel (envuelve la app Express)
vercel.json          # rewrites: todas las rutas → la función
server/
  index.js           # Express, rutas API + páginas públicas + SPA estática
  db.js              # capa Postgres: pg (DATABASE_URL) o PGlite embebido; esquema auto-creado
  auth.js            # JWT + aislamiento por agencia/sub-cuenta (X-Location-Id)
  demo-seed.js       # datos de demo reutilizables (CLI y auto-seed)
  routes/            # auth, locations, contacts, pipelines, calendars,
                     # conversations, marketing, workflows, funnels, dashboard, public
  services/
    messaging.js     # abstracción de proveedor (hoy simulado; enchufa Twilio/SMTP aquí)
    automation.js    # motor de workflows (triggers → acciones)
public/              # SPA vanilla JS sin build (hash routing, ES modules)
  services/         # providers (Resend/SendGrid/Twilio), messaging, automation,
                     # scheduler, scoring, ai (Claude)
tests/               # 21 tests end-to-end de API (node:test + supertest)
```

- **Canales con fallback**: sin claves, email/SMS/WhatsApp funcionan en modo simulado (registrados en el inbox). Añade las variables de `.env.example` para activarlos de verdad — sin tocar código. El estado de cada canal se ve en **Settings → Integraciones**.
- **Variables**: ver `.env.example` (DATABASE_URL, JWT_SECRET, RESEND_API_KEY, TWILIO_*, ANTHROPIC_API_KEY, CRON_SECRET…).
- **Scheduler**: las esperas de workflows y los recordatorios los procesa `GET /api/cron/tick` (cron de Vercel cada hora incluido; para más precisión usa un pinger cada 5 min, p. ej. cron-job.org). Además cualquier request procesa jobs pendientes (lazy tick).

## Roadmap propuesto (v1.3+)

1. **Ramas if/else** en workflows + más triggers (pago recibido, cita completada).
2. **Pagos** (Stripe: links de pago, checkout) + facturación.
3. **Custom fields** de contacto con UI y uso en formularios/merge fields.
4. **Snapshots** (clonar sub-cuenta como plantilla) + white-label por agencia.
5. **Reputación**: solicitudes de reseñas Google/Facebook.
6. **Conversation AI**: chatbot que responde y agenda citas (Claude + function calling).
7. **Reportes** avanzados (conversión por funnel, atribución por fuente).

## Seguridad

- Contraseñas con bcrypt; sesiones JWT de 7 días.
- Todo endpoint de datos exige `Authorization: Bearer` + `X-Location-Id`, validando que la sub-cuenta pertenezca a tu agencia (probado en tests).
- Define `JWT_SECRET` en producción (Vercel → Environment Variables).
