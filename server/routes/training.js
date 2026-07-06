// Training / onboarding (Phase 4). Recursive like the rest of the platform:
// a course authored by a tenant is visible to that tenant and everyone below
// it, so Upcross ships a "how to use the platform" course to its clients, and a
// client that resells can author its own courses for its clients. Videos are
// YouTube embeds — we store only the video id, never files.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, ancestorIds } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Accepts a raw id or any common YouTube URL and returns the 11-char video id.
function parseYouTubeId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : '';
}

// The set of tenants whose courses the current scope may consume: itself + all
// ancestors up to the root.
function visibleOwners(req) {
  return ancestorIds(req.user.agency_id);
}

async function loadVisibleCourse(req, id) {
  const course = await db.get('SELECT * FROM courses WHERE id = ?', [id]);
  if (!course) return null;
  const owners = await visibleOwners(req);
  return owners.includes(Number(course.agency_id)) ? course : null;
}

function requireAdmin(req, res) {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin role required' });
    return false;
  }
  return true;
}

// List courses: `available` (consume — self + ancestors) and `authored`
// (edit — owned by the current scope), each with lesson + progress counts.
router.get('/courses', async (req, res) => {
  const owners = await visibleOwners(req);
  const placeholders = owners.map(() => '?').join(',');
  const courses = await db.all(
    `SELECT c.*, a.name AS owner_name FROM courses c JOIN agencies a ON a.id = c.agency_id
     WHERE c.agency_id IN (${placeholders}) ORDER BY c.position, c.id`,
    owners
  );
  const withCounts = [];
  for (const c of courses) {
    const { lessons } = await db.get('SELECT COUNT(*)::int AS lessons FROM lessons WHERE course_id = ?', [c.id]);
    const { done } = await db.get(
      `SELECT COUNT(*)::int AS done FROM course_progress p
       JOIN lessons l ON l.id = p.lesson_id
       WHERE l.course_id = ? AND p.user_id = ?`,
      [c.id, req.user.id]
    );
    withCounts.push({
      ...c,
      owned: Number(c.agency_id) === Number(req.user.agency_id),
      lesson_count: lessons,
      completed_count: done,
    });
  }
  res.json({
    available: withCounts.filter((c) => c.is_published || c.owned),
    authored: withCounts.filter((c) => c.owned),
  });
});

// One course with its lessons + per-lesson completion for the current user.
router.get('/courses/:id', async (req, res) => {
  const course = await loadVisibleCourse(req, req.params.id);
  if (!course) return res.status(404).json({ error: 'Curso no encontrado' });
  const owned = Number(course.agency_id) === Number(req.user.agency_id);
  // Enroll the learner on first view so drip scheduling has a start date.
  await db.run(
    'INSERT INTO course_enrollments (user_id, course_id) VALUES (?, ?) ON CONFLICT (user_id, course_id) DO NOTHING',
    [req.user.id, course.id]
  );
  const enrollment = await db.get('SELECT enrolled_at FROM course_enrollments WHERE user_id = ? AND course_id = ?', [req.user.id, course.id]);
  const enrolledMs = enrollment ? new Date(enrollment.enrolled_at).getTime() : Date.now();

  const lessons = await db.all('SELECT * FROM lessons WHERE course_id = ? ORDER BY position, id', [course.id]);
  const done = await db.all(
    `SELECT p.lesson_id FROM course_progress p JOIN lessons l ON l.id = p.lesson_id
     WHERE l.course_id = ? AND p.user_id = ?`,
    [course.id, req.user.id]
  );
  const doneSet = new Set(done.map((d) => d.lesson_id));
  const nowMs = Date.now();
  const shaped = lessons.map((l) => {
    let quiz = null;
    try { quiz = l.quiz ? JSON.parse(l.quiz) : null; } catch { quiz = null; }
    // Drip: a lesson unlocks drip_days after enrollment (admins see everything).
    const unlockMs = enrolledMs + (Number(l.drip_days) || 0) * 86_400_000;
    const locked = !owned && Number(l.drip_days) > 0 && nowMs < unlockMs;
    const hasQuiz = Boolean(quiz && Array.isArray(quiz.questions) && quiz.questions.length);
    return {
      ...l,
      completed: doneSet.has(l.id),
      locked,
      unlock_at: locked ? new Date(unlockMs).toISOString() : null,
      has_quiz: hasQuiz,
      // Owners get the full quiz (with answers) to edit; learners get it without the answer key.
      quiz: owned ? quiz : (hasQuiz ? { pass_score: quiz.pass_score || 0, questions: quiz.questions.map((q) => ({ q: q.q, options: q.options })) } : null),
    };
  });
  const allDone = shaped.length > 0 && shaped.every((l) => l.completed);
  res.json({ ...course, owned, lessons: shaped, all_completed: allDone });
});

router.post('/courses', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { title, description } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title es obligatorio' });
  const id = await db.insert(
    'INSERT INTO courses (agency_id, title, description, is_published, position) VALUES (?, ?, ?, ?, ?)',
    [req.user.agency_id, title, description || '', req.body?.is_published === 0 ? 0 : 1, Number(req.body?.position) || 0]
  );
  res.status(201).json(await db.get('SELECT * FROM courses WHERE id = ?', [id]));
});

// Only the owning tenant can edit its course.
async function loadOwnedCourse(req, id) {
  return db.get('SELECT * FROM courses WHERE id = ? AND agency_id = ?', [id, req.user.agency_id]);
}

router.put('/courses/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const course = await loadOwnedCourse(req, req.params.id);
  if (!course) return res.status(404).json({ error: 'Curso no encontrado' });
  const b = req.body || {};
  await db.run('UPDATE courses SET title = ?, description = ?, is_published = ?, position = ?, certificate = ? WHERE id = ?', [
    b.title || course.title,
    b.description ?? course.description,
    b.is_published === undefined ? course.is_published : b.is_published ? 1 : 0,
    b.position === undefined ? course.position : Number(b.position) || 0,
    b.certificate === undefined ? course.certificate : b.certificate ? 1 : 0,
    course.id,
  ]);
  res.json(await db.get('SELECT * FROM courses WHERE id = ?', [course.id]));
});

router.delete('/courses/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const course = await loadOwnedCourse(req, req.params.id);
  if (!course) return res.status(404).json({ error: 'Curso no encontrado' });
  await db.run('DELETE FROM courses WHERE id = ?', [course.id]);
  res.json({ ok: true });
});

router.post('/courses/:id/lessons', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const course = await loadOwnedCourse(req, req.params.id);
  if (!course) return res.status(404).json({ error: 'Curso no encontrado' });
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title es obligatorio' });
  const { n } = await db.get('SELECT COUNT(*)::int AS n FROM lessons WHERE course_id = ?', [course.id]);
  const quiz = req.body?.quiz ? (typeof req.body.quiz === 'string' ? req.body.quiz : JSON.stringify(req.body.quiz)) : '';
  const id = await db.insert(
    'INSERT INTO lessons (course_id, title, body, youtube_id, position, section, quiz, drip_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [course.id, title, req.body?.body || '', parseYouTubeId(req.body?.youtube_url || req.body?.youtube_id), req.body?.position === undefined ? n : Number(req.body.position) || 0, req.body?.section || '', quiz, Number(req.body?.drip_days) || 0]
  );
  res.status(201).json(await db.get('SELECT * FROM lessons WHERE id = ?', [id]));
});

// Lesson edits/deletes are guarded by walking back to the owning course.
async function loadOwnedLesson(req, id) {
  return db.get(
    'SELECT l.* FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND c.agency_id = ?',
    [id, req.user.agency_id]
  );
}

router.put('/lessons/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const lesson = await loadOwnedLesson(req, req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lección no encontrada' });
  const b = req.body || {};
  const yt = b.youtube_url !== undefined || b.youtube_id !== undefined
    ? parseYouTubeId(b.youtube_url || b.youtube_id)
    : lesson.youtube_id;
  const quiz = b.quiz !== undefined ? (typeof b.quiz === 'string' ? b.quiz : JSON.stringify(b.quiz)) : lesson.quiz;
  await db.run('UPDATE lessons SET title = ?, body = ?, youtube_id = ?, position = ?, section = ?, quiz = ?, drip_days = ? WHERE id = ?', [
    b.title || lesson.title,
    b.body ?? lesson.body,
    yt,
    b.position === undefined ? lesson.position : Number(b.position) || 0,
    b.section ?? lesson.section,
    quiz,
    b.drip_days === undefined ? lesson.drip_days : Number(b.drip_days) || 0,
    lesson.id,
  ]);
  res.json(await db.get('SELECT * FROM lessons WHERE id = ?', [lesson.id]));
});

router.delete('/lessons/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const lesson = await loadOwnedLesson(req, req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lección no encontrada' });
  await db.run('DELETE FROM lessons WHERE id = ?', [lesson.id]);
  res.json({ ok: true });
});

// Mark a (visible) lesson complete / incomplete for the current user.
router.post('/lessons/:id/complete', async (req, res) => {
  const lesson = await db.get('SELECT * FROM lessons WHERE id = ?', [req.params.id]);
  if (!lesson) return res.status(404).json({ error: 'Lección no encontrada' });
  if (!(await loadVisibleCourse(req, lesson.course_id))) return res.status(404).json({ error: 'Lección no encontrada' });
  await db.run(
    'INSERT INTO course_progress (user_id, lesson_id) VALUES (?, ?) ON CONFLICT (user_id, lesson_id) DO NOTHING',
    [req.user.id, lesson.id]
  );
  res.json({ ok: true, completed: true });
});

router.delete('/lessons/:id/complete', async (req, res) => {
  await db.run('DELETE FROM course_progress WHERE user_id = ? AND lesson_id = ?', [req.user.id, req.params.id]);
  res.json({ ok: true, completed: false });
});

// Submit quiz answers. Grades against the stored answer key; on pass, the lesson
// is marked complete. Body: { answers: [selectedOptionIndex, ...] }.
router.post('/lessons/:id/quiz', async (req, res) => {
  const lesson = await db.get('SELECT * FROM lessons WHERE id = ?', [req.params.id]);
  if (!lesson) return res.status(404).json({ error: 'Lección no encontrada' });
  if (!(await loadVisibleCourse(req, lesson.course_id))) return res.status(404).json({ error: 'Lección no encontrada' });
  let quiz = null;
  try { quiz = lesson.quiz ? JSON.parse(lesson.quiz) : null; } catch { quiz = null; }
  if (!quiz || !Array.isArray(quiz.questions) || !quiz.questions.length)
    return res.status(400).json({ error: 'Esta lección no tiene cuestionario' });
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  let correct = 0;
  quiz.questions.forEach((q, i) => { if (Number(answers[i]) === Number(q.answer)) correct++; });
  const score = Math.round((correct / quiz.questions.length) * 100);
  const passScore = Number(quiz.pass_score) || 0;
  const passed = score >= passScore;
  if (passed) {
    await db.run(
      'INSERT INTO course_progress (user_id, lesson_id) VALUES (?, ?) ON CONFLICT (user_id, lesson_id) DO NOTHING',
      [req.user.id, lesson.id]
    );
  }
  res.json({ score, correct, total: quiz.questions.length, passed, pass_score: passScore });
});

// Completion certificate (HTML) — only when the learner finished every lesson
// and the course has certificates enabled.
router.get('/courses/:id/certificate', async (req, res) => {
  const course = await loadVisibleCourse(req, req.params.id);
  if (!course) return res.status(404).send('Curso no encontrado');
  if (!course.certificate) return res.status(400).send('Este curso no emite certificado');
  const lessons = await db.all('SELECT id FROM lessons WHERE course_id = ?', [course.id]);
  const { n } = await db.get(
    `SELECT COUNT(*)::int AS n FROM course_progress p JOIN lessons l ON l.id = p.lesson_id
     WHERE l.course_id = ? AND p.user_id = ?`,
    [course.id, req.user.id]
  );
  if (!lessons.length || n < lessons.length) return res.status(403).send('Completa todas las lecciones para obtener el certificado');
  const agency = await db.get('SELECT name FROM agencies WHERE id = ?', [course.agency_id]);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Certificado — ${esc(course.title)}</title>
    <style>body{font-family:Georgia,serif;background:#f1f5f9;margin:0;padding:24px;display:flex;justify-content:center}
    .cert{background:#fff;max-width:720px;width:100%;border:10px solid #4f46e5;border-radius:8px;padding:56px 48px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.12)}
    h1{font-size:2rem;letter-spacing:2px;color:#4f46e5;margin:0 0 6px}.sub{color:#64748b;letter-spacing:3px;text-transform:uppercase;font-size:12px}
    .name{font-size:1.8rem;margin:28px 0 6px;border-bottom:2px solid #e5e7eb;display:inline-block;padding:0 24px 8px}
    .course{font-size:1.3rem;color:#111827;margin:18px 0}.foot{margin-top:36px;color:#64748b;font-size:13px}
    @media print{body{background:#fff}.cert{box-shadow:none}}</style></head>
    <body><div class="cert">
      <div class="sub">Certificado de finalización</div>
      <h1>${esc(agency ? agency.name : 'Academia')}</h1>
      <p style="color:#64748b">Este certificado acredita que</p>
      <div class="name">${esc(req.user.name)}</div>
      <p style="color:#64748b">ha completado con éxito el curso</p>
      <div class="course">“${esc(course.title)}”</div>
      <div class="foot">Emitido el ${new Date().toLocaleDateString('es-ES')} · <a href="#" onclick="window.print();return false">Imprimir / Guardar PDF</a></div>
    </div></body></html>`);
});

// Publish a course as a public, client-facing academy page (/course/<token>).
router.post('/courses/:id/publish', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const course = await loadOwnedCourse(req, req.params.id);
  if (!course) return res.status(404).json({ error: 'Curso no encontrado' });
  const token = course.public_token || crypto.randomBytes(9).toString('hex');
  await db.run('UPDATE courses SET is_public = 1, public_token = ? WHERE id = ?', [token, course.id]);
  res.json({ ok: true, public_token: token });
});

router.post('/courses/:id/unpublish', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const course = await loadOwnedCourse(req, req.params.id);
  if (!course) return res.status(404).json({ error: 'Curso no encontrado' });
  await db.run('UPDATE courses SET is_public = 0 WHERE id = ?', [course.id]);
  res.json({ ok: true });
});

module.exports = router;
