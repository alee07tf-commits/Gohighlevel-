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
  const lessons = await db.all('SELECT * FROM lessons WHERE course_id = ? ORDER BY position, id', [course.id]);
  const done = await db.all(
    `SELECT p.lesson_id FROM course_progress p JOIN lessons l ON l.id = p.lesson_id
     WHERE l.course_id = ? AND p.user_id = ?`,
    [course.id, req.user.id]
  );
  const doneSet = new Set(done.map((d) => d.lesson_id));
  res.json({
    ...course,
    owned: Number(course.agency_id) === Number(req.user.agency_id),
    lessons: lessons.map((l) => ({ ...l, completed: doneSet.has(l.id) })),
  });
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
  await db.run('UPDATE courses SET title = ?, description = ?, is_published = ?, position = ? WHERE id = ?', [
    b.title || course.title,
    b.description ?? course.description,
    b.is_published === undefined ? course.is_published : b.is_published ? 1 : 0,
    b.position === undefined ? course.position : Number(b.position) || 0,
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
  const id = await db.insert(
    'INSERT INTO lessons (course_id, title, body, youtube_id, position) VALUES (?, ?, ?, ?, ?)',
    [course.id, title, req.body?.body || '', parseYouTubeId(req.body?.youtube_url || req.body?.youtube_id), req.body?.position === undefined ? n : Number(req.body.position) || 0]
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
  await db.run('UPDATE lessons SET title = ?, body = ?, youtube_id = ?, position = ? WHERE id = ?', [
    b.title || lesson.title,
    b.body ?? lesson.body,
    yt,
    b.position === undefined ? lesson.position : Number(b.position) || 0,
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
