// Demo-agency seed data, callable both from the CLI (server/seed.js) and at
// boot on ephemeral hosts (AUTO_SEED). Login: demo@leadflow.app / demo123
const bcrypt = require('bcryptjs');
const db = require('./db');

// Returns true if it seeded, false if demo data already existed.
async function seedDemo() {
  if (await db.get('SELECT id FROM users WHERE email = ?', ['demo@leadflow.app'])) return false;

  await db.tx(async (t) => {
    // Serialize competing seeders (boot auto-seed vs manual endpoint) — the
    // loser re-checks inside the lock and exits instead of colliding on the
    // unique email index.
    await t.get('SELECT pg_advisory_xact_lock(815052)');
    if (await t.get('SELECT id FROM users WHERE email = ?', ['demo@leadflow.app'])) return;

    const agencyId = await t.insert('INSERT INTO agencies (name) VALUES (?)', ['Demo Marketing Agency']);

    await t.run('INSERT INTO users (agency_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [
      agencyId, 'Demo Admin', 'demo@leadflow.app', bcrypt.hashSync('demo123', 10), 'admin',
    ]);

    const locId = await t.insert(
      'INSERT INTO locations (agency_id, name, company, phone, email, website) VALUES (?, ?, ?, ?, ?, ?)',
      [agencyId, 'Sunrise Dental Clinic', 'Sunrise Dental LLC', '+1 555 010 2000', 'hello@sunrisedental.com', 'https://sunrisedental.example']
    );
    await t.run('INSERT INTO locations (agency_id, name, company) VALUES (?, ?, ?)', [
      agencyId, 'FitLife Gym', 'FitLife Fitness Inc',
    ]);

    const contacts = [
      ['Maria', 'Garcia', 'maria@example.com', '+1 555 111 0001', 'funnel:teeth-whitening', ['lead', 'whitening']],
      ['John', 'Smith', 'john@example.com', '+1 555 111 0002', 'manual', ['customer']],
      ['Aisha', 'Khan', 'aisha@example.com', '+1 555 111 0003', 'booking:free-consult', ['lead']],
      ['Carlos', 'Lopez', 'carlos@example.com', '+1 555 111 0004', 'manual', ['customer', 'vip']],
      ['Emily', 'Chen', 'emily@example.com', '+1 555 111 0005', 'funnel:teeth-whitening', ['lead', 'whitening']],
    ];
    const contactIds = [];
    for (const [first, last, email, phone, source, tags] of contacts) {
      const cid = await t.insert(
        'INSERT INTO contacts (location_id, first_name, last_name, email, phone, source) VALUES (?, ?, ?, ?, ?, ?)',
        [locId, first, last, email, phone, source]
      );
      for (const tag of tags) await t.run('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?)', [cid, tag]);
      await t.run('INSERT INTO activities (location_id, contact_id, type, description) VALUES (?, ?, ?, ?)', [
        locId, cid, 'contact', 'Contact created',
      ]);
      contactIds.push(cid);
    }

    const pipelineId = await t.insert('INSERT INTO pipelines (location_id, name) VALUES (?, ?)', [
      locId, 'Patient Pipeline',
    ]);
    const stageNames = ['New Lead', 'Contacted', 'Consultation Booked', 'Treatment Plan', 'Won'];
    const stageIds = [];
    for (let i = 0; i < stageNames.length; i++) {
      stageIds.push(
        await t.insert('INSERT INTO stages (pipeline_id, name, position) VALUES (?, ?, ?)', [
          pipelineId, stageNames[i], i,
        ])
      );
    }
    const opps = [
      ['Whitening package - Maria', 450, 0, contactIds[0], 'open'],
      ['Invisalign - John', 3800, 2, contactIds[1], 'open'],
      ['Implant consult - Aisha', 2500, 1, contactIds[2], 'open'],
      ['Full checkup - Carlos', 220, 4, contactIds[3], 'won'],
    ];
    for (const [title, value, stageIdx, contactId, status] of opps) {
      await t.run(
        'INSERT INTO opportunities (location_id, pipeline_id, stage_id, contact_id, title, value, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [locId, pipelineId, stageIds[stageIdx], contactId, title, value, status]
      );
    }

    const calId = await t.insert(
      'INSERT INTO calendars (location_id, name, slug, description, duration_minutes) VALUES (?, ?, ?, ?, ?)',
      [locId, 'Free Consultation', 'free-consult', 'Book a free 30-minute consultation with our team.', 30]
    );
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await t.run(
      'INSERT INTO appointments (location_id, calendar_id, contact_id, title, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)',
      [locId, calId, contactIds[2], 'Free Consultation with Aisha', `${tomorrow}T10:00:00`, `${tomorrow}T10:30:00`]
    );

    await t.run('INSERT INTO email_templates (location_id, name, subject, body) VALUES (?, ?, ?, ?)', [
      locId,
      'Welcome Email',
      'Welcome to Sunrise Dental, {{first_name}}!',
      'Hi {{first_name}},\n\nThanks for reaching out! Our team will contact you within 24 hours.\n\nSmile bright,\nSunrise Dental',
    ]);

    await t.run(
      'INSERT INTO campaigns (location_id, name, channel, subject, body, tag_filter) VALUES (?, ?, ?, ?, ?, ?)',
      [
        locId,
        'Whitening Promo - June',
        'email',
        '{{first_name}}, 20% off teeth whitening this month',
        'Hi {{first_name}},\n\nThis month only: 20% off our professional whitening treatment. Reply to claim your spot!',
        'whitening',
      ]
    );

    const wfId = await t.insert(
      'INSERT INTO workflows (location_id, name, trigger_type, trigger_config) VALUES (?, ?, ?, ?)',
      [locId, 'New Lead Nurture', 'contact_created', '{}']
    );
    const actions = [
      ['add_tag', { tag: 'lead' }],
      ['send_email', { subject: 'Welcome, {{first_name}}!', body: 'Hi {{first_name}}, thanks for your interest in Sunrise Dental. Book your free consult: /book/free-consult' }],
      ['send_sms', { body: 'Hi {{first_name}}! This is Sunrise Dental — we got your info and will call you shortly.' }],
      ['create_opportunity', { title: 'New patient - {{first_name}} {{last_name}}', value: 250 }],
    ];
    for (let i = 0; i < actions.length; i++) {
      await t.run('INSERT INTO workflow_actions (workflow_id, position, type, config) VALUES (?, ?, ?, ?)', [
        wfId, i, actions[i][0], JSON.stringify(actions[i][1]),
      ]);
    }

    const funnelId = await t.insert('INSERT INTO funnels (location_id, name, slug) VALUES (?, ?, ?)', [
      locId, 'Teeth Whitening Campaign', 'teeth-whitening',
    ]);
    const content = [
      { type: 'hero', headline: 'Get a Brighter Smile in 60 Minutes', subheadline: 'Professional teeth whitening by Sunrise Dental. This month: 20% off for new patients.', cta: 'Claim My Discount' },
      { type: 'features', headline: 'Why patients love us', items: [
        { title: 'Fast results', body: 'Visible results after a single 60-minute session.' },
        { title: 'Painless', body: 'Gentle, enamel-safe whitening technology.' },
        { title: 'Guaranteed', body: 'Love your smile or your money back.' },
      ] },
      { type: 'form', headline: 'Claim your 20% discount', button: 'Get My Discount', fields: ['first_name', 'email', 'phone'], success_message: 'You are in! Our team will call you to schedule your session.', tag: 'whitening' },
    ];
    await t.run(
      'INSERT INTO funnel_pages (funnel_id, name, slug, position, published, content) VALUES (?, ?, ?, 0, 1, ?)',
      [funnelId, 'Whitening Landing', 'home', JSON.stringify(content)]
    );

    // A couple of inbox conversations.
    const convId = await t.insert('INSERT INTO conversations (location_id, contact_id, unread) VALUES (?, ?, 1)', [
      locId, contactIds[0],
    ]);
    await t.run("INSERT INTO messages (conversation_id, direction, channel, body) VALUES (?, 'outbound', 'sms', ?)", [
      convId, 'Hi Maria! This is Sunrise Dental — we got your info and will call you shortly.',
    ]);
    await t.run("INSERT INTO messages (conversation_id, direction, channel, body) VALUES (?, 'inbound', 'sms', ?)", [
      convId, 'Great! Can I come in on Thursday afternoon?',
    ]);

    // Training: a default onboarding course the agency ships to its clients.
    // It is visible to every agency below this one in the tenant tree.
    const courseId = await t.insert(
      'INSERT INTO courses (agency_id, title, description) VALUES (?, ?, ?)',
      [agencyId, 'Cómo usar tu plataforma de marketing', 'Onboarding paso a paso para sacarle partido a tu cuenta.']
    );
    const trainLessons = [
      ['Bienvenida y primeros pasos', 'Recorre tu panel: dashboard, contactos y el selector de sub-cuenta.'],
      ['Captar leads con funnels', 'Crea y publica tu primer funnel; los leads entran solos a Contactos.'],
      ['Conversaciones y seguimiento', 'Responde a tus leads desde el inbox unificado (SMS/email).'],
      ['Automatiza el seguimiento', 'Monta un workflow "nuevo lead → email + SMS" para no perder ninguno.'],
      ['Agenda citas', 'Comparte tu calendario público y gestiona tus citas.'],
    ];
    for (let i = 0; i < trainLessons.length; i++) {
      await t.run('INSERT INTO lessons (course_id, title, body, position) VALUES (?, ?, ?, ?)', [
        courseId, trainLessons[i][0], trainLessons[i][1], i,
      ]);
    }

    // A sample client = a child agency with its own admin login and first
    // sub-account. Shows the recursive model: this client sees the course above
    // and can manage its own sub-accounts. Login: cliente@leadflow.app / demo123
    const clientAgencyId = await t.insert(
      'INSERT INTO agencies (name, parent_agency_id, slug, brand_color) VALUES (?, ?, ?, ?)',
      ['Cliente Demo — Bright Smile', agencyId, 'bright-smile', '#0ea5e9']
    );
    await t.run('INSERT INTO users (agency_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [
      clientAgencyId, 'Cliente Demo', 'cliente@leadflow.app', bcrypt.hashSync('demo123', 10), 'admin',
    ]);
    await t.run('INSERT INTO locations (agency_id, name, company) VALUES (?, ?, ?)', [
      clientAgencyId, 'Bright Smile Dental', 'Bright Smile SL',
    ]);
  });

  return true;
}

module.exports = { seedDemo };
