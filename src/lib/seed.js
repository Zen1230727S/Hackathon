/**
 * Fictional demo data for the prototype.
 *
 * IMPORTANT: every name, roll number and attendance figure below is INVENTED.
 * No real student, classmate or biometric data is used anywhere in this app.
 *
 * The seed is fully deterministic (seeded PRNG + fixed target counts) so the
 * "Demo Reset" button always restores the exact same, known-good demo state.
 */

import { avatarDataUri, addDays, todayISO, uid } from './utils.js';

export const SEED_VERSION = 3;

/** Tiny deterministic PRNG (mulberry32) so resets are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLASSES = [
  { id: 'cls_cse_a', name: 'CSE - A', subject: 'Data Structures', semester: 'Semester 3', room: 'Block B · Room 204' },
  { id: 'cls_cse_b', name: 'CSE - B', subject: 'Data Structures', semester: 'Semester 3', room: 'Block B · Room 205' },
  { id: 'cls_it_a', name: 'IT - A', subject: 'Web Technology', semester: 'Semester 3', room: 'Block C · Room 101' },
];

/**
 * Student roster. `pastPresents` = how many of the past sessions the student
 * attended, `todayStatus` = the state of today's session for that student
 * ('present' | 'absent' | null = not marked yet).
 */
const ROSTER = {
  cls_cse_a: [
    ['Aarav Sharma', 22, 'present'],
    ['Diya Patel', 21, 'present'],
    ['Rahul Verma', 16, 'absent'],
    ['Ananya Iyer', 20, 'present'],
    ['Vihaan Reddy', 17, 'present'],
    ['Ishita Nair', 14, 'absent'],
    ['Kabir Singh', 19, 'present'],
    ['Meera Joshi', 23, 'present'],
    ['Arjun Das', 15, null],
    ['Sneha Kulkarni', 18, null],
    ['Rohan Gupta', 21, null],
    ['Tanvi Menon', 12, null],
  ],
  cls_cse_b: [
    ['Aditya Rao', 22, 'present'],
    ['Priya Deshmukh', 21, 'present'],
    ['Nikhil Chauhan', 16, 'present'],
    ['Riya Banerjee', 19, 'present'],
    ['Sameer Khan', 17, null],
    ['Neha Pillai', 20, null],
    ['Yash Thakur', 13, null],
    ['Aditi Bhatt', 21, null],
    ['Kunal Mehta', 18, null],
    ['Pooja Shetty', 15, null],
  ],
  cls_it_a: [
    ['Harsh Vardhan', 22, null],
    ['Lavanya Krishnan', 20, null],
    ['Devansh Malhotra', 15, null],
    ['Nisha Agarwal', 18, null],
    ['Omkar Patil', 12, null],
    ['Shreya Ghosh', 21, null],
    ['Farhan Ali', 17, null],
    ['Kavya Nambiar', 19, null],
    ['Manav Saxena', 16, null],
    ['Ira Dutta', 23, null],
  ],
};

const ROLL_PREFIX = { cls_cse_a: 'CS23A', cls_cse_b: 'CS23B', cls_it_a: 'IT23A' };

/** Alternating 2 / 3 day gaps going backwards, so dates look like a real timetable. */
function buildDateList(endDate, count) {
  const dates = [endDate];
  let cursor = endDate;
  const steps = [2, 3];
  for (let i = 1; i < count; i += 1) {
    cursor = addDays(cursor, -steps[(i - 1) % steps.length]);
    dates.push(cursor);
  }
  return dates;
}

function pickAttendanceSet(sessionCount, presentCount, rng) {
  const indices = Array.from({ length: sessionCount }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return new Set(indices.slice(0, Math.max(0, Math.min(presentCount, sessionCount))));
}

function isoAt(dateISO, hour, minute) {
  return new Date(`${dateISO}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`).toISOString();
}

/**
 * Builds a complete, self-consistent demo state.
 * @returns {object} the whole app state (classes, students, sessions, attendance, activity)
 */
export function buildSeedState() {
  const today = todayISO();
  const rng = mulberry32(20260214);

  const classes = CLASSES.map((c) => ({ ...c, createdAt: new Date().toISOString() }));
  const students = [];
  const sessions = [];
  const attendance = [];
  const activity = [];

  // ---- Sessions -----------------------------------------------------------
  // CSE-A and CSE-B meet today and share the same past dates (24 sessions each).
  // IT-A has no session today (23 sessions) which keeps "today" realistic.
  const datesWithToday = buildDateList(today, 24);
  const datesWithoutToday = buildDateList(addDays(today, -1), 23);

  const sessionPlan = {
    cls_cse_a: { dates: datesWithToday, hasToday: true, startHour: 10 },
    cls_cse_b: { dates: datesWithToday, hasToday: true, startHour: 11 },
    cls_it_a: { dates: datesWithoutToday, hasToday: false, startHour: 14 },
  };

  for (const [classId, plan] of Object.entries(sessionPlan)) {
    plan.dates.forEach((date, index) => {
      const isToday = date === today && plan.hasToday;
      sessions.push({
        id: `ses_${classId}_${date.replace(/-/g, '')}`,
        classId,
        date,
        startTime: `${String(plan.startHour).padStart(2, '0')}:00`,
        label: index === 0 ? 'Latest session' : `Session ${plan.dates.length - index}`,
        status: isToday ? 'open' : 'closed',
        createdAt: isoAt(date, plan.startHour, 0),
        closedAt: isToday ? null : isoAt(date, plan.startHour + 1, 0),
      });
    });
  }

  // ---- Students + attendance ---------------------------------------------
  for (const [classId, roster] of Object.entries(ROSTER)) {
    const plan = sessionPlan[classId];
    const classSessions = sessions
      .filter((s) => s.classId === classId)
      .sort((a, b) => (a.date < b.date ? -1 : 1)); // oldest first
    const pastSessions = classSessions.filter((s) => s.date !== today);
    const todaySession = classSessions.find((s) => s.date === today) || null;

    roster.forEach(([name, pastPresents, todayStatus], studentIndex) => {
      const studentId = `stu_${classId.replace('cls_', '')}_${String(studentIndex + 1).padStart(2, '0')}`;
      students.push({
        id: studentId,
        classId,
        name,
        rollNo: `${ROLL_PREFIX[classId]}-${String(studentIndex + 1).padStart(3, '0')}`,
        email: `${name.split(' ')[0].toLowerCase()}.${String(studentIndex + 1).padStart(2, '0')}@demo.college`,
        phone: `+91 90000 ${String(10000 + studentIndex * 137).slice(0, 5)}`,
        photo: avatarDataUri(name),
        descriptor: null,          // filled in by the Face Enrollment page
        descriptorSamples: 0,
        enrolledAt: null,
        createdAt: new Date().toISOString(),
      });

      const studentRng = mulberry32(1000 + studentIndex * 37 + classId.length * 91);
      const attendedIndices = pickAttendanceSet(pastSessions.length, pastPresents, studentRng);

      pastSessions.forEach((session, index) => {
        if (!attendedIndices.has(index)) return;
        const isLate = studentRng() < 0.11;
        attendance.push({
          id: uid('att'),
          sessionId: session.id,
          studentId,
          classId,
          date: session.date,
          status: isLate ? 'late' : 'present',
          method: studentRng() < 0.32 ? 'face' : 'manual',
          confidence: null,
          markedAt: isoAt(session.date, plan.startHour, 4 + Math.floor(studentRng() * 20)),
        });
      });

      if (todaySession && todayStatus) {
        attendance.push({
          id: uid('att'),
          sessionId: todaySession.id,
          studentId,
          classId,
          date: today,
          status: todayStatus === 'present' ? (studentRng() < 0.15 ? 'late' : 'present') : 'absent',
          method: 'manual',
          confidence: null,
          markedAt: isoAt(today, plan.startHour, 5 + Math.floor(studentRng() * 25)),
        });
      }
    });
  }

  // ---- Recent activity feed ----------------------------------------------
  const feedSeed = [
    ['face', 'Face attendance session started for CSE - A · Data Structures'],
    ['present', 'Meera Joshi marked present via face recognition (CSE - A)'],
    ['present', 'Kabir Singh marked present manually (CSE - A)'],
    ['absent', 'Rahul Verma marked absent (CSE - A)'],
    ['present', 'Aditya Rao marked present via face recognition (CSE - B)'],
    ['info', 'Attendance report exported for IT - A · Web Technology'],
    ['present', 'Ira Dutta marked present manually (IT - A)'],
    ['info', 'Low-attendance warning list refreshed (threshold 75%)'],
  ];
  feedSeed.forEach(([type, message], index) => {
    activity.push({
      id: uid('act'),
      at: new Date(Date.now() - (index * 17 + 4) * 60000).toISOString(),
      type,
      message,
      studentId: null,
      sessionId: null,
    });
  });

  return {
    meta: {
      version: SEED_VERSION,
      appName: 'Smart Attendance Management System',
      seededAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      demo: true,
    },
    settings: {
      schoolName: 'Sunrise Institute of Technology',
      teacher: { name: 'Prof. Meera Nair', email: 'meera.nair@demo.college' },
      lowAttendanceThreshold: 75,
      matchThreshold: 0.5,
      activeClassId: 'cls_cse_a',
    },
    classes,
    students,
    sessions,
    attendance,
    activity,
  };
}