# ⚡ LeadFlow — v1.1

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
npm test         # suite de tests de API (12 tests, corre sobre Postgres en memoria)
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
| **Equipo y ajustes** | Usuarios de agencia (admin/member), perfil de cada sub-cuenta, creación de sub-cuentas. |

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
tests/api.test.js    # 12 tests end-to-end de API (node:test + supertest)
```

- **Mensajería simulada a propósito**: cada email/SMS "enviado" queda registrado en el inbox del contacto. Para producción, conecta Twilio/SendGrid/SMTP dentro de `server/services/messaging.js` sin tocar el resto del código.
- **Variables**: `DATABASE_URL`, `JWT_SECRET`, `PORT` (default 3000), `AUTO_SEED=1` (siembra demo), `PG_POOL_MAX` (default 5).

## Roadmap propuesto (v1.2+)

1. **Proveedores reales**: Twilio (SMS) + SMTP/SendGrid (email) + webhooks entrantes al inbox.
2. **Acciones con espera** en workflows (wait 1 día → seguimiento) con cola/scheduler.
3. **Custom fields** de contacto con UI y uso en formularios/merge fields.
4. **Facturación/pagos** (Stripe) y membresías/cursos.
5. **Reputación**: solicitudes de reseñas Google/Facebook.
6. **White-label por sub-cuenta** (dominio, logo, colores) y permisos por usuario/sub-cuenta.
7. **Reportes** avanzados (conversión por funnel, atribución por fuente).

## Seguridad

- Contraseñas con bcrypt; sesiones JWT de 7 días.
- Todo endpoint de datos exige `Authorization: Bearer` + `X-Location-Id`, validando que la sub-cuenta pertenezca a tu agencia (probado en tests).
- Define `JWT_SECRET` en producción (Vercel → Environment Variables).
