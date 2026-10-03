/**
 * Single source of truth for the whole application.
 *
 * The store owns one plain JavaScript object ("the state") that holds classes,
 * students, sessions, attendance records, activity and settings. Every page
 * reads from and writes to this one object, so the dashboard, students list,
 * face attendance, analytics and reports can never disagree with each other.
 *
 * Persistence: localStorage (local-first, no backend needed).
 *   save()  -> serialises the state to localStorage
 *   reset() -> restores the fictional demo data from seed.js
 */

import { buildSeedState, SEED_VERSION } from './seed.js';
import {
  attendancePercent,
  buildRecoveryPlan,
  riskLevel,
  DEFAULT_THRESHOLD,
} from './analytics.js';
import { uid, todayISO, toISODate } from './utils.js';

const STORAGE_KEY = 'smart-attendance-state-v1';

/** @type {object|null} */
let state = null;
const listeners = new Set();

/* ------------------------------ load / persist ---------------------------- */

function normalise(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.students) || !Array.isArray(raw.classes)) return null;
  if (raw.meta?.version !== SEED_VERSION) return null; // schema changed -> reseed
  // Defaults so older/partial states never crash a view.
  raw.sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
  raw.attendance = Array.isArray(raw.attendance) ? raw.attendance : [];
  raw.activity = Array.isArray(raw.activity) ? raw.activity : [];
  raw.notifications = Array.isArray(raw.notifications) ? raw.notifications : [];
  raw.settings = { lowAttendanceThreshold: DEFAULT_THRESHOLD, matchThreshold: 0.5, ...(raw.settings || {}) };
  raw.settings.teacher = raw.settings.teacher || { name: 'Teacher', email: 'teacher@demo.college' };
  return raw;
}

function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalise(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function save() {
  if (!state) return;
  state.meta.updatedAt = new Date().toISOString();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('[store] Could not persist state:', error);
  }
}

export function getState() {
  if (!state) {
    state = load() || buildSeedState();
    save();
  }
  return state;
}

/* --------------------------------- events --------------------------------- */

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notify every subscriber. Views call this after mutating data so the rest of
 * the UI (sidebar counters, dashboard, reports) refreshes consistently.
 */
export function emit(detail = {}) {
  for (const listener of listeners) {
    try {
      listener(getState(), detail);
    } catch (error) {
      console.error('[store] listener failed:', error);
    }
  }
}

function commit(detail) {
  save();
  emit(detail);
}

/* ------------------------------- basic lookups ---------------------------- */

export const getClasses = () => getState().classes;
export const getSettings = () => getState().settings;

export const getClass = (classId) => getState().classes.find((c) => c.id === classId) || null;

export const getStudents = () => getState().students;
export const getStudent = (studentId) => getState().students.find((s) => s.id === studentId) || null;

export const getStudentsByClass = (classId) =>
  getState().students
    .filter((s) => s.classId === classId)
    .sort((a, b) => a.rollNo.localeCompare(b.rollNo, undefined, { numeric: true }));

export const getSessions = () => getState().sessions;

export const getSessionsByClass = (classId) =>
  getState().sessions
    .filter((s) => s.classId === classId)
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

export const getSession = (sessionId) => getState().sessions.find((s) => s.id === sessionId) || null;

export function getSessionForDate(classId, date) {
  return getState().sessions.find((s) => s.classId === classId && s.date === date) || null;
}

export const getAttendance = () => getState().attendance;

export function getAttendanceForSession(sessionId) {
  return getState().attendance.filter((a) => a.sessionId === sessionId);
}

export function getAttendanceForStudent(studentId) {
  return getState().attendance
    .filter((a) => a.studentId === studentId)
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
}

export function findAttendance(sessionId, studentId) {
  return getState().attendance.find((a) => a.sessionId === sessionId && a.studentId === studentId) || null;
}

export function getActivity(limit = 12) {
  return [...getState().activity]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}

/** Recent guardian absence notifications, newest first. */
export function getNotifications(limit = 25) {
  return [...(getState().notifications || [])]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}

/* --------------------------------- helpers -------------------------------- */

const ATTENDED_STATUSES = new Set(['present', 'late']);
const isAttended = (status) => ATTENDED_STATUSES.has(status);

/** Sessions that have already happened for a class (today counts as held). */
export function heldSessions(classId) {
  const today = todayISO();
  return getSessionsByClass(classId).filter((s) => s.date <= today);
}

/* ------------------------------- statistics ------------------------------- */

/**
 * Full attendance statistics for one student.
 * @returns {{attended:number, present:number, late:number, absent:number, total:number,
 *            percent:number, risk:string, sessions:Array<object>, plan:object,
 *            streak:number, latest:object|null}}
 */
export function studentStats(studentId, thresholdOverride) {
  const student = getStudent(studentId);
  const threshold = thresholdOverride ?? getSettings().lowAttendanceThreshold ?? DEFAULT_THRESHOLD;
  if (!student) {
    return {
      attended: 0, present: 0, late: 0, absent: 0, total: 0, percent: 0,
      risk: 'none', sessions: [], streak: 0, latest: null,
      plan: buildRecoveryPlan(0, 0, threshold),
    };
  }

  const records = getAttendanceForStudent(studentId); // newest first
  const pastRecords = records.filter((r) => r.date < todayISO() || r.status === 'absent');
  const present = records.filter((r) => r.status === 'present').length;
  const late = records.filter((r) => r.status === 'late').length;
  const attended = present + late;
  const total = heldSessions(student.classId).length;
  const absent = Math.max(0, total - attended);
  const percent = attendancePercent(attended, total);

  // Current streak of consecutive attended (non-absent) sessions, newest first.
  let streak = 0;
  for (const record of records) {
    if (isAttended(record.status)) streak += 1;
    else break;
  }

  // Per-session history (newest first) with a friendly status label.
  const recordBySession = new Map(records.map((r) => [r.sessionId, r]));
  const sessions = getSessionsByClass(student.classId)
    .filter((s) => s.date <= todayISO())
    .map((session) => {
      const record = recordBySession.get(session.id) || null;
      return {
        session,
        record,
        status: record ? record.status : 'absent',
        marked: Boolean(record),
      };
    });

  return {
    attended,
    present,
    late,
    absent,
    total,
    percent,
    risk: riskLevel(percent, threshold, total),
    sessions,
    streak,
    latest: records[0] || null,
    plan: buildRecoveryPlan(attended, total, threshold),
  };
}

/* ----------------------------- class statistics --------------------------- */

export function classStats(classId) {
  const students = getStudentsByClass(classId);
  const threshold = getSettings().lowAttendanceThreshold ?? DEFAULT_THRESHOLD;
  const list = students.map((student) => ({ student, stats: studentStats(student.id) }));
  const classAverage = list.length
    ? list.reduce((sum, item) => sum + item.stats.percent, 0) / list.length
    : 0;

  return {
    classId,
    students: list,
    count: students.length,
    classAverage,
    threshold,
    belowThreshold: list.filter((item) => item.stats.total > 0 && item.stats.percent < threshold),
    atRisk: list.filter((item) => item.stats.risk === 'at-risk'),
    perfect: list.filter((item) => item.stats.total > 0 && item.stats.percent >= 100),
    averagePercent: classAverage,
  };
}

/* ---------------------------- dashboard statistics ------------------------ */

/**
 * Everything the dashboard hero + stat cards need, computed from the same data
 * the rest of the app uses.
 */
export function dashboardStats() {
  const state = getState();
  const today = todayISO();
  const threshold = state.settings.lowAttendanceThreshold ?? DEFAULT_THRESHOLD;
  const students = state.students;
  const statsById = new Map(students.map((s) => [s.id, studentStats(s.id)]));

  const todaySessions = state.sessions.filter((s) => s.date === today);
  const todaySessionIds = new Set(todaySessions.map((s) => s.id));
  const todayRecords = state.attendance.filter((r) => todaySessionIds.has(r.sessionId));
  const todayPresent = new Set(todayRecords.filter((r) => isAttended(r.status)).map((r) => r.studentId)).size;
  const todayAbsent = new Set(todayRecords.filter((r) => r.status === 'absent').map((r) => r.studentId)).size;

  // Students who have a class today but no record at all yet.
  const todayClassIds = new Set(todaySessions.map((s) => s.classId));
  const expectedToday = students.filter((s) => todayClassIds.has(s.classId));
  const todayUnmarked = expectedToday.length - todayPresent - todayAbsent;

  const overall = students.length
    ? [...statsById.values()].reduce((sum, s) => sum + s.percent, 0) / students.length
    : 0;

  const lowAttendance = students
    .map((student) => ({ student, stats: statsById.get(student.id) }))
    .filter((item) => item.stats.total > 0 && item.stats.percent < threshold)
    .sort((a, b) => a.stats.percent - b.stats.percent);

  const atRisk = students
    .map((student) => ({ student, stats: statsById.get(student.id) }))
    .filter((item) => item.stats.risk === 'at-risk');

  const totalRecords = state.attendance.length;
  const faceRecords = state.attendance.filter((r) => r.method === 'face').length;
  const enrolled = students.filter((s) => Array.isArray(s.descriptor) && s.descriptor.length).length;

  return {
    today,
    totalStudents: students.length,
    totalClasses: state.classes.length,
    totalSessions: state.sessions.length,
    todaySessions,
    todayPresent,
    todayAbsent,
    todayUnmarked,
    expectedToday: expectedToday.length,
    overallPercent: overall,
    lowAttendance,
    atRisk,
    threshold,
    totalRecords,
    faceRecords,
    enrolled,
    enrolledPercent: students.length ? (enrolled / students.length) * 100 : 0,
  };
}

/* ------------------------------ activity helpers -------------------------- */

function logActivity(type, message, extra = {}) {
  getState().activity.unshift({
    id: uid('act'),
    at: new Date().toISOString(),
    type,
    message,
    studentId: extra.studentId || null,
    sessionId: extra.sessionId || null,
  });
  // Keep the feed bounded.
  if (getState().activity.length > 200) getState().activity.length = 200;
}

/**
 * Create a local/demo guardian absence notification. Purely additive: it stores
 * its own record in state.notifications and never touches attendance data.
 */
function logNotification(record) {
  const state = getState();
  if (!Array.isArray(state.notifications)) state.notifications = [];
  state.notifications.unshift({
    id: uid('ntf'),
    at: new Date().toISOString(),
    type: 'absent',
    ...record,
  });
  // Keep the list bounded.
  if (state.notifications.length > 200) state.notifications.length = 200;
}

/* -------------------------------- mutations ------------------------------- */

/**
 * Build one guardian absence notification from data already on record.
 * Read-only w.r.t. attendance - it only writes to state.notifications.
 */
function notifyGuardianAbsence(student, session, method = 'manual') {
  const cls = getClass(student.classId);
  const guardianPhone = String(student.guardianPhone || '').trim();
  logNotification({
    studentId: student.id,
    sessionId: session.id,
    studentName: student.name,
    rollNo: student.rollNo,
    className: cls?.name || '',
    subject: cls?.subject || '',
    sessionLabel: session.label || '',
    date: session.date,
    status: 'absent',
    method,
    guardianName: String(student.guardianName || '').trim() || null,
    guardianPhone: guardianPhone || null,
    hasGuardianContact: Boolean(guardianPhone),
  });
}

/**
 * Record or update attendance for a student in a session.
 * Prevents duplicate rows for the same (session, student) pair.
 */
export function markAttendance({ sessionId, studentId, status = 'present', method = 'manual', confidence = null }) {
  const state = getState();
  const session = state.sessions.find((s) => s.id === sessionId);
  const student = state.students.find((s) => s.id === studentId);
  if (!session || !student) return { ok: false, reason: 'missing' };

  const existing = state.attendance.find((a) => a.sessionId === sessionId && a.studentId === studentId);

  if (status === null || status === 'unmarked') {
    if (!existing) return { ok: false, reason: 'not-marked' };
    state.attendance = state.attendance.filter((a) => a !== existing);
    logActivity('info', `Attendance cleared for ${student.name}`, { studentId, sessionId });
    commit({ type: 'attendance' });
    return { ok: true, removed: true };
  }

  if (existing) {
    // Duplicate prevention: update the existing record instead of adding a new one.
    existing.status = status;
    existing.method = method;
    existing.confidence = confidence;
    existing.markedAt = new Date().toISOString();
    logActivity(status === 'absent' ? 'absent' : 'present',
      `${student.name} changed to ${status}${method === 'face' ? ' via face recognition' : ' manually'}`,
      { studentId, sessionId });
    if (status === 'absent') notifyGuardianAbsence(student, session, method);
    commit({ type: 'attendance' });
    return { ok: true, updated: true };
  }

  state.attendance.push({
    id: uid('att'),
    sessionId,
    studentId,
    classId: student.classId,
    date: session.date,
    status,
    method,
    confidence,
    markedAt: new Date().toISOString(),
  });
  logActivity(status === 'absent' ? 'absent' : (method === 'face' ? 'face' : 'present'),
    `${student.name} marked ${status}${method === 'face' ? ' via face recognition' : ' manually'}`,
    { studentId, sessionId });
  if (status === 'absent') notifyGuardianAbsence(student, session, method);
  commit({ type: 'attendance' });
  return { ok: true, created: true };
}

export function markAllPresent(sessionId, exceptStudentIds = []) {
  const state = getState();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false };
  const skip = new Set(exceptStudentIds);
  let count = 0;
  for (const student of state.students.filter((s) => s.classId === session.classId)) {
    if (skip.has(student.id)) continue;
    const existing = state.attendance.find((a) => a.sessionId === sessionId && a.studentId === student.id);
    if (existing) {
      if (existing.status !== 'present') { existing.status = 'present'; existing.method = 'manual'; existing.markedAt = new Date().toISOString(); }
      continue;
    }
    state.attendance.push({
      id: uid('att'),
      sessionId,
      studentId: student.id,
      classId: session.classId,
      date: session.date,
      status: 'present',
      method: 'manual',
      confidence: null,
      markedAt: new Date().toISOString(),
    });
    count += 1;
  }
  logActivity('present', `Marked remaining students present for ${session.date}`, { sessionId });
  commit({ type: 'attendance' });
  return { ok: true, count };
}

/** Find an existing session for a class on a date, or create a new one. */
export function ensureSession(classId, date) {
  const state = getState();
  const existing = state.sessions.find((s) => s.classId === classId && s.date === date);
  if (existing) return existing;
  const session = {
    id: uid('ses'),
    classId,
    date,
    startTime: '09:00',
    label: 'New session',
    status: date === todayISO() ? 'open' : 'closed',
    createdAt: new Date().toISOString(),
    closedAt: date === todayISO() ? null : new Date().toISOString(),
  };
  state.sessions.push(session);
  logActivity('info', `Attendance session created for ${getClass(classId)?.name || classId} on ${date}`, { sessionId: session.id });
  commit({ type: 'session' });
  return session;
}

export function closeSession(sessionId) {
  const state = getState();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false };
  session.status = 'closed';
  session.closedAt = new Date().toISOString();
  logActivity('info', `Session closed for ${session.date}`, { sessionId });
  commit({ type: 'session' });
  return { ok: true };
}

export function reopenSession(sessionId) {
  const state = getState();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false };
  session.status = 'open';
  session.closedAt = null;
  logActivity('info', `Session reopened for ${session.date}`, { sessionId });
  commit({ type: 'session' });
  return { ok: true };
}

export function deleteSession(sessionId) {
  const state = getState();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false };
  state.sessions = state.sessions.filter((s) => s.id !== sessionId);
  state.attendance = state.attendance.filter((a) => a.sessionId !== sessionId);
  logActivity('info', `Session deleted for ${session.date}`, {});
  commit({ type: 'session' });
  return { ok: true };
}

/* ------------------------------ student admin ----------------------------- */

export function addStudent({ name, rollNo, classId, email = '', photo = null, guardianName = '', guardianPhone = '' }) {
  const state = getState();
  const cleanName = String(name || '').trim();
  if (!cleanName || !classId) return { ok: false, reason: 'invalid' };
  const student = {
    id: uid('stu'),
    classId,
    name: cleanName,
    rollNo: String(rollNo || '').trim() || `NEW-${state.students.length + 1}`,
    email: email || `${cleanName.split(' ')[0].toLowerCase()}@demo.college`,
    phone: '',
    guardianName: String(guardianName || '').trim(),
    guardianPhone: String(guardianPhone || '').trim(),
    photo,
    descriptor: null,
    descriptorSamples: 0,
    enrolledAt: null,
    createdAt: new Date().toISOString(),
  };
  state.students.push(student);
  logActivity('info', `${cleanName} added to ${getClass(classId)?.name || classId}`, { studentId: student.id });
  commit({ type: 'student' });
  return { ok: true, student };
}

export function updateStudent(studentId, patch) {
  const state = getState();
  const student = state.students.find((s) => s.id === studentId);
  if (!student) return { ok: false };
  Object.assign(student, patch);
  commit({ type: 'student' });
  return { ok: true, student };
}

export function deleteStudent(studentId) {
  const state = getState();
  const student = state.students.find((s) => s.id === studentId);
  if (!student) return { ok: false };
  state.students = state.students.filter((s) => s.id !== studentId);
  state.attendance = state.attendance.filter((a) => a.studentId !== studentId);
  logActivity('info', `${student.name} removed from the roster`, {});
  commit({ type: 'student' });
  return { ok: true };
}

export function addClass({ name, subject = '', semester = '', room = '' }) {
  const state = getState();
  const cleanName = String(name || '').trim();
  if (!cleanName) return { ok: false, reason: 'invalid' };
  const created = {
    id: uid('cls'),
    name: cleanName,
    subject,
    semester,
    room,
    createdAt: new Date().toISOString(),
  };
  state.classes.push(created);
  logActivity('info', `Class ${cleanName} created`, {});
  commit({ type: 'class' });
  return { ok: true, class: created };
}

/* ------------------------------- face enrollment -------------------------- */

/**
 * Associate a captured face descriptor (+ optional reference photo) with a
 * student. This is the demo "enrollment" step for the face attendance feature.
 */
export function enrollFace(studentId, descriptor, photoDataUri = null, samples = 1) {
  const state = getState();
  const student = state.students.find((s) => s.id === studentId);
  if (!student) return { ok: false, reason: 'missing' };
  if (!Array.isArray(descriptor) || !descriptor.length) return { ok: false, reason: 'no-descriptor' };
  student.descriptor = descriptor.map((n) => Math.round(n * 1e6) / 1e6);
  student.descriptorSamples = (student.descriptorSamples || 0) + samples;
  student.enrolledAt = new Date().toISOString();
  if (photoDataUri) student.photo = photoDataUri;
  logActivity('info', `${student.name}'s reference face enrolled for recognition`, { studentId });
  commit({ type: 'enrollment' });
  return { ok: true };
}

export function removeEnrollment(studentId) {
  const state = getState();
  const student = state.students.find((s) => s.id === studentId);
  if (!student) return { ok: false };
  student.descriptor = null;
  student.descriptorSamples = 0;
  student.enrolledAt = null;
  logActivity('info', `${student.name}'s face enrollment removed`, { studentId });
  commit({ type: 'enrollment' });
  return { ok: true };
}

/** Students that currently have a usable face descriptor. */
export function getEnrolledStudents(classId = null) {
  return getState().students.filter((s) => Array.isArray(s.descriptor) && s.descriptor.length && (!classId || s.classId === classId));
}

/* --------------------------------- settings ------------------------------- */

export function updateSettings(patch) {
  const state = getState();
  state.settings = { ...state.settings, ...patch };
  commit({ type: 'settings' });
  return state.settings;
}

export function setActiveClass(classId) {
  const state = getState();
  if (!state.classes.some((c) => c.id === classId)) return;
  state.settings.activeClassId = classId;
  save();
}

export const getActiveClassId = () => getState().settings.activeClassId || getState().classes[0]?.id || null;

/* ----------------------------------- reset -------------------------------- */

/** Restore the fictional demo dataset. This is what the "Demo Reset" button calls. */
export function resetDemo() {
  state = buildSeedState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  emit({ type: 'reset' });
  return state;
}

/** Wipe everything (used to demo the empty/onboarding state). */
export function clearAll() {
  const fresh = buildSeedState();
  fresh.students = [];
  fresh.sessions = [];
  fresh.attendance = [];
  fresh.activity = [];
  fresh.meta.seededAt = new Date().toISOString();
  state = fresh;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  emit({ type: 'reset' });
  return state;
}

export function exportStateJSON() {
  return JSON.stringify(getState(), null, 2);
}

export function importStateJSON(json) {
  const parsed = normalise(JSON.parse(json));
  if (!parsed) throw new Error('That file is not a valid Smart Attendance backup.');
  state = parsed;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  emit({ type: 'reset' });
  return state;
}

/** Expose date helper for views that need "today" consistently. */
export const currentDate = () => toISODate(new Date());