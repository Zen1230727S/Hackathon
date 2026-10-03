/**
 * REPORTS
 *
 * A printable, exportable attendance report built from the same records the
 * rest of the app writes. Filters (class, date range, status, method) are kept
 * in module scope so they survive the automatic re-render that happens whenever
 * attendance changes.
 *
 * Sections:
 *   - filter toolbar with quick date ranges
 *   - summary KPIs for the filtered scope
 *   - session register (one row per held session)
 *   - detailed attendance records (one row per student per session)
 *   - CSV export (records + summary) and a print/PDF action
 */

import {
  getState,
  getClasses,
  getClass,
  getStudentsByClass,
} from '../lib/store.js';
import {
  el, esc, round1, bar, ratioTone, addDays, todayISO, formatDate, formatDateTime,
  statusBadge, toCSV, downloadFile, toast, plural,
} from '../lib/utils.js';
import {
  cardHead, emptyState, callout, classOptions, studentCell,
} from '../lib/ui.js';

/* Filters survive re-renders triggered by attendance changes. */
const filters = { classId: 'all', from: '', to: '', status: 'all', method: 'all' };

const MAX_DETAIL_ROWS = 400;

export function render({ query } = {}) {
  const state = getState();
  const classes = getClasses();
  const today = todayISO();

  if (query?.get('class')) filters.classId = query.get('class');
  if (filters.classId !== 'all' && !classes.some((c) => c.id === filters.classId)) filters.classId = 'all';
  if (!filters.from) filters.from = addDays(today, -30);
  if (!filters.to) filters.to = today;
  if (filters.from > filters.to) filters.from = filters.to;

  const rerender = () => window.dispatchEvent(new Event('hashchange'));
  const studentsById = new Map(state.students.map((s) => [s.id, s]));

  /* ------------------------------- Scope data ----------------------------- */
  const inRange = (date) => (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
  const sessions = state.sessions
    .filter((s) => (filters.classId === 'all' || s.classId === filters.classId) && inRange(s.date))
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
  const sessionIds = new Set(sessions.map((s) => s.id));

  const records = state.attendance.filter((r) => sessionIds.has(r.sessionId));
  const present = records.filter((r) => r.status === 'present').length;
  const late = records.filter((r) => r.status === 'late').length;
  const absent = records.filter((r) => r.status === 'absent').length;
  const attended = present + late;
  const attendanceRate = records.length ? (attended / records.length) * 100 : 0;
  const distinctStudents = new Set(records.map((r) => r.studentId)).size;
  const faceRecords = records.filter((r) => r.method === 'face').length;

  const unmarkedTotal = sessions.reduce((sum, session) => {
    const size = getStudentsByClass(session.classId).length;
    const marked = state.attendance.filter((a) => a.sessionId === session.id).length;
    return sum + Math.max(0, size - marked);
  }, 0);

  const detail = records
    .filter((r) => (filters.status === 'all' || r.status === filters.status)
      && (filters.method === 'all' || r.method === filters.method))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (studentsById.get(a.studentId)?.rollNo || '').localeCompare(
        studentsById.get(b.studentId)?.rollNo || '', undefined, { numeric: true },
      );
    });

  const scopeName = filters.classId === 'all' ? 'All classes' : (getClass(filters.classId)?.name || '—');
  const rangeLabel = `${formatDate(filters.from)} → ${formatDate(filters.to)}`;

  /* --------------------------------- DOM ---------------------------------- */
  const root = el('div', { class: 'stack' });

  root.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h2', { text: 'Reports' }),
      el('p', { text: `${scopeName} · ${rangeLabel}` }),
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', {
        class: 'btn btn-outline', type: 'button', html: '⇩ Records CSV',
        onclick: () => exportRecords(detail, studentsById),
      }),
      el('button', {
        class: 'btn btn-outline', type: 'button', html: '⇩ Summary CSV',
        onclick: () => exportSummary(sessions, state),
      }),
      el('button', {
        class: 'btn btn-primary', type: 'button', html: '🖨 Print / PDF',
        onclick: () => { window.print(); toast('Print dialog opened', 'Choose "Save as PDF" to archive this report.', 'info', 2600); },
      }),
    ]),
  ]));

  /* ------------------------------- Toolbar -------------------------------- */
  const toolbarCard = el('section', { class: 'card' });
  toolbarCard.innerHTML = cardHead('Filters', 'Narrow the report by class, date range, status and marking method');
  const toolbarBody = el('div', { class: 'card-body' });
  const toolbar = el('div', { class: 'toolbar' });
  toolbar.innerHTML = `
    <div class="field">
      <label for="repClass">Class</label>
      <select id="repClass">
        <option value="all" ${filters.classId === 'all' ? 'selected' : ''}>All classes</option>
        ${classOptions(classes, filters.classId)}
      </select>
    </div>
    <div class="field">
      <label for="repFrom">From</label>
      <input id="repFrom" type="date" value="${esc(filters.from)}" max="${esc(today)}" />
    </div>
    <div class="field">
      <label for="repTo">To</label>
      <input id="repTo" type="date" value="${esc(filters.to)}" max="${esc(today)}" />
    </div>
    <div class="field">
      <label for="repStatus">Status</label>
      <select id="repStatus">
        <option value="all" ${filters.status === 'all' ? 'selected' : ''}>All statuses</option>
        <option value="present" ${filters.status === 'present' ? 'selected' : ''}>Present</option>
        <option value="late" ${filters.status === 'late' ? 'selected' : ''}>Late</option>
        <option value="absent" ${filters.status === 'absent' ? 'selected' : ''}>Absent</option>
      </select>
    </div>
    <div class="field">
      <label for="repMethod">Method</label>
      <select id="repMethod">
        <option value="all" ${filters.method === 'all' ? 'selected' : ''}>Any method</option>
        <option value="face" ${filters.method === 'face' ? 'selected' : ''}>Face recognition</option>
        <option value="manual" ${filters.method === 'manual' ? 'selected' : ''}>Manual</option>
      </select>
    </div>
    <button class="btn btn-ghost" type="button" id="repReset">Reset filters</button>`;
  toolbarBody.append(toolbar);

  const chipRow = el('div', { class: 'chip-row mt-16' });
  const ranges = [
    { key: '7', label: 'Last 7 days', from: addDays(today, -7) },
    { key: '30', label: 'Last 30 days', from: addDays(today, -30) },
    { key: 'month', label: 'This month', from: `${today.slice(0, 7)}-01` },
    { key: 'all', label: 'All time', from: addDays(today, -3650) },
  ];
  for (const range of ranges) {
    const isActive = filters.to === today && filters.from === range.from;
    chipRow.append(el('button', {
      class: isActive ? 'chip is-active' : 'chip',
      type: 'button', text: range.label, dataset: { range: range.key },
    }));
  }
  toolbarBody.append(chipRow);
  toolbarCard.append(toolbarBody);
  root.append(toolbarCard);

  /* ------------------------------- Summary -------------------------------- */
  const summaryCard = el('section', { class: 'card' });
  summaryCard.innerHTML = cardHead('Summary', `${plural(records.length, 'attendance record')} across ${plural(sessions.length, 'session')}`);
  const summaryBody = el('div', { class: 'card-body' });
  const summaryGrid = el('div', { class: 'kpi-ribbon' });
  summaryGrid.innerHTML = [
    kpiCell('Attendance rate', `${round1(attendanceRate)}%`, `${attended} of ${records.length} attended`, ratioVar(attendanceRate)),
    kpiCell('Present', String(present), 'On time', 'ok-700'),
    kpiCell('Late', String(late), 'Counted as attended', 'warn-700'),
    kpiCell('Absent', String(absent), 'Recorded absences', 'danger-700'),
    kpiCell('Students', String(distinctStudents), `of ${filters.classId === 'all' ? state.students.length : getStudentsByClass(filters.classId).length} in scope`, 'brand-700'),
    kpiCell('Unmarked', String(unmarkedTotal), 'Slots with no record', unmarkedTotal ? 'warn-700' : 'ok-700'),
  ].join('');
  summaryBody.append(summaryGrid);

  const methodNote = el('div', { class: 'mt-16' });
  methodNote.innerHTML = callout(
    `<strong>${faceRecords}</strong> of <strong>${records.length}</strong> records in this range were captured via face recognition; `
    + 'the rest were marked manually. Both methods write the same attendance record.',
    'info', '◉',
  );
  summaryBody.append(methodNote);
  summaryCard.append(summaryBody);
  root.append(summaryCard);

  /* --------------------------- Session register --------------------------- */
  const registerCard = el('section', { class: 'card' });
  registerCard.innerHTML = cardHead('Session Register', 'One row per held session in the selected range');
  if (!sessions.length) {
    const empty = el('div');
    empty.innerHTML = emptyState('No sessions in range', 'Try widening the date range or switching to all classes.', '📅');
    registerCard.append(empty);
  } else {
    const shown = sessions.slice(0, 60);
    const wrap = el('div', { class: 'table-wrap', style: 'max-height:460px;overflow-y:auto' });
    wrap.innerHTML = `
      <table class="tbl">
        <thead>
          <tr>
            <th>Date</th>
            <th>Class</th>
            <th class="num">Present</th>
            <th class="num">Late</th>
            <th class="num">Absent</th>
            <th class="num">Unmarked</th>
            <th>Attendance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${shown.map((session) => {
            const recs = state.attendance.filter((a) => a.sessionId === session.id);
            const size = getStudentsByClass(session.classId).length;
            const p = recs.filter((r) => r.status === 'present').length;
            const l = recs.filter((r) => r.status === 'late').length;
            const ab = recs.filter((r) => r.status === 'absent').length;
            const unmarked = Math.max(0, size - recs.length);
            const percent = size ? ((p + l) / size) * 100 : 0;
            return `
              <tr>
                <td class="nowrap">${esc(formatDate(session.date))}</td>
                <td>${esc(getClass(session.classId)?.name || '—')}</td>
                <td class="num" style="color:var(--ok-700)">${p}</td>
                <td class="num" style="color:var(--warn-700)">${l}</td>
                <td class="num" style="color:var(--danger-700)">${ab}</td>
                <td class="num">${unmarked}</td>
                <td>
                  <div class="row-between" style="gap:10px;margin-bottom:5px">
                    <strong>${round1(percent)}%</strong>
                    <span class="small muted">${p + l}/${size}</span>
                  </div>
                  ${bar(percent, ratioTone(percent, 75))}
                </td>
                <td>${session.status === 'open'
                  ? '<span class="badge badge-ok">Open</span>'
                  : '<span class="badge">Closed</span>'}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
    registerCard.append(wrap);
    if (sessions.length > shown.length) {
      registerCard.append(el('div', { class: 'card-body tight' }, [
        el('p', { class: 'small muted', text: `Showing the most recent ${shown.length} of ${sessions.length} sessions. Narrow the date range to see older ones.` }),
      ]));
    }
  }
  root.append(registerCard);

  /* --------------------------- Detailed records --------------------------- */
  const detailCard = el('section', { class: 'card' });
  detailCard.innerHTML = cardHead(
    'Detailed Records',
    `${plural(detail.length, 'record')} matching the current filters`,
  );
  if (!detail.length) {
    const empty = el('div');
    empty.innerHTML = emptyState('No records match', 'Adjust the status or method filter to see attendance rows.', '🔎');
    detailCard.append(empty);
  } else {
    const shown = detail.slice(0, MAX_DETAIL_ROWS);
    const wrap = el('div', { class: 'table-wrap', style: 'max-height:520px;overflow-y:auto' });
    wrap.innerHTML = `
      <table class="tbl">
        <thead>
          <tr>
            <th>Date</th>
            <th>Student</th>
            <th>Class</th>
            <th>Status</th>
            <th>Method</th>
            <th>Marked at</th>
          </tr>
        </thead>
        <tbody>
          ${shown.map((record) => {
            const student = studentsById.get(record.studentId);
            return `
              <tr>
                <td class="nowrap">${esc(formatDate(record.date))}</td>
                <td>${student ? studentCell(student) : '<span class="muted small">Removed student</span>'}</td>
                <td>${esc(getClass(record.classId)?.name || '—')}</td>
                <td>${statusBadge(record.status)}</td>
                <td>${record.method === 'face'
                  ? '<span class="badge badge-violet">Face</span>'
                  : '<span class="badge">Manual</span>'}</td>
                <td class="nowrap small muted">${esc(formatDateTime(record.markedAt))}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
    detailCard.append(wrap);
    if (detail.length > shown.length) {
      detailCard.append(el('div', { class: 'card-body tight' }, [
        el('p', {
          class: 'small muted',
          text: `Showing the first ${shown.length} of ${detail.length} records on screen — the CSV export always contains every matching row.`,
        }),
      ]));
    }
  }
  root.append(detailCard);

  /* ------------------------------- Footnote ------------------------------- */
  root.append(el('section', { class: 'card' }, [
    el('div', { class: 'card-body' }, [
      el('div', {
        html: callout(
          'This report is generated locally in your browser from the demo attendance data. '
          + 'Nothing is uploaded, and all names and figures are fictional.',
          'info', '🔒',
        ),
      }),
    ]),
  ]));

  /* ------------------------------- Events --------------------------------- */
  toolbar.addEventListener('change', (event) => {
    const { id, value } = event.target;
    if (id === 'repClass') filters.classId = value;
    else if (id === 'repFrom') filters.from = value;
    else if (id === 'repTo') filters.to = value;
    else if (id === 'repStatus') filters.status = value;
    else if (id === 'repMethod') filters.method = value;
    else return;
    rerender();
  });

  toolbar.querySelector('#repReset').addEventListener('click', () => {
    filters.classId = 'all';
    filters.from = addDays(today, -30);
    filters.to = today;
    filters.status = 'all';
    filters.method = 'all';
    rerender();
  });

  chipRow.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-range]');
    if (!button) return;
    const preset = ranges.find((range) => range.key === button.dataset.range);
    if (!preset) return;
    filters.to = today;
    filters.from = preset.from;
    rerender();
  });

  return {
    title: 'Reports',
    subtitle: `${scopeName} · ${plural(records.length, 'record')} · ${round1(attendanceRate)}% attendance`,
    element: root,
  };
}

/* ------------------------------- Sub-parts -------------------------------- */

function kpiCell(label, value, sub, colorVar) {
  return `<div class="kpi">
    <div class="k">${esc(label)}</div>
    <div class="v" style="color:var(--${colorVar})">${esc(value)}</div>
    <div class="small muted">${esc(sub)}</div>
  </div>`;
}

function ratioVar(percent) {
  if (percent < 75) return 'danger-700';
  if (percent < 83) return 'warn-700';
  return 'ok-700';
}

function exportRecords(rows, studentsById) {
  if (!rows.length) {
    toast('Nothing to export', 'No records match the current filters.', 'warn');
    return;
  }
  const headers = ['Date', 'Roll No', 'Student', 'Class', 'Status', 'Method', 'Marked At'];
  const data = rows.map((record) => {
    const student = studentsById.get(record.studentId);
    return [
      record.date,
      student?.rollNo || '',
      student?.name || 'Removed student',
      getClass(record.classId)?.name || '',
      record.status,
      record.method,
      record.markedAt,
    ];
  });
  downloadFile(`attendance-records-${todayISO()}.csv`, toCSV(headers, data));
  toast('Export complete', `${data.length} records exported to CSV.`, 'ok');
}

function exportSummary(sessions, state) {
  if (!sessions.length) {
    toast('Nothing to export', 'There are no sessions in the selected range.', 'warn');
    return;
  }
  const headers = ['Date', 'Class', 'Session', 'Start', 'Present', 'Late', 'Absent', 'Unmarked', 'Class Size', 'Attendance %'];
  const data = sessions.map((session) => {
    const recs = state.attendance.filter((a) => a.sessionId === session.id);
    const size = getStudentsByClass(session.classId).length;
    const p = recs.filter((r) => r.status === 'present').length;
    const l = recs.filter((r) => r.status === 'late').length;
    const ab = recs.filter((r) => r.status === 'absent').length;
    return [
      session.date,
      getClass(session.classId)?.name || '',
      session.label || '',
      session.startTime || '',
      p,
      l,
      ab,
      Math.max(0, size - recs.length),
      size,
      round1(size ? ((p + l) / size) * 100 : 0),
    ];
  });
  downloadFile(`attendance-summary-${todayISO()}.csv`, toCSV(headers, data));
  toast('Export complete', `${data.length} sessions exported to CSV.`, 'ok');
}