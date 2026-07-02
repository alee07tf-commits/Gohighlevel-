import { api } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate } from '../ui.js';

export async function renderMarketing(view) {
  const [templates, campaigns, tags] = await Promise.all([
    api('/marketing/templates'),
    api('/marketing/campaigns'),
    api('/contacts/meta/tags'),
  ]);

  view.innerHTML = `
  <div class="page-header">
    <h1>Marketing</h1>
    <div class="spacer"></div>
    <button class="btn secondary" id="new-template">+ Email Template</button>
    <button class="btn" id="new-campaign">+ Campaign</button>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-title">Campaigns</div>
      <div class="card-body" style="padding:0">
        ${
          campaigns.length
            ? `<table class="table"><thead><tr><th>Name</th><th>Channel</th><th>Audience</th><th>Status</th><th></th></tr></thead><tbody>
              ${campaigns
                .map(
                  (c) => `<tr>
                    <td><strong>${esc(c.name)}</strong><div class="muted" style="font-size:11px">${esc(c.subject)}</div></td>
                    <td><span class="badge gray">${c.channel}</span></td>
                    <td>${c.tag_filter ? `<span class="tag">${esc(c.tag_filter)}</span>` : '<span class="muted">Everyone</span>'}</td>
                    <td>${c.status === 'sent' ? `<span class="badge green">sent to ${c.recipient_count}</span><div class="muted" style="font-size:10px">${fmtDate(c.sent_at)}</div>` : '<span class="badge amber">draft</span>'}</td>
                    <td style="text-align:right">
                      ${c.status === 'draft' ? `<button class="btn small send-camp" data-id="${c.id}">Send</button>` : ''}
                      <button class="btn ghost small del-camp" data-id="${c.id}">✕</button></td>
                  </tr>`
                )
                .join('')}</tbody></table>`
            : '<div class="empty"><div class="big">📣</div>No campaigns yet</div>'
        }
      </div>
    </div>
    <div class="card">
      <div class="card-title">Email Templates</div>
      <div class="card-body">
        <p class="muted" style="margin-bottom:10px">Merge fields: <code class="inline">{{first_name}}</code> <code class="inline">{{last_name}}</code> <code class="inline">{{email}}</code> <code class="inline">{{phone}}</code></p>
        ${
          templates.length
            ? templates
                .map(
                  (t) => `<div class="block-item">
                    <div class="b-head"><span>${esc(t.name)}</span>
                      <span><button class="btn secondary small edit-tpl" data-id="${t.id}">Edit</button>
                      <button class="btn ghost small del-tpl" data-id="${t.id}">✕</button></span></div>
                    <div><strong style="font-size:13px">${esc(t.subject)}</strong></div>
                    <div class="muted" style="font-size:12px;white-space:pre-wrap">${esc(t.body.slice(0, 140))}${t.body.length > 140 ? '…' : ''}</div>
                  </div>`
                )
                .join('')
            : '<div class="empty">No templates yet</div>'
        }
      </div>
    </div>
  </div>`;

  function templateModal(tpl = null) {
    const modal = openModal(`
      <h2>${tpl ? 'Edit' : 'New'} Email Template</h2>
      <form id="tpl-form">
        <label class="field"><span class="label">Name</span><input class="input" name="name" required value="${esc(tpl?.name || '')}"></label>
        <label class="field"><span class="label">Subject</span><input class="input" name="subject" value="${esc(tpl?.subject || '')}"></label>
        <label class="field"><span class="label">Body</span><textarea class="input" name="body" rows="8">${esc(tpl?.body || '')}</textarea></label>
        <div class="modal-actions">
          <button type="button" class="btn secondary" id="cancel">Cancel</button>
          <button class="btn">Save</button>
        </div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#tpl-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        if (tpl) await api(`/marketing/templates/${tpl.id}`, { method: 'PUT', body: formData(e.target) });
        else await api('/marketing/templates', { method: 'POST', body: formData(e.target) });
        closeOverlay();
        renderMarketing(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  view.querySelector('#new-template').addEventListener('click', () => templateModal());
  view.querySelectorAll('.edit-tpl').forEach((b) =>
    b.addEventListener('click', () => templateModal(templates.find((t) => t.id === Number(b.dataset.id))))
  );
  view.querySelectorAll('.del-tpl').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete template?')) return;
      await api(`/marketing/templates/${b.dataset.id}`, { method: 'DELETE' });
      renderMarketing(view);
    })
  );

  view.querySelector('#new-campaign').addEventListener('click', () => {
    const modal = openModal(`
      <h2>New Campaign</h2>
      <form id="camp-form">
        <label class="field"><span class="label">Name</span><input class="input" name="name" required placeholder="June Promo Blast"></label>
        <div class="form-row">
          <label class="field"><span class="label">Channel</span><select class="input" name="channel" id="channel-sel">
            <option value="email">Email</option><option value="sms">SMS</option></select></label>
          <label class="field"><span class="label">Audience</span><select class="input" name="tag_filter">
            <option value="">All contacts</option>
            ${tags.map((t) => `<option value="${esc(t.tag)}">tag: ${esc(t.tag)} (${t.count})</option>`).join('')}
          </select></label>
        </div>
        ${templates.length ? `<label class="field"><span class="label">Start from template</span><select class="input" id="tpl-sel">
          <option value="">— none —</option>
          ${templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
        </select></label>` : ''}
        <label class="field" id="subject-field"><span class="label">Subject</span><input class="input" name="subject"></label>
        <label class="field"><span class="label">Message</span><textarea class="input" name="body" rows="7" required placeholder="Hi {{first_name}}, …"></textarea></label>
        <div class="modal-actions">
          <button type="button" class="btn secondary" id="cancel">Cancel</button>
          <button class="btn">Save as Draft</button>
        </div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#channel-sel').addEventListener('change', (e) => {
      modal.querySelector('#subject-field').style.display = e.target.value === 'sms' ? 'none' : 'block';
    });
    modal.querySelector('#tpl-sel')?.addEventListener('change', (e) => {
      const tpl = templates.find((t) => t.id === Number(e.target.value));
      if (tpl) {
        modal.querySelector('[name=subject]').value = tpl.subject;
        modal.querySelector('[name=body]').value = tpl.body;
      }
    });
    modal.querySelector('#camp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/marketing/campaigns', { method: 'POST', body: formData(e.target) });
        closeOverlay();
        toast('Campaign saved as draft');
        renderMarketing(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  view.querySelectorAll('.send-camp').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Send this campaign now to all matching contacts?')) return;
      try {
        const res = await api(`/marketing/campaigns/${b.dataset.id}/send`, { method: 'POST' });
        toast(`Campaign sent to ${res.recipient_count} contact(s)`);
        renderMarketing(view);
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
  view.querySelectorAll('.del-camp').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete campaign?')) return;
      await api(`/marketing/campaigns/${b.dataset.id}`, { method: 'DELETE' });
      renderMarketing(view);
    })
  );
}
