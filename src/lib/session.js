/**
 * Demo-only session helpers.
 *
 * This is a LOCAL HACKATHON PROTOTYPE. There is no backend, no database and no
 * real authentication. Sessions are a small marker kept in localStorage so the
 * app can remember who "signed in" while the tab is open. Do NOT treat this as
 * production-grade security.
 *
 * Two independent sessions:
 *   - teacher : { role: 'teacher', id, at }
 *   - student : { role: 'student', studentId, at }   <-- only the student id is stored
 */

const TEACHER_KEY = 'sam.session.teacher';
const STUDENT_KEY = 'sam.session.student';

/** Demo credentials (kept here so the login view reads them from one place). */
export const DEMO_TEACHER = { id: 'admin', password: 'admin123' };
export const DEMO_STUDENT_PASSWORD = 'student123';

function read(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore - demo only */
  }
}

function clear(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore - demo only */
  }
}

/* ------------------------------ teacher session --------------------------- */

export function getTeacherSession() {
  const value = read(TEACHER_KEY);
  return value && value.role === 'teacher' ? value : null;
}

export function setTeacherSession(id) {
  write(TEACHER_KEY, { role: 'teacher', id, at: new Date().toISOString() });
}

export function clearTeacherSession() {
  clear(TEACHER_KEY);
}

/* ------------------------------ student session --------------------------- */

/** Returns the stored student id (string) or null. */
export function getStudentSession() {
  const value = read(STUDENT_KEY);
  return value && value.role === 'student' && value.studentId ? value : null;
}

export function setStudentSession(studentId) {
  // Deliberately store ONLY the student id (plus a timestamp) - nothing else.
  write(STUDENT_KEY, { role: 'student', studentId, at: new Date().toISOString() });
}

export function clearStudentSession() {
  clear(STUDENT_KEY);
}

/** Clear everything (used by logout buttons). */
export function clearAllSessions() {
  clearTeacherSession();
  clearStudentSession();
}