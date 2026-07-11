// v65: Empleado IA (AI employee). Tool executors act on real CRM data, the
// agent loop round-trips tool_use with the Anthropic API (stubbed here), and
// without a key the endpoint answers gracefully instead of failing.
const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
delete process.env.ANTHROPIC_API_KEY;

const request = require('supertest');
const app = require('../server/index');
const copilot = require('../server/services/copilot');

let H, loc, agencyId, userId, contactId;
const ctx = () => ({ locationId: loc, agencyId, userId });

before(async () => {
  const r = await request(app).post('/api/auth/register').send({
    agency_name: 'Copi', name: 'Ana', email: 'copi@test.com', password: 'secret1', location_name: 'Sede',
  });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`);
  loc = me.body.locations[0].id;
  agencyId = me.body.user.agency_id;
  userId = me.body.user.id;
  H = { Authorization: `Bearer ${r.body.token}`, 'X-Location-Id': String(loc) };
  const c = await request(app).post('/api/contacts').set(H).send({ first_name: 'Laura', last_name: 'Vidal', email: 'laura@x.com', phone: '+34611' });
  contactId = c.body.id;
});

test('tools: create_task links the contact by fuzzy reference', async () => {
  const out = await copilot.executeTool('create_task', { title: 'Llamar a Laura', contact: 'laura@x.com', due_in_days: 2 }, ctx());
  assert.ok(out.data.ok);
  assert.equal(out.data.contacto.id, contactId);
  const tasks = await request(app).get('/api/tasks').set(H);
  assert.ok(tasks.body.some((t2) => t2.title === 'Llamar a Laura'));
});

test('tools: draft_campaign is created as a DRAFT, never sent', async () => {
  const out = await copilot.executeTool('draft_campaign', { name: 'Reactivación', channel: 'email', subject: 'Te echamos de menos', body: 'Hola {{first_name}}…' }, ctx());
  assert.ok(out.data.ok);
  const camps = await request(app).get('/api/marketing/campaigns').set(H);
  const c = camps.body.find((x) => x.name === 'Reactivación');
  assert.equal(c.status, 'draft');
});

test('tools: create_workflow lands INACTIVE and rejects unknown actions', async () => {
  const bad = await copilot.executeTool('create_workflow', { name: 'X', trigger_type: 'contact_created', actions: [{ type: 'delete_everything' }] }, ctx());
  assert.ok(bad.data.error, 'invalid actions rejected');
  const ok = await copilot.executeTool('create_workflow', {
    name: 'Bienvenida IA', trigger_type: 'contact_created', actions: [{ type: 'add_tag', config: { tag: 'nuevo' } }, { type: 'send_email', config: { subject: 'Hola', body: 'Bienvenido' } }],
  }, ctx());
  assert.ok(ok.data.ok);
  const wfs = await request(app).get('/api/workflows').set(H);
  const wf = wfs.body.find((w) => w.name === 'Bienvenida IA');
  assert.equal(Boolean(wf.active), false, 'created paused for human review');
});

test('tools: add_tag + search + stats + report', async () => {
  const tag = await copilot.executeTool('add_tag', { contact: 'Laura Vidal', tag: 'vip' }, ctx());
  assert.ok(tag.data.ok);
  const search = await copilot.executeTool('search_contacts', { query: 'laura' }, ctx());
  assert.ok(search.data.some((c) => c.id === contactId));
  const stats = await copilot.executeTool('get_stats', {}, ctx());
  assert.ok(stats.data.contactos >= 1);
  const rep = await copilot.executeTool('generate_report', { period_days: 30 }, ctx());
  assert.match(rep.data.url, /^\/r\//);
  const page = await request(app).get(rep.data.url);
  assert.equal(page.status, 200);
});

test('endpoint without an AI key answers gracefully (configured:false)', async () => {
  const res = await request(app).post('/api/copilot').set(H).send({ message: 'hola' });
  assert.equal(res.status, 200);
  assert.equal(res.body.configured, false);
  assert.match(res.body.reply, /API key/i);
});

test('agent loop: executes a tool_use round-trip against the (stubbed) Anthropic API', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async (url, opts) => {
    if (!String(url).includes('api.anthropic.com')) return realFetch(url, opts);
    calls++;
    const body = JSON.parse(opts.body);
    assert.ok(Array.isArray(body.tools) && body.tools.length >= 8, 'tools are advertised to Claude');
    if (calls === 1) {
      return { ok: true, json: async () => ({ stop_reason: 'tool_use', content: [
        { type: 'text', text: 'Voy a mirarlo…' },
        { type: 'tool_use', id: 'tu_1', name: 'get_stats', input: {} },
      ] }) };
    }
    // Second turn: Claude got the tool_result back and answers.
    const last = body.messages.at(-1);
    assert.equal(last.role, 'user');
    assert.equal(last.content[0].type, 'tool_result');
    assert.match(last.content[0].content, /contactos/, 'tool result fed back to Claude');
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tienes 1 contacto y todo al día ✅' }] }) };
  };
  try {
    const res = await request(app).post('/api/copilot').set(H).send({ message: '¿cómo va el negocio?' });
    assert.equal(res.status, 200);
    assert.equal(res.body.generated_by, 'claude');
    assert.match(res.body.reply, /al día/);
    assert.ok(res.body.actions.includes('Estadísticas consultadas'), 'action chip reported');
    assert.equal(calls, 2, 'one tool round-trip then final answer');
  } finally {
    global.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }
});
