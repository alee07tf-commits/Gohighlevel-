// Seeds a demo agency with realistic data so the app is explorable on first run.
// Login: demo@leadflow.app / demo123
const bcrypt = require('bcryptjs');
const db = require('./db');

if (db.prepare('SELECT id FROM users WHERE email = ?').get('demo@leadflow.app')) {
  console.log('Demo data already seeded. Login: demo@leadflow.app / demo123');
  process.exit(0);
}

const seed = db.transaction(() => {
  const agency = db.prepare('INSERT INTO agencies (name) VALUES (?)').run('Demo Marketing Agency');
  const agencyId = agency.lastInsertRowid;

  db.prepare('INSERT INTO users (agency_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
    agencyId, 'Demo Admin', 'demo@leadflow.app', bcrypt.hashSync('demo123', 10), 'admin'
  );

  const loc = db
    .prepare('INSERT INTO locations (agency_id, name, company, phone, email, website) VALUES (?, ?, ?, ?, ?, ?)')
    .run(agencyId, 'Sunrise Dental Clinic', 'Sunrise Dental LLC', '+1 555 010 2000', 'hello@sunrisedental.com', 'https://sunrisedental.example');
  const locId = loc.lastInsertRowid;
  db.prepare('INSERT INTO locations (agency_id, name, company) VALUES (?, ?, ?)').run(
    agencyId, 'FitLife Gym', 'FitLife Fitness Inc'
  );

  const contacts = [
    ['Maria', 'Garcia', 'maria@example.com', '+1 555 111 0001', 'funnel:teeth-whitening', ['lead', 'whitening']],
    ['John', 'Smith', 'john@example.com', '+1 555 111 0002', 'manual', ['customer']],
    ['Aisha', 'Khan', 'aisha@example.com', '+1 555 111 0003', 'booking:free-consult', ['lead']],
    ['Carlos', 'Lopez', 'carlos@example.com', '+1 555 111 0004', 'manual', ['customer', 'vip']],
    ['Emily', 'Chen', 'emily@example.com', '+1 555 111 0005', 'funnel:teeth-whitening', ['lead', 'whitening']],
  ];
  const contactIds = contacts.map(([first, last, email, phone, source, tags]) => {
    const info = db
      .prepare('INSERT INTO contacts (location_id, first_name, last_name, email, phone, source) VALUES (?, ?, ?, ?, ?, ?)')
      .run(locId, first, last, email, phone, source);
    for (const tag of tags)
      db.prepare('INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?)').run(info.lastInsertRowid, tag);
    db.prepare('INSERT INTO activities (location_id, contact_id, type, description) VALUES (?, ?, ?, ?)').run(
      locId, info.lastInsertRowid, 'contact', 'Contact created'
    );
    return info.lastInsertRowid;
  });

  const pipeline = db.prepare('INSERT INTO pipelines (location_id, name) VALUES (?, ?)').run(locId, 'Patient Pipeline');
  const stageIds = ['New Lead', 'Contacted', 'Consultation Booked', 'Treatment Plan', 'Won'].map((name, i) =>
    db.prepare('INSERT INTO stages (pipeline_id, name, position) VALUES (?, ?, ?)').run(pipeline.lastInsertRowid, name, i)
      .lastInsertRowid
  );
  const opps = [
    ['Whitening package - Maria', 450, 0, contactIds[0], 'open'],
    ['Invisalign - John', 3800, 2, contactIds[1], 'open'],
    ['Implant consult - Aisha', 2500, 1, contactIds[2], 'open'],
    ['Full checkup - Carlos', 220, 4, contactIds[3], 'won'],
  ];
  for (const [title, value, stageIdx, contactId, status] of opps) {
    db.prepare(
      'INSERT INTO opportunities (location_id, pipeline_id, stage_id, contact_id, title, value, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(locId, pipeline.lastInsertRowid, stageIds[stageIdx], contactId, title, value, status);
  }

  const cal = db
    .prepare(
      'INSERT INTO calendars (location_id, name, slug, description, duration_minutes) VALUES (?, ?, ?, ?, ?)'
    )
    .run(locId, 'Free Consultation', 'free-consult', 'Book a free 30-minute consultation with our team.', 30);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  db.prepare(
    'INSERT INTO appointments (location_id, calendar_id, contact_id, title, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(locId, cal.lastInsertRowid, contactIds[2], 'Free Consultation with Aisha', `${tomorrow}T10:00:00`, `${tomorrow}T10:30:00`);

  db.prepare('INSERT INTO email_templates (location_id, name, subject, body) VALUES (?, ?, ?, ?)').run(
    locId,
    'Welcome Email',
    'Welcome to Sunrise Dental, {{first_name}}!',
    'Hi {{first_name}},\n\nThanks for reaching out! Our team will contact you within 24 hours.\n\nSmile bright,\nSunrise Dental'
  );

  db.prepare(
    'INSERT INTO campaigns (location_id, name, channel, subject, body, tag_filter) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    locId,
    'Whitening Promo - June',
    'email',
    '{{first_name}}, 20% off teeth whitening this month',
    'Hi {{first_name}},\n\nThis month only: 20% off our professional whitening treatment. Reply to claim your spot!',
    'whitening'
  );

  const wf = db
    .prepare('INSERT INTO workflows (location_id, name, trigger_type, trigger_config) VALUES (?, ?, ?, ?)')
    .run(locId, 'New Lead Nurture', 'contact_created', '{}');
  const actions = [
    ['add_tag', { tag: 'lead' }],
    ['send_email', { subject: 'Welcome, {{first_name}}!', body: 'Hi {{first_name}}, thanks for your interest in Sunrise Dental. Book your free consult: /book/free-consult' }],
    ['send_sms', { body: 'Hi {{first_name}}! This is Sunrise Dental — we got your info and will call you shortly.' }],
    ['create_opportunity', { title: 'New patient - {{first_name}} {{last_name}}', value: 250 }],
  ];
  actions.forEach(([type, config], i) =>
    db.prepare('INSERT INTO workflow_actions (workflow_id, position, type, config) VALUES (?, ?, ?, ?)').run(
      wf.lastInsertRowid, i, type, JSON.stringify(config)
    )
  );

  const funnel = db.prepare('INSERT INTO funnels (location_id, name, slug) VALUES (?, ?, ?)').run(
    locId, 'Teeth Whitening Campaign', 'teeth-whitening'
  );
  const content = [
    { type: 'hero', headline: 'Get a Brighter Smile in 60 Minutes', subheadline: 'Professional teeth whitening by Sunrise Dental. This month: 20% off for new patients.', cta: 'Claim My Discount' },
    { type: 'features', headline: 'Why patients love us', items: [
      { title: 'Fast results', body: 'Visible results after a single 60-minute session.' },
      { title: 'Painless', body: 'Gentle, enamel-safe whitening technology.' },
      { title: 'Guaranteed', body: 'Love your smile or your money back.' },
    ] },
    { type: 'form', headline: 'Claim your 20% discount', button: 'Get My Discount', fields: ['first_name', 'email', 'phone'], success_message: 'You are in! Our team will call you to schedule your session.', tag: 'whitening' },
  ];
  db.prepare(
    'INSERT INTO funnel_pages (funnel_id, name, slug, position, published, content) VALUES (?, ?, ?, 0, 1, ?)'
  ).run(funnel.lastInsertRowid, 'Whitening Landing', 'home', JSON.stringify(content));

  // A couple of inbox conversations.
  const conv = db.prepare('INSERT INTO conversations (location_id, contact_id, unread) VALUES (?, ?, 1)').run(locId, contactIds[0]);
  db.prepare("INSERT INTO messages (conversation_id, direction, channel, body) VALUES (?, 'outbound', 'sms', ?)").run(
    conv.lastInsertRowid, 'Hi Maria! This is Sunrise Dental — we got your info and will call you shortly.'
  );
  db.prepare("INSERT INTO messages (conversation_id, direction, channel, body) VALUES (?, 'inbound', 'sms', ?)").run(
    conv.lastInsertRowid, 'Great! Can I come in on Thursday afternoon?'
  );
});

seed();
console.log('Seeded demo agency. Login: demo@leadflow.app / demo123');
