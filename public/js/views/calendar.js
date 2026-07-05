import { api } from '../api.js';
import { esc, openModal, closeOverlay, formData, toast, fmtDate, fullName } from '../ui.js';
import { t } from '../i18n.js';

export async function renderCalendar(view) {
  const [calendars, appointments, team] = await Promise.all([
    api('/calendars'),
    api('/calendars/appointments/all'),
    api('/locations/team/users').catch(() => []),
  ]);
  const now = new Date().toISOString().slice(0, 19);
  const upcoming = appointments.filter((a) => a.starts_at >= now && a.status === 'confirmed');
  const past = appointments.filter((a) => a.starts_at < now || a.status !== 'confirmed');

  view.innerHTML = `
  <div class="page-header">
    <h1>${t('Calendario', 'Calendar')}</h1>
    <div class="spacer"></div>
    <button class="btn secondary" id="new-calendar">${t('+ Calendario de reservas', '+ Booking Calendar')}</button>
    <button class="btn" id="new-appt">${t('+ Cita', '+ Appointment')}</button>
  </div>
  <div class="grid-2">
    <div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">${t('Próximas', 'Upcoming')}</div>
        <div class="card-body" style="padding:0">
          ${upcoming.length ? upcoming.map(apptRow).join('') : `<div class="empty">${t('Sin citas próximas', 'No upcoming appointments')}</div>`}
        </div>
      </div>
      <div class="card">
        <div class="card-title">${t('Pasadas y canceladas', 'Past & Cancelled')}</div>
        <div class="card-body" style="padding:0">
          ${past.length ? past.slice(0, 15).map(apptRow).join('') : `<div class="empty">${t('Nada por aquí todavía', 'Nothing here yet')}</div>`}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">${t('Calendarios de reservas', 'Booking Calendars')}</div>
      <div class="card-body">
        <p class="muted" style="margin-bottom:12px">${t('Comparte estos enlaces públicos para que los clientes potenciales reserven por su cuenta. Cada reserva crea un contacto y puede activar automatizaciones.', 'Share these public links so leads can self-book. Every booking creates a contact and can fire automations.')}</p>
        ${
          calendars.length
            ? calendars
                .map(
                  (c) => `<div class="block-item">
                    <div class="b-head"><span>${esc(c.name)}</span>
                      <button class="btn ghost small del-cal" data-id="${c.id}">✕</button></div>
                    <div class="muted" style="font-size:12px">${c.duration_minutes} min · ${c.start_hour}:00–${c.end_hour}:00</div>
                    <div style="margin-top:6px"><a href="/book/${esc(c.slug)}" target="_blank"><code class="inline">/book/${esc(c.slug)}</code> ↗</a></div>
                  </div>`
                )
                .join('')
            : `<div class="empty">${t('Aún no hay calendarios de reservas', 'No booking calendars yet')}</div>`
        }
      </div>
    </div>
  </div>`;

  function apptRow(a) {
    const badge = { confirmed: 'green', cancelled: 'red', completed: 'gray', no_show: 'amber' }[a.status];
    const statusLabel = {
      confirmed: t('Confirmada', 'Confirmed'),
      completed: t('Completada', 'Completed'),
      cancelled: t('Cancelada', 'Cancelled'),
      no_show: t('No asistió', 'No-show'),
    }[a.status] || a.status.replace('_', ' ');
    return `<div class="appt-row appt-click" data-id="${a.id}" style="cursor:pointer">
      <div class="appt-time">${fmtDate(a.starts_at)}<div class="d">${esc(a.calendar_name)}</div></div>
      <div style="flex:1"><strong>${esc(a.title)}</strong>
        <div class="muted" style="font-size:12px">${a.contact_id ? esc(fullName(a)) : t('Sin contacto', 'No contact')}</div></div>
      <span class="badge ${badge}">${statusLabel}</span>
    </div>`;
  }

  view.querySelectorAll('.appt-click').forEach((row) =>
    row.addEventListener('click', () => {
      const appt = appointments.find((a) => a.id === Number(row.dataset.id));
      apptModal(appt);
    })
  );

  function apptModal(appt = null) {
    if (!calendars.length && !appt) return toast(t('Primero crea un calendario de reservas', 'Create a booking calendar first'), true);
    const statusLabels = {
      confirmed: t('Confirmada', 'Confirmed'),
      completed: t('Completada', 'Completed'),
      cancelled: t('Cancelada', 'Cancelled'),
      no_show: t('No asistió', 'No-show'),
    };
    const modal = openModal(`
      <h2>${appt ? t('Editar cita', 'Edit Appointment') : t('Nueva cita', 'New Appointment')}</h2>
      <form id="appt-form">
        <label class="field"><span class="label">${t('Título', 'Title')}</span><input class="input" name="title" required value="${esc(appt?.title || '')}"></label>
        ${appt ? '' : `<label class="field"><span class="label">${t('Calendario', 'Calendar')}</span><select class="input" name="calendar_id">
          ${calendars.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span class="label">${t('Correo del contacto (opcional — vincula o crea un contacto listo para conversar)', 'Contact email (optional — links or creates conversation-ready contact)')}</span>
          <input class="input" name="contact_email" type="email" placeholder="${t('correo de un contacto existente', 'existing contact email')}"></label>`}
        <div class="form-row">
          <label class="field"><span class="label">${t('Inicio', 'Start')}</span><input class="input" name="starts_at" type="datetime-local" required
            value="${appt?.starts_at ? appt.starts_at.slice(0, 16) : ''}"></label>
          <label class="field"><span class="label">${t('Fin', 'End')}</span><input class="input" name="ends_at" type="datetime-local"
            value="${appt?.ends_at ? appt.ends_at.slice(0, 16) : ''}"></label>
        </div>
        ${appt ? `<label class="field"><span class="label">${t('Estado', 'Status')}</span><select class="input" name="status">
          ${['confirmed', 'completed', 'cancelled', 'no_show'].map((s) => `<option value="${s}" ${appt.status === s ? 'selected' : ''}>${statusLabels[s]}</option>`).join('')}
        </select></label>` : ''}
        <div class="modal-actions">
          ${appt ? `<button type="button" class="btn danger" id="del">${t('Eliminar', 'Delete')}</button>` : ''}
          <button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
          <button class="btn">${appt ? t('Guardar', 'Save') : t('Crear', 'Create')}</button>
        </div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#del')?.addEventListener('click', async () => {
      if (!confirm(t('¿Eliminar la cita?', 'Delete appointment?'))) return;
      await api(`/calendars/appointments/${appt.id}`, { method: 'DELETE' });
      closeOverlay();
      renderCalendar(view);
    });
    modal.querySelector('#appt-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = formData(e.target);
      data.starts_at = data.starts_at ? data.starts_at + ':00' : '';
      data.ends_at = data.ends_at ? data.ends_at + ':00' : undefined;
      try {
        if (appt) {
          await api(`/calendars/appointments/${appt.id}`, { method: 'PUT', body: data });
        } else {
          let contact_id = null;
          if (data.contact_email) {
            const found = await api(`/contacts?q=${encodeURIComponent(data.contact_email)}&limit=1`);
            if (found[0]) contact_id = found[0].id;
            else {
              const created = await api('/contacts', { method: 'POST', body: { email: data.contact_email, source: 'calendar' } });
              contact_id = created.id;
            }
          }
          await api(`/calendars/${data.calendar_id}/appointments`, {
            method: 'POST',
            body: { title: data.title, starts_at: data.starts_at, ends_at: data.ends_at, contact_id },
          });
        }
        closeOverlay();
        renderCalendar(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  view.querySelector('#new-appt').addEventListener('click', () => apptModal());
  view.querySelector('#new-calendar').addEventListener('click', () => {
    const modal = openModal(`
      <h2>${t('Nuevo calendario de reservas', 'New Booking Calendar')}</h2>
      <form id="cal-form">
        <label class="field"><span class="label">${t('Nombre', 'Name')}</span><input class="input" name="name" required placeholder="${t('Consulta gratuita', 'Free Consultation')}"></label>
        <label class="field"><span class="label">${t('Descripción', 'Description')}</span><input class="input" name="description"></label>
        <div class="form-row">
          <label class="field"><span class="label">${t('Duración (min)', 'Duration (min)')}</span><input class="input" name="duration_minutes" type="number" value="30"></label>
          <label class="field"><span class="label">${t('Desde (hora)', 'From (hour)')}</span><input class="input" name="start_hour" type="number" value="9" min="0" max="23"></label>
          <label class="field"><span class="label">${t('Hasta (hora)', 'To (hour)')}</span><input class="input" name="end_hour" type="number" value="17" min="1" max="24"></label>
          <label class="field"><span class="label">${t('Plazas/hueco', 'Slots/spot')}</span><input class="input" name="capacity" type="number" value="1" min="1" title="${t('Más de 1 = reservas grupales (clases)', 'More than 1 = group bookings (classes)')}"></label>
        </div>
        <label class="field"><span class="label">${t('Recordatorio automático (horas antes de la cita, 0 = desactivado)', 'Automatic reminder (hours before the appointment, 0 = disabled)')}</span>
          <input class="input" name="reminder_hours" type="number" value="24" min="0"></label>
        ${team.length
          ? `<div class="field"><span class="label">${t('Round-robin: repartir reservas entre (opcional)', 'Round-robin: distribute bookings among (optional)')}</span>
              <div class="flex" style="flex-wrap:wrap;gap:10px">
                ${team.map((u) => `<label class="flex" style="font-size:13px;gap:5px"><input type="checkbox" class="assignee-cb" value="${u.id}"> ${esc(u.name)}</label>`).join('')}
              </div></div>`
          : ''}
        <div class="modal-actions">
          <button type="button" class="btn secondary" id="cancel">${t('Cancelar', 'Cancel')}</button>
          <button class="btn">${t('Crear', 'Create')}</button>
        </div>
      </form>`);
    modal.querySelector('#cancel').addEventListener('click', closeOverlay);
    modal.querySelector('#cal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const body = formData(e.target);
        body.assignees = [...modal.querySelectorAll('.assignee-cb:checked')].map((c) => Number(c.value));
        await api('/calendars', { method: 'POST', body });
        closeOverlay();
        toast(t('Calendario creado', 'Calendar created'));
        renderCalendar(view);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  view.querySelectorAll('.del-cal').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm(t('¿Eliminar este calendario y sus citas?', 'Delete this calendar and its appointments?'))) return;
      await api(`/calendars/${btn.dataset.id}`, { method: 'DELETE' });
      renderCalendar(view);
    })
  );
}
