# ⚡ LeadFlow — v1.0

Plataforma todo-en-uno de CRM y marketing para agencias, estilo **GoHighLevel**: multi-tenant (agencia → sub-cuentas de clientes), CRM, pipelines, calendarios con reservas públicas, inbox unificado, email marketing, automatizaciones y constructor de funnels con captura de leads.

Auto-hospedada, sin dependencias externas (SQLite embebido) y sin build step: `npm install && npm start` y listo.

## Inicio rápido

```bash
npm install
npm run seed     # (opcional) datos de demo — login: demo@leadflow.app / demo123
npm start        # abre http://localhost:3000
```

- **App de administración**: `http://localhost:3000` (crea tu agencia en "Create an account")
- **Funnel público de demo**: `http://localhost:3000/f/teeth-whitening/home`
- **Widget de reservas de demo**: `http://localhost:3000/book/free-consult`

```bash
npm test         # suite de tests de API (12 tests)
```

## Módulos incluidos (paridad núcleo con GoHighLevel)

| Módulo | Qué hace |
|---|---|
| **Multi-tenant** | Una agencia con N sub-cuentas (clientes). Selector de sub-cuenta en la barra superior; todos los datos están aislados por sub-cuenta y por agencia. |
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
server/
  index.js           # Express, rutas API + páginas públicas + SPA estática
  db.js              # SQLite (better-sqlite3), esquema completo
  auth.js            # JWT + aislamiento por agencia/sub-cuenta (X-Location-Id)
  seed.js            # datos de demo
  routes/            # auth, locations, contacts, pipelines, calendars,
                     # conversations, marketing, workflows, funnels, dashboard, public
  services/
    messaging.js     # abstracción de proveedor (hoy simulado; enchufa Twilio/SMTP aquí)
    automation.js    # motor de workflows (triggers → acciones)
public/              # SPA vanilla JS sin build (hash routing, ES modules)
tests/api.test.js    # 12 tests end-to-end de API (node:test + supertest)
```

- **Stack**: Node.js + Express 5 + better-sqlite3 + JWT. Frontend sin framework ni build.
- **Mensajería simulada a propósito**: cada email/SMS "enviado" queda registrado en el inbox del contacto. Para producción, conecta Twilio/SendGrid/SMTP dentro de `server/services/messaging.js` sin tocar el resto del código.
- **Config**: `PORT` (default 3000), `DB_PATH` (default `data/leadflow.db`), `JWT_SECRET` (¡cámbialo en producción!).

## Roadmap propuesto (v1.1+)

1. **Proveedores reales**: Twilio (SMS) + SMTP/SendGrid (email) + webhooks entrantes al inbox.
2. **Acciones con espera** en workflows (wait 1 día → seguimiento) con cola/scheduler.
3. **Custom fields** de contacto con UI y uso en formularios/merge fields.
4. **Facturación/pagos** (Stripe) y membresías/cursos.
5. **Reputación**: solicitudes de reseñas Google/Facebook.
6. **White-label por sub-cuenta** (dominio, logo, colores) y permisos por usuario/sub-cuenta.
7. **Reportes** avanzados (conversión por funnel, atribución por fuente).
8. Migración opcional a Postgres para despliegues grandes.

## Seguridad

- Contraseñas con bcrypt; sesiones JWT de 7 días.
- Todo endpoint de datos exige `Authorization: Bearer` + `X-Location-Id`, validando que la sub-cuenta pertenezca a tu agencia (probado en tests).
- Define `JWT_SECRET` en producción y sirve detrás de HTTPS.
