# Upcro — Estrategia de negocio (archivo de memoria)

> Documento vivo. Recoge el modelo de negocio detrás de la plataforma, tal como lo ha
> definido el fundador (alee07tf@gmail.com), más el análisis estratégico trabajado en sesión.
> Complementa a `ESTADO_PROYECTO.md` (que cubre el estado técnico del producto).
> **Última actualización:** 2026-07-10 (añadidos precios, estudio de mercado y evolución del servicio)

## Contexto del fundador (condiciona toda la estrategia)

- **Solo founder**: la capacidad es el recurso escaso. Techo realista: 6–8 clientes de
  opción B (10–15 h/mes cada uno) + ~2 implementaciones completas al mes (2–4 semanas c/u).
- **Mercado inicial: España** (EUR, RGPD como argumento).
- **Cliente objetivo línea 1**: negocios con **1.500–5.000 €/mes de inversión publicitaria**.
- **Experiencia previa**: freelance trabajando con agencias y sus clientes (no venta directa
  a cliente final). Implicaciones: (a) la venta directa es un músculo nuevo a desarrollar;
  (b) su red de agencias es el canal de distribución natural del plan revendedor de la línea 2.

---

## 1. Qué es Upcro (como negocio)

**Upcro** es a la vez la marca del software (plataforma todo-en-uno de CRM y marketing,
paridad con GoHighLevel, español-primero) y la agencia del fundador, que presta servicios
sobre su propio software. El negocio tiene **dos líneas** con secuencia deliberada:
la línea 1 (agencia) va primero y financia/valida; la línea 2 (SaaS puro) se lanza
cuando el producto esté pulido.

**Posicionamiento de mercado:** nunca presentarse como "clon de GoHighLevel".
Upcro es *la plataforma de automatización de ventas en español, con WhatsApp en el centro,
manejable desde el móvil*. Se compite donde GHL es débil: mercado hispanohablante,
WhatsApp como canal principal (no SMS), precio/simplicidad, RGPD nativo, y app móvil
(la de GHL es notoriamente limitada).

---

## 2. Línea 1 — Upcro como agencia (servicios sobre software propio)

**Premisa de venta:** *"Ya estás captando leads pero se te están escapando. Invirtiendo
lo mismo, obtendrás más leads y más cualificados. Te enseñamos a captar más, a tener todo
tu negocio digital en una sola plataforma, a dar un servicio al cliente espectacular,
a reforzar tu autoridad de marca, y a retener esos leads evitando la fuga."*

**Requisito de cualificación (doble):**
1. Negocios que **ya captan leads online con campañas publicitarias activas**
   (tienen presupuesto, hábito de invertir, y un dolor medible: leads que se enfrían).
2. **Ticket medio que haga la garantía matemáticamente alcanzable** (ver 2.2). En la
   práctica esto empuja a verticales de ticket alto: clínicas, estética, inmobiliaria,
   servicios profesionales, reformas. La garantía elige el nicho, y lo elige bien.

**Mensaje inatacable:** prometer el compuesto — *más citas/ventas por euro invertido* —
en vez de la doble promesa "más leads Y más cualificados" (que a veces se contradicen:
cualificar más reduce volumen).

### 2.1 Opción A — Instalación + formación + gestión de plataforma

- Upcro instala el software, hace el setup básico y entrega formación de uso.
- Cuota mensual solo por la **gestión de la plataforma** (mantenimiento, soporte).
  El cliente opera su marketing él mismo.
- **Mes 1 gestionado como demo de resultados:** el primer mes el equipo de Upcro maneja
  las campañas y monta el primer setup para demostrar resultados. A partir de ahí la
  operación es responsabilidad del cliente, que puede dejar la plataforma cuando quiera
  o contratar al equipo de marketing (pasar a la opción B).
- **Sin garantía** más allá de ese primer mes.

**Lectura estratégica:** el mes 1 gestionado resuelve el riesgo clásico del cliente
autogestionado que infrautiliza, no ve resultados y se va culpando al software. Además
crea el embudo natural A → B: cuando en el mes 2–3 sus resultados bajen respecto al
mes 1 (porque él no es el equipo de Upcro), la conclusión no es "el software no funciona"
sino "necesito contratar al equipo". **Táctica:** medir deliberadamente esa brecha
("mes 1 con nosotros: X citas; este mes: Y") y mostrarla en el informe mensual
white-label que la plataforma ya genera.

### 2.2 Opción B — Full service con garantía

- Plataforma adaptada al negocio + el equipo de marketing de Upcro la gestiona
  activamente para mejorar captación y retención de leads.
- **Garantía permanente:** si el cliente **no recupera su inversión publicitaria** en el
  mes (ingresos atribuidos ≥ gasto en ads), el mes siguiente **no se cobra el fee de
  gestión de agencia**. La garantía cubre SOLO el fee de gestión — la plataforma y el
  consumo (rebilling) se cobran siempre, manteniendo un suelo de ingresos.

**Diseño de la garantía (decisiones tomadas):**
- La promesa se mide sobre el número que le importa al cliente (su inversión en ads,
  el número grande), pero la exposición de Upcro se limita a su propio fee. Riesgo
  acotado, promesa ambiciosa.
- **El árbitro es la propia plataforma:** atribución por fuente + oportunidades ganadas
  con valor + informes white-label. Ninguna agencia normal puede demostrar su garantía
  con datos del propio sistema del cliente; Upcro sí.
- **Venderla como suelo, no como objetivo:** ROAS 1 es en realidad un mal mes (el cliente
  aún pagó fees). Narrativa: "nuestro objetivo es multiplicar tu inversión; la garantía
  existe para que el peor mes posible no te cueste mi gestión".

**Riesgos a cerrar por contrato (pendiente):**
- Hazard inverso: al cliente le puede convenir NO marcar ventas como ganadas para
  disparar la garantía. Mitigación: obligación contractual de registrar en el CRM las
  ventas de leads generados + revisión mensual sobre el informe; ideal cuando el cobro
  pasa por la plataforma (Stripe), donde la venta se registra sola.
- Definir métrica exacta, línea base y ventana de medición en el contrato.

### 2.3 La implementación como producto (sin tarifas)

> Los precios se deciden fuera de este documento (cambian constantemente y se
> ajustarán con estudios de mercado). Aquí solo queda CÓMO se estructura la oferta.

**La implementación NO es un "setup" — es un proyecto, productizado en 5 módulos**
(cada uno con instalación + estrategia de marketing alrededor):

| Módulo | Qué incluye |
|---|---|
| Fundación | Migración de datos, plataforma adaptada, formación |
| Captación | Funnels, formularios, conexión de campañas |
| Retención | Automatizaciones de seguimiento, recordatorios, secuencias |
| Autoridad | Reputación/reseñas, informes, presencia de marca |
| Recuperación | Reactivación de base de datos, clientes dormidos |

Principios de pricing acordados (sin cifras): la implementación se cobra como proyecto
(rango de mercado de implementaciones CRM/automatización, no como "setup" barato); el fee
de gestión de la opción B se liga a la inversión publicitaria con un mínimo; la cuota de
plataforma se factura separada y NUNCA la cubre la garantía (suelo de MRR); programa de
"clientes fundadores" con precio reducido a cambio de casos de éxito documentados.

**Oportunidad a investigar — Kit Digital:** subvenciones estatales de hasta 6.000 € para
digitalización de empresas de 3–9 empleados. Si Upcro se acredita como **agente
digitalizador**, el Estado paga la implementación al cliente ("te cuesta cero").
Verificar vigencia del programa en 2026 y requisitos de acreditación.

### 2.4 Evolución del servicio: de implementación a sistema de crecimiento

- **Fase inicial (ahora): simple.** Los 5 módulos con estrategias sólidas pero
  estandarizadas — suficiente para cumplir la garantía y demostrar resultados.
- **Fase madura: cada módulo se convierte en un playbook "best-in-class"** con nombre
  propio: la mejor estrategia de email marketing, la mejor estrategia publicitaria,
  las mejores landings, recuperación de carritos, mejora de LTV, etc.
- Esto permite: (1) **subir precio con justificación** — implementación premium a
  7.000–10.000 € cuando los playbooks tengan resultados probados; (2) **construir IP**:
  cada playbook perfeccionado en la línea 1 → snapshot/plantilla de la plataforma →
  onboarding de la línea 2 → lección del curso → contenido de comunidad. *El trabajo de
  agencia de hoy es el producto de mañana — nada se hace dos veces*; (3) **especializar
  la contratación**: se ficha al especialista del playbook con más demanda, no generalistas.
- **Nota de segmentos**: "recuperación de carritos" y "LTV" son playbooks de e-commerce
  (la integración Shopify ya existe); "citas, show-rate, ticket alto" son playbooks de
  negocio local de servicios. Dos clientes distintos — el vertical de arranque decidirá
  qué playbooks se perfeccionan primero.

---

## 3. Línea 2 — Venta del software como SaaS (cuando esté pulido)

**Público:** negocios digitales — agencias, freelancers, autónomos digitales, gente que
maneja clientes o tiene un negocio online.

**Promesa central:** *"Maneja tu negocio digital desde el móvil"* — experiencia app
(la PWA existente, eventualmente empaquetada para stores).

**La oferta completa es un combo, no solo software:**
1. **Plataforma** mobile-first.
2. **Curso completo** en el módulo de formación: cómo usar la plataforma al 100%.
3. **Comunidad de emprendedores digitales** que la utilizan (módulo de comunidad).

### 3.1 Por qué el combo curso + comunidad es estratégico

- **Ataca el churn** (el asesino del SaaS en este segmento): el curso convierte el
  onboarding en camino guiado; la comunidad crea pertenencia — dejas el software y
  *también* dejas al grupo. Membresía, no herramienta.
- **Dogfooding perfecto — decirlo en voz alta:** el curso corre sobre el propio módulo
  de membresías y la comunidad sobre el módulo de comunidad. "Esto que estás usando
  está montado con Upcro" es la demo más creíble posible.
- **Deflecta soporte:** la comunidad hace que los usuarios se respondan entre ellos
  (crítico en un segmento de ticket bajo que demanda mucho soporte). Los veteranos que
  ayudan son candidatos a afiliados/revendedores. Además es radar de producto.
- **Justifica precio:** "software + curso + comunidad" permite cobrar más y reencuadra
  la comparación (ya no solo contra CRMs, sino contra combos herramienta+formación).

### 3.2 Condiciones para que la promesa móvil sea real

- "Desde el móvil" es una promesa de experiencia: push cuando entra un lead, responder
  WhatsApp desde la app, mover oportunidades con el pulgar, enviar link de pago sin
  abrir el portátil. **Las notificaciones push son el corazón** — un CRM móvil sin push
  es la misma fuga de leads que se dice resolver.
- Criterio de "pulido" para lanzar esta línea: **los 5 flujos que un freelance hace a
  diario, ejecutables completos desde el móvil con push** — no "perfección general"
  (meta que nunca llega).
- En iOS la instalación de PWA tiene fricción; valorar wrapper TWA / presencia en
  stores para la legitimidad de "búscanos en la App Store".

### 3.3 El segmento: trampa y premio

- **Trampa:** freelancers/autónomos = ticket bajo, sensibilidad al precio, churn alto,
  soporte desproporcionado. Solo funciona con venta 100% self-serve (ya construida),
  onboarding automático (snapshots/plantillas por tipo de negocio) y soporte asíncrono
  (curso + comunidad).
- **Premio escondido:** "gente que maneja clientes" (agencias, freelancers con cartera)
  no son usuarios, son **distribuidores**: cada agencia trae N sub-cuentas. Fue el motor
  de GoHighLevel y la arquitectura multi-tenant white-label ya lo soporta. Dentro de la
  línea 2 hay dos planes muy distintos: autónomo autogestionado vs **agencia
  revendedora** — el segundo es donde está la escala.
- **Rebilling sigue trabajando:** aunque el plan sea barato, cada usuario consume
  WhatsApp/email/IA gestionados con margen. Un plan de 30–50 €/mes + consumo rinde más
  de lo que aparenta.

### 3.4 Avisos sobre curso y comunidad

- **Arranque en frío:** una comunidad de 12 miembros sin actividad resta ("esto está
  muerto"). Los primeros meses la actividad la genera Upcro: contenido semanal, retos,
  destacar wins. Miembros fundadores = clientes de la línea 1 + primeros betas.
  No anunciarla como beneficio estrella hasta que tenga pulso propio.
- **El curso es producto vivo:** cada mejora de plataforma desactualiza lecciones.
  Mejor muchas lecciones cortas y modulares (regrabables una a una) que masterclasses
  largas, + un módulo de "novedades" que hace de changelog con marketing incorporado.

---

## 4. Cómo encajan las dos líneas (el sistema)

- **Línea 1 (ahora):** caja con fees altos, casos de éxito con números reales,
  endurecimiento del producto con uso real. Cada cliente de la opción B es un
  laboratorio de qué automatizaciones/plantillas funcionan por vertical.
- **Línea 2 (después):** convierte lo aprendido en producto escalable. Los snapshots
  creados sirviendo a la línea 1 = plantillas de onboarding de la línea 2. Los casos
  de éxito de la línea 1 = el marketing de la línea 2.
- **Sin canibalización:** línea 1 vende "te lo hacemos" a negocios locales de ticket
  alto que hacen campañas; línea 2 vende "hazlo tú desde el móvil" a nativos digitales.
  Comprador, precio y mensaje distintos.
- **Puentes:** cliente SaaS que crece → contrata gestión (2→1); freelance/agencia de la
  línea 2 que revende sub-cuentas → red de distribución sin coste de venta.

**Capas de ingreso** (arquitectura ya construida):
1. Fees de servicio (línea 1: setup + gestión mensual).
2. Suscripción de plataforma (ambas líneas; nunca cubierta por la garantía).
3. **Margen de rebilling** sobre consumo de SMS/WhatsApp/email/IA — crece con el éxito
   del cliente sin esfuerzo comercial. Proteger estos márgenes al diseñar planes
   (es donde GHL gana una parte enorme de su dinero).
4. Futuro: white-label multi-agencia (`parent_agency_id` ya lo soporta).

---

## 4b. Estructura de costes por usuario (cifras de julio 2026 — volátiles, revisar antes de usar)

> Los PRECIOS de venta no se documentan (ver 2.3); esta sección es el modelo de COSTES
> para calcular suelos y márgenes. Todas las cifras verificadas 2026-07-10.

### Costes fijos de plataforma (totales, no por usuario)
- Vercel Pro ~18 € + Supabase Pro ~23 € + Resend (0–18 €) + dominio ≈ **40–60 €/mes total**.
  Con 10 usuarios: 4–6 €/usuario. Válido hasta ~50 usuarios (luego +50–100 €/mes de tiers).

### Costes fijos POR usuario
- Número Twilio: ~3–6 €/mes (solo si usa WhatsApp/SMS con número propio).
- Comisión de cobro de su cuota: ~2% (tarjeta) o ~0,35% (SEPA — usar para recurrentes).
- **Total fijo por usuario: ~8–12 €/mes.**

### Costes variables (consumo — SIEMPRE medido y rebillado con margen, nunca tarifa plana)
- **WhatsApp España** (por mensaje desde jul-2025): servicio (ventana 24h) gratis;
  utility ~0,017 €; marketing ~0,051 € (+~0,005 $ Twilio por mensaje).
- **SMS España: ~0,08 € — 5× más caro que WhatsApp utility.** Regla operativa: todo por
  WhatsApp, SMS solo fallback. Refuerza el posicionamiento "WhatsApp en el centro".
- **Email (Resend):** ~0,0004 €/email — despreciable.
- **IA (API Claude, jul-2026):** Haiku 4.5 $1/$5 por Mtok; Sonnet 5 $3/$15 ($2/$10 intro
  hasta 2026-08-31). Prompt caching: lecturas de prefijo repetido a ~10% del precio.
  - Respuesta de chatbot: Haiku+caché ~0,2 cts → 2.000 respuestas ≈ 4 €/mes;
    Sonnet sin caché ~1,2 cts → 2.000 respuestas ≈ 25 €/mes. **El modelo elegido y la
    caché son una palanca de coste de 5–6×.** Decisión: chatbot en Haiku con caché;
    Sonnet solo para generación de contenido/diseño (~7 cts por funnel generado).
- **El cost driver es la campaña masiva de WhatsApp**: 1 blast marketing a 1.000
  contactos ≈ 55 €. Por eso jamás ofrecer consumo "ilimitado".

### Perfiles de consumo mensual por usuario (orientativos)
| Perfil | Consumo |
|---|---|
| Ligero (freelance, secuencias básicas) | ~5–10 € |
| Medio (~150 leads/mes, chatbot Haiku, sin blasts) | ~35–45 € |
| Intenso (blasts a bases 1.000+, IA intensiva) | ~100–150 € |

### Reglas de pricing derivadas
1. La cuota de mantenimiento (ambos planes) solo necesita cubrir el fijo (~8–12 €) +
   un paquete de consumo incluido definido — todo lo demás es margen bruto.
2. El consumo extra va SIEMPRE por wallet con margen ×2,5–3 (rebilling ya construido) —
   ningún usuario puede costar dinero por mucho que envíe.
3. Nota producto (pendiente): separar utility/marketing en el metering de WhatsApp
   (`BASE_COSTS` cobra 0,05 € plano; utility real cuesta 0,017 €) y fijar modelo de IA
   por función (Haiku chatbot / Sonnet contenido) + prompt caching en `agent.js`.

---

## 5. Riesgos estructurales (no ignorar)

- **Dependencia de proveedores:** el negocio corre sobre Twilio/Meta/Stripe. La API de
  WhatsApp Business tiene reglas estrictas; una suspensión tumba a todos los clientes
  a la vez. Tratar estas relaciones como estratégicas, no como trámite técnico.
- **Fundador único con dos negocios:** agencia y SaaS son dos ventas distintas. La
  secuencia (1 antes que 2) existe para no hacer ambas a la vez.
- **Narrativa:** jamás "clon de GHL" de cara al mercado.

---

## 6. Decisiones abiertas (próximos frentes de trabajo)

1. ~~**Precios línea 1**~~ ✅ Resuelto (ver 2.3). Pendiente de la línea 2: afinar planes
   (boceto: Autónomo 49 € / Negocio 99 € / Agencia revendedora 249 €, rebilling ×2,5–3
   sobre coste base) cuando se acerque su lanzamiento.
2. **Vertical de arranque de la línea 1:** elegir uno (la garantía empuja a ticket
   alto) y armar el pitch con números. Input pendiente del fundador: a qué sectores
   tiene mejor acceso (contactos propios o clientes de las agencias con las que trabaja).
3. **Contrato de la garantía:** métrica exacta, línea base, ventana de medición,
   obligación de registro de ventas en el CRM.
4. **Definición de "pulido" para lanzar la línea 2:** los 5 flujos móviles diarios
   con push, curso grabado, comunidad con pulso.
5. **Kit Digital:** verificar vigencia 2026 y requisitos para acreditarse como agente
   digitalizador (potencial mejor canal de entrada de la línea 1).
