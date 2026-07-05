// Public chat widget API + embeddable script (/widget.js).
// Flow: visitor opens widget → leaves name + phone/email → contact +
// conversation created → messages flow into the unified inbox; if the
// location has Conversation AI enabled, the agent answers (and can book).
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const messaging = require('../services/messaging');
const automation = require('../services/automation');
const scoring = require('../services/scoring');

const router = express.Router();

router.get('/:locationId/config', async (req, res) => {
  const loc = await db.get('SELECT * FROM locations WHERE id = ?', [req.params.locationId]);
  if (!loc) return res.status(404).json({ error: 'Unknown location' });
  res.json({
    name: loc.name,
    brand_color: loc.brand_color || '#6d5ef5',
    logo_url: loc.logo_url || '',
    ai: Boolean(loc.ai_agent_enabled),
  });
});

router.post('/:locationId/start', async (req, res) => {
  const loc = await db.get('SELECT * FROM locations WHERE id = ?', [req.params.locationId]);
  if (!loc) return res.status(404).json({ error: 'Unknown location' });
  const { name = '', email = '', phone = '' } = req.body || {};
  if (!name && !email && !phone) return res.status(400).json({ error: 'Déjanos al menos tu nombre y un contacto' });
  if (!email && !phone) return res.status(400).json({ error: 'Necesitamos tu teléfono o email para responderte' });

  let contact = null;
  if (email) contact = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND email = ? AND email != ''`, [loc.id, email]);
  if (!contact && phone) contact = await db.get(`SELECT * FROM contacts WHERE location_id = ? AND phone = ? AND phone != ''`, [loc.id, phone]);
  let isNew = false;
  if (!contact) {
    const [first, ...rest] = String(name).trim().split(' ');
    const id = await db.insert(
      'INSERT INTO contacts (location_id, first_name, last_name, email, phone, source) VALUES (?, ?, ?, ?, ?, ?)',
      [loc.id, first || '', rest.join(' '), email, phone, 'chat-widget']
    );
    contact = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
    isNew = true;
  }
  const conv = await messaging.getOrCreateConversation(loc.id, contact.id);
  if (!conv.public_token) {
    conv.public_token = crypto.randomBytes(16).toString('hex');
    await db.run('UPDATE conversations SET public_token = ? WHERE id = ?', [conv.public_token, conv.id]);
  }
  if (isNew) {
    await automation.logActivity(loc.id, contact.id, 'contact', 'Contact created (chat widget)');
    await automation.trigger(loc.id, 'contact_created', contact);
  }
  res.json({ token: conv.public_token, greeting: `¡Hola${contact.first_name ? ` ${contact.first_name}` : ''}! ¿En qué podemos ayudarte?` });
});

async function convByToken(token) {
  if (!token || typeof token !== 'string' || token.length < 10) return null;
  return db.get('SELECT * FROM conversations WHERE public_token = ?', [token]);
}

router.get('/messages', async (req, res) => {
  const conv = await convByToken(req.query.token);
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
  const messages = await db.all(
    `SELECT direction, channel, body, created_at FROM messages
     WHERE conversation_id = ? AND channel != 'note' ORDER BY created_at, id LIMIT 100`,
    [conv.id]
  );
  res.json(messages);
});

router.post('/message', async (req, res) => {
  const conv = await convByToken(req.body?.token);
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
  const body = String(req.body?.body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'Mensaje vacío' });

  const loc = await db.get('SELECT * FROM locations WHERE id = ?', [conv.location_id]);
  const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [conv.contact_id]);

  await messaging.recordMessage({
    locationId: loc.id,
    contactId: contact.id,
    direction: 'inbound',
    channel: 'chat',
    body,
  });
  await scoring.addScore(contact.id, 'inbound_message');
  await automation.trigger(loc.id, 'message_received', contact, {});

  let aiReply = null;
  if (loc.ai_agent_enabled && !conv.ai_paused) {
    try {
      const agent = require('../services/agent');
      const { reply } = await agent.respond({ location: loc, contact, conversationId: conv.id, inbound: body });
      if (reply) {
        await messaging.recordMessage({
          locationId: loc.id,
          contactId: contact.id,
          direction: 'outbound',
          channel: 'chat',
          body: reply,
        });
        aiReply = reply;
      }
    } catch (err) {
      console.error('agent error:', err.message);
    }
  }
  res.json({ ok: true, reply: aiReply });
});

module.exports = router;

// ---- Embeddable widget script ----
// Usage anywhere: <script src="https://<app>/widget.js" data-location="ID"></script>
module.exports.widgetScript = function widgetScript(req, res) {
  res.type('application/javascript').send(`(function(){
var s=document.currentScript;var LOC=s.getAttribute('data-location')||'1';
var BASE=(s.src.split('/widget.js')[0])||'';
var KEY='lfchat_'+LOC;var token=localStorage.getItem(KEY)||'';
fetch(BASE+'/api/public/chat/'+LOC+'/config').then(function(r){return r.json()}).then(function(cfg){
var C=cfg.brand_color||'#6d5ef5';
var css='#lfw-btn{position:fixed;bottom:20px;right:20px;width:58px;height:58px;border-radius:50%;background:'+C+';color:#fff;border:none;box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer;font-size:26px;z-index:99999}'+
'#lfw-panel{position:fixed;bottom:90px;right:20px;width:340px;max-width:calc(100vw - 30px);height:480px;max-height:70vh;background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;z-index:99999;font-family:Inter,system-ui,sans-serif;font-size:14px}'+
'#lfw-head{background:'+C+';color:#fff;padding:14px 16px;font-weight:700}#lfw-head small{display:block;font-weight:400;opacity:.85;font-size:11px}'+
'#lfw-msgs{flex:1;overflow-y:auto;padding:14px;background:#f6f7fb;display:flex;flex-direction:column;gap:8px}'+
'.lfw-m{max-width:80%;padding:8px 12px;border-radius:14px;line-height:1.45;white-space:pre-wrap;font-size:13px}'+
'.lfw-in{align-self:flex-end;background:'+C+';color:#fff;border-bottom-right-radius:4px}'+
'.lfw-out{align-self:flex-start;background:#fff;border:1px solid #e6e7ee;border-bottom-left-radius:4px}'+
'#lfw-form{padding:12px;display:flex;gap:8px;border-top:1px solid #eee;background:#fff}'+
'#lfw-form input{flex:1;padding:9px 12px;border:1px solid #ddd;border-radius:10px;font-size:13px;outline:none}'+
'#lfw-form button{background:'+C+';color:#fff;border:none;border-radius:10px;padding:9px 14px;font-weight:700;cursor:pointer}'+
'#lfw-lead{padding:16px;display:none;flex-direction:column;gap:8px;background:#fff}'+
'#lfw-lead input{padding:10px 12px;border:1px solid #ddd;border-radius:10px;font-size:13px}'+
'#lfw-lead button{background:'+C+';color:#fff;border:none;border-radius:10px;padding:11px;font-weight:700;cursor:pointer}'+
'#lfw-lead .err{color:#e5484d;font-size:12px;display:none}';
var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
var btn=document.createElement('button');btn.id='lfw-btn';btn.textContent='💬';document.body.appendChild(btn);
var p=document.createElement('div');p.id='lfw-panel';
p.innerHTML='<div id="lfw-head">'+cfg.name+'<small>'+(cfg.ai?'Respuesta al instante 🤖':'Te respondemos muy pronto')+'</small></div>'+
'<div id="lfw-msgs"></div>'+
'<div id="lfw-lead"><div style="font-weight:600">Déjanos tus datos para empezar 👇</div>'+
'<input id="lfw-name" placeholder="Tu nombre"><input id="lfw-phone" placeholder="Teléfono o email">'+
'<div class="err" id="lfw-err"></div><button id="lfw-go">Empezar chat</button></div>'+
'<form id="lfw-form"><input id="lfw-text" placeholder="Escribe un mensaje…" autocomplete="off"><button>➤</button></form>';
document.body.appendChild(p);
var msgs=p.querySelector('#lfw-msgs'),lead=p.querySelector('#lfw-lead'),form=p.querySelector('#lfw-form');
function ui(){lead.style.display=token?'none':'flex';form.style.display=token?'flex':'none';}
function add(dir,body){var d=document.createElement('div');d.className='lfw-m '+(dir==='inbound'?'lfw-in':'lfw-out');d.textContent=body;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;}
function load(){if(!token)return;fetch(BASE+'/api/public/chat/messages?token='+token).then(function(r){return r.json()}).then(function(list){if(!Array.isArray(list))return;msgs.innerHTML='';list.forEach(function(m){add(m.direction,m.body)});});}
var open=false,timer=null;
btn.onclick=function(){open=!open;p.style.display=open?'flex':'none';btn.textContent=open?'✕':'💬';ui();if(open){load();timer=setInterval(load,5000);}else clearInterval(timer);};
p.querySelector('#lfw-go').onclick=function(){var name=p.querySelector('#lfw-name').value,ph=p.querySelector('#lfw-phone').value;
fetch(BASE+'/api/public/chat/'+LOC+'/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,phone:ph.indexOf('@')<0?ph:'',email:ph.indexOf('@')>=0?ph:''})})
.then(function(r){return r.json()}).then(function(d){if(d.token){token=d.token;localStorage.setItem(KEY,token);ui();add('outbound',d.greeting||'¡Hola! ¿En qué podemos ayudarte?');}else{var e=p.querySelector('#lfw-err');e.textContent=d.error||'Error';e.style.display='block';}});};
form.onsubmit=function(ev){ev.preventDefault();var t=p.querySelector('#lfw-text');var body=t.value.trim();if(!body)return;t.value='';add('inbound',body);
fetch(BASE+'/api/public/chat/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token,body:body})})
.then(function(r){return r.json()}).then(function(d){if(d.reply)add('outbound',d.reply);});};
});})();`);
};
