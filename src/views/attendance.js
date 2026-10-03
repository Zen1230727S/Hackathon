/**
 * Class / session attendance view (the manual fallback that must always work).
 *
 * - pick a class/section
 * - pick an existing session or create one for a date
 * - mark each student present / late / absent
 * - duplicates are impossible: one record per (session, student)
 */

import {
  getClasses,
  getClass,
  getStudentsByClass,
  getSessionsByClass,
  getSession,
  getSessionForDate,
  getAttendanceForSession,
  markAttendance,
  markAllPresent,
  ensureSession,
  closeSession,
  reopenSession,
  deleteSession,
  getActiveClassId,
  setActiveClass,
  getState,
} from '../lib/store.js';
import {
  el, esc, todayISO, formatDate, toast, confirmDialog,
} from '../lib/utils.js';
import { cardHead, studentCell, emptyState, callout, classOptions, sessionOptions } from '../lib/ui.js';

/* Module-scope selection so it survives re-renders after a data change. */
const selection = { classId: null, sessionId: null, date: todayISO() };

export function render({ query }) {
  const classes = getClasses();
  if (!classes.length) {
    const empty = el('div', { class: 'card' });
    empty.innerHTML = `<div class="card-body">${emptyState('No classes yet', 'Restore the demo data from Settings to load fictional classes and students.', '🏫')}</div>`;
    return { title: 'Take Attendance', subtitle: 'No classes available', element: empty };
  }

  // URL query (?class=&session=) wins over the module-scope memory.
  const queryClass = query?.get('class');
  const querySession = query?.get('session');
  if (queryClass && classes.some((c) => c.id === queryClass)) selection.classId = queryClass;
  if (querySession && getSession(querySession)) {
    selection.sessionId = querySession;
    selection.classId = getSession(querySession).classId;
  }
  if (!selection.classId || !classes.some((c) => c.id === selection.classId)) {
    selection.classId = getActiveClassId() || classes[0].id;
  }

  const cls = getClass(selection.classId);
  const sessions = getSessionsByClass(selection.classId);
  if (!selection.sessionId || !sessions.some((s) => s.id === selection.sessionId)) {
    selection.sessionId = sessions[0]?.id || null;
  }

  const session = selection.sessionId ? getSession(selection.sessionId) : null;
  const students = getStudentsByClass(selection.classId);
  const records = session ? getAttendanceForSession(session.id) : [];
  const recordByStudent = new Map(records.map((r) => [r.studentId, r]));

  const presentCount = students.filter((s) => ['present', 'late'].includes(recordByStudent.get(s.id)?.status)).length;
  const absentCount = students.filter((s) => recordByStudent.get(s.id)?.status === 'absent').length;
  const unmarked = students.length - presentCount - absentCount;

  const root = el('div', { class: 'stack' });

  /* -------------------------------- Header -------------------------------- */
  root.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h2', { text: 'Take Attendance' }),
      el('p', { text: 'Manual attendance — always available, even if the camera fails.' }),
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', {
        class: 'btn btn-primary', type: 'button', html: '◉ Use Face Attendance',
        onclick: () => { window.location.hash = `#/face?class=${selection.classId}${session ? `&session=${session.id}` : ''}`; },
      }),
    ]),
  ]));

  /* ------------------------------- Selectors ------------------------------ */
  const picker = el('section', { class: 'card' });
  const pickerBody = el('div', { class: 'card-body' });
  pickerBody.innerHTML = `
    <div class="toolbar">
      <div class="field grow" style="min-width:220px">
        <label for="attClass">Class / Section</label>
        <select id="attClass">${classOptions(classes, selection.classId)}</select>
      </div>
      <div class="field grow" style="min-width:220px">
        <label for="attSession">Attendance session</label>
        <select id="attSession">${sessionOptions(sessions, selection.sessionId, { includeEmpty: true })}</select>
      </div>
      <div class="field">
        <label for="attDate">New session date</label>
        <input id="attDate" type="date" value="${esc(selection.date)}" max="${todayISO()}" />
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn btn-outline" type="button" id="createSession">＋ Create / Open session</button>
      </div>
    </div>
    <p class="small muted mt-8">${cls ? `${esc(cls.name)} · ${esc(cls.subject || '')} · ${esc(cls.room || '')} · ${students.length} students` : ''}</p>`;
  picker.append(pickerBody);
  root.append(picker);

  if (!session) {
    const none = el('section', { class: 'card' });
    none.innerHTML = `<div class="card-body">${emptyState(
      'No session selected',
      'Choose an existing session above, or create one for today and start marking attendance.',
      '📅',
    )}</div>`;
    root.append(none);
    wirePicker(pickerBody);
    return { title: 'Take Attendance', subtitle: cls?.name || '', element: root };
  }

  /* ------------------------------ Session bar ----------------------------- */
  const statStrip = el('section', { class: 'grid grid-4' });
  statStrip.innerHTML = [
    statBox('Students', students.length, 'brand'),
    statBox('Present / Late', presentCount, 'ok'),
    statBox('Absent', absentCount, 'danger'),
    statBox('Not marked', unmarked, 'warn'),
  ].join('');
  root.append(statStrip);

  const sessionCard = el('section', { class: 'card' });
  sessionCard.innerHTML = cardHead(
    `${formatDate(session.date)} · ${session.startTime || ''}`,
    `${cls?.name || ''} · ${session.status === 'open' ? 'Open session' : 'Closed session'} · one record per student per session`,
    `
      <button class="btn btn-sm btn-success" type="button" data-action="all-present">✓ Mark all present</button>
      <button class="btn btn-sm btn-ghost" type="button" data-action="toggle-status">${session.status === 'open' ? 'Close session' : 'Reopen session'}</button>
      <button class="btn btn-sm btn-danger" type="button" data-action="delete-session">Delete session</button>
    `,
  );

  const list = el('div', { class: 'att-list' });
  for (const student of students) {
    const record = recordByStudent.get(student.id);
    const row = el('div', { class: 'att-row', dataset: { student: student.id } });
    row.innerHTML = `
      <div class="who">${studentCell(student)}</div>
      <span class="badge ${record ? (record.status === 'present' ? 'badge-ok' : record.status === 'late' ? 'badge-warn' : 'badge-danger') : ''}" data-role="badge">
        ${record ? (record.status === 'present' ? 'Present' : record.status === 'late' ? 'Late' : 'Absent') : 'Not marked'}
      </span>
      ${record?.method === 'face' ? '<span class="badge badge-violet">Face</span>' : ''}
      <div class="att-actions">
        <button class="toggle-btn ${record?.status === 'present' ? 'is-present' : ''}" type="button" data-mark="present">Present</button>
        <button class="toggle-btn ${record?.status === 'late' ? 'is-late' : ''}" type="button" data-mark="late">Late</button>
        <button class="toggle-btn ${record?.status === 'absent' ? 'is-absent' : ''}" type="button" data-mark="absent">Absent</button>
        <button class="toggle-btn" type="button" data-mark="unmarked" title="Clear this record">Clear</button>
      </div>`;
    list.append(row);
  }
  sessionCard.append(list);
  root.append(sessionCard);

  root.append(el('section', { class: 'card' }, [
    el('div', { class: 'card-body' }, [
      el('div', { html: callout(
        'Attendance changes save immediately and update the dashboard, student profiles, analytics and reports at the same time. Marking the same student twice updates the existing record instead of creating a duplicate.',
        'info', '💾',
      ) }),
    ]),
  ]));

  /* -------------------------------- Events -------------------------------- */
  wirePicker(pickerBody);

  sessionCard.addEventListener('click', async (event) => {
    const markBtn = event.target.closest('[data-mark]');
    if (markBtn) {
      const studentId = markBtn.closest('[data-student]').dataset.student;
      const status = markBtn.dataset.mark;
      const result = markAttendance({
        sessionId: session.id,
        studentId,
        status,
        method: 'manual',
      });
      const student = getState().students.find((s) => s.id === studentId);
      if (result.updated) toast('Attendance updated', `${student?.name} is now marked ${status}.`, 'ok', 2200);
      else if (result.created) toast('Attendance recorded', `${student?.name} marked ${status}.`, 'ok', 2200);
      else if (result.removed) toast('Record cleared', `${student?.name} is unmarked.`, 'warn', 2200);
      if (result.ok && status === 'absent') toast('Guardian notified', `${student?.name} absent.`, 'warn', 2600);
      refresh();
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'all-present') {
      const result = markAllPresent(session.id);
      toast('Bulk update', `${result.count} student${result.count === 1 ? '' : 's'} marked present.`, 'ok');
      refresh();
    }
    if (action === 'toggle-status') {
      if (session.status === 'open') {
        closeSession(session.id);
        toast('Session closed', 'Attendance for this session is now locked for editing convenience.', 'ok');
      } else {
        reopenSession(session.id);
        toast('Session reopened', 'You can mark attendance again.', 'ok');
      }
      refresh();
    }
    if (action === 'delete-session') {
      const yes = await confirmDialog({
        title: 'Delete session',
        message: `Delete the session on ${formatDate(session.date)} and all of its attendance records?`,
        confirmLabel: 'Delete session',
        tone: 'danger',
      });
      if (!yes) return;
      deleteSession(session.id);
      selection.sessionId = null;
      toast('Session deleted', 'Use Demo Reset to restore the demo dataset.', 'warn');
      refresh();
    }
  });

  return {
    title: 'Take Attendance',
    subtitle: `${cls?.name || ''} · ${formatDate(session.date)} · ${presentCount}/${students.length} present`,
    element: root,
  };
}

/* -------------------------------- Helpers -------------------------------- */

function statBox(label, value, tone) {
  const colorVar = { brand: 'brand-700', ok: 'ok-700', warn: 'warn-700', danger: 'danger-700' }[tone];
  return `<article class="stat stat-${tone}">
    <div class="stat-top"><span class="stat-label">${esc(label)}</span></div>
    <div class="stat-value" style="color:var(--${colorVar})">${value}</div>
  </article>`;
}

function wirePicker(pickerBody) {
  pickerBody.querySelector('#attClass')?.addEventListener('change', (event) => {
    selection.classId = event.target.value;
    selection.sessionId = null;
    setActiveClass(selection.classId);
    refresh();
  });
  pickerBody.querySelector('#attSession')?.addEventListener('change', (event) => {
    selection.sessionId = event.target.value || null;
    refresh();
  });
  pickerBody.querySelector('#attDate')?.addEventListener('change', (event) => {
    selection.date = event.target.value || todayISO();
  });
  pickerBody.querySelector('#createSession')?.addEventListener('click', () => {
    const date = selection.date || todayISO();
    if (date > todayISO()) {
      toast('Future date', 'Pick today or an earlier date for the demo.', 'warn');
      return;
    }
    const existing = getSessionForDate(selection.classId, date);
    const session = ensureSession(selection.classId, date);
    selection.sessionId = session.id;
    toast(
      existing ? 'Session already exists' : 'Session created',
      existing ? `Opened the existing session for ${formatDate(date)}.` : `Attendance session created for ${formatDate(date)}.`,
      'ok',
    );
    refresh();
  });
}

function refresh() {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}