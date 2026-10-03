/**
 * ANALYTICS
 *
 * Class-by-class and student-by-student attendance insight, computed entirely
 * from the attendance records already stored in the app. Every number on this
 * page is deterministic arithmetic - there is no AI, no estimation and no
 * external data source involved.
 *
 * Sections:
 *   - scope selector (all classes, or a single class)
 *   - KPI ribbon for the selected scope
 *   - class comparison table
 *   - attendance distribution histogram
 *   - weekday attendance pattern
 *   - low-attendance watch list with the classes needed to recover
 *   - top performers
 */

import {
  getState,
  getClasses,
  getClass,
  getStudents,
  getStudentsByClass,
  studentStats,
  classStats,
  dashboardStats,
  heldSessions,
} from '../lib/store.js';
import {
  el, esc, round1, bar, ratioTone, weekdayName, todayISO,
  toCSV, downloadFile, toast, avatarDataUri,
} from '../lib/utils.js';
import {
  cardHead, studentCell, percentCell, emptyState, callout,
} from '../lib/ui.js';
import { distributionBuckets } from '../lib/analytics.js';

/* Scope survives a re-render triggered by a data change. */
const filters = { classId: 'all' };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function render({ query } = {}) {
  const state = getState();
  const classes = getClasses();
  const stats = dashboardStats();
  const threshold = stats.threshold;
  const today = todayISO();

  if (query?.get('class')) filters.classId = query.get('class');
  if (filters.classId !== 'all' && !classes.some((c) => c.id === filters.classId)) filters.classId = 'all';

  const rerender = () => window.dispatchEvent(new Event('hashchange'));

  /* ------------------------------- Scope data ----------------------------- */
  const classRows = classes.map((cls) => ({
    cls,
    stats: classStats(cls.id),
    sessions: heldSessions(cls.id).length,
  }));

  const scopedStudents = filters.classId === 'all' ? getStudents() : getStudentsByClass(filters.classId);
  const scopedRows = scopedStudents.map((student) => ({ student, stats: studentStats(student.id) }));
  const withData = scopedRows.filter((row) => row.stats.total > 0);

  const scopeAverage = withData.length
    ? withData.reduce((sum, row) => sum + row.stats.percent, 0) / withData.length
    : 0;

  const below = withData
    .filter((row) => row.stats.percent < threshold)
    .sort((a, b) => a.stats.percent - b.stats.percent);
  const atRisk = withData.filter((row) => row.stats.risk === 'at-risk');
  const perfect = withData.filter((row) => row.stats.percent >= 100);
  const topPerformers = [...withData].sort((a, b) => b.stats.percent - a.stats.percent).slice(0, 6);

  const distribution = distributionBuckets(withData.map((row) => row.stats.percent));
  const maxBucket = Math.max(1, ...distribution.map((bucket) => bucket.count));

  /* --------------------------- Scope-wide records ------------------------- */
  const scopedSessions = state.sessions.filter(
    (s) => s.date <= today && (filters.classId === 'all' || s.classId === filters.classId),
  );
  const scopedSessionIds = new Set(scopedSessions.map((s) => s.id));
  const scopedRecords = state.attendance.filter((r) => scopedSessionIds.has(r.sessionId));
  const faceRecords = scopedRecords.filter((r) => r.method === 'face').length;
  const faceShare = scopedRecords.length ? (faceRecords / scopedRecords.length) * 100 : 0;

  /* --------------------------- Weekday pattern ---------------------------- */
  const studentsPerClass = new Map(
    classes.map((cls) => [cls.id, state.students.filter((s) => s.classId === cls.id).length]),
  );
  const dayBuckets = WEEKDAYS.map((day) => ({ day, attended: 0, total: 0, sessions: 0 }));
  for (const session of scopedSessions) {
    const bucket = dayBuckets.find((b) => b.day === weekdayName(session.date));
    if (!bucket) continue; // Sunday has no scheduled class
    bucket.sessions += 1;
    bucket.total += studentsPerClass.get(session.classId) || 0;
    bucket.attended += state.attendance.filter(
      (a) => a.sessionId === session.id && (a.status === 'present' || a.status === 'late'),
    ).length;
  }
  const dayRows = dayBuckets.map((bucket) => ({
    ...bucket,
    percent: bucket.total ? (bucket.attended / bucket.total) * 100 : 0,
  }));
  const maxDayPercent = Math.max(1, ...dayRows.map((row) => row.percent));

  /* --------------------------------- DOM ---------------------------------- */
  const root = el('div', { class: 'stack' });

  root.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h2', { text: 'Analytics' }),
      el('p', {
        text: `${classes.length} classes · ${scopedStudents.length} students in scope · required attendance ${threshold}%`,
      }),
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', {
        class: 'btn btn-outline', type: 'button', html: '⇩ Export CSV',
        onclick: () => exportAnalytics(scopedRows, threshold),
      }),
      el('button', {
        class: 'btn btn-outline', type: 'button', html: '🖨 Print',
        onclick: () => { window.print(); toast('Print dialog opened', 'Use "Save as PDF" to archive this report.', 'info', 2600); },
      }),
    ]),
  ]));

  /* --------------------------- Scope segmented ---------------------------- */
  const scopeCard = el('section', { class: 'card' });
  scopeCard.innerHTML = cardHead('Scope', 'Analyse every class together, or drill into one');
  const scopeBody = el('div', { class: 'card-body' });
  const segmented = el('div', { class: 'segmented' });
  segmented.append(el('button', {
    class: filters.classId === 'all' ? 'is-active' : '',
    type: 'button', text: 'All classes', dataset: { scope: 'all' },
  }));
  for (const cls of classes) {
    segmented.append(el('button', {
      class: filters.classId === cls.id ? 'is-active' : '',
      type: 'button', text: cls.name, dataset: { scope: cls.id },
    }));
  }
  segmented.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-scope]');
    if (!button) return;
    filters.classId = button.dataset.scope;
    rerender();
  });
  scopeBody.append(segmented);
  scopeCard.append(scopeBody);
  root.append(scopeCard);

  /* ------------------------------ KPI ribbon ------------------------------ */
  const ribbon = el('section', { class: 'card' });
  ribbon.innerHTML = cardHead(
    'Key Numbers',
    filters.classId === 'all' ? 'Across every class' : `For ${getClass(filters.classId)?.name || 'this class'}`,
  );
  const ribbonBody = el('div', { class: 'card-body' });
  const ribbonGrid = el('div', { class: 'kpi-ribbon' });
  ribbonGrid.innerHTML = [
    kpiCell('Average attendance', `${round1(scopeAverage)}%`, `${withData.length} students with records`, ratioVar(scopeAverage, threshold)),
    kpiCell('Students', String(scopedStudents.length), `${below.length} below the ${threshold}% bar`, 'brand-700'),
    kpiCell('Sessions held', String(scopedSessions.length), `${perfect.length} students at 100%`, 'brand-700'),
    kpiCell('Face vs manual', `${round1(faceShare)}%`, `${faceRecords} of ${scopedRecords.length} records via face`, 'violet-500'),
    kpiCell('At risk', String(atRisk.length), 'Within 4% of the threshold', atRisk.length ? 'warn-700' : 'ok-700'),
    kpiCell('Below threshold', String(below.length), `Required: ${threshold}%`, below.length ? 'danger-700' : 'ok-700'),
  ].join('');
  ribbonBody.append(ribbonGrid);
  ribbon.append(ribbonBody);
  root.append(ribbon);

  /* -------------------------- Class comparison ---------------------------- */
  const classCard = el('section', { class: 'card' });
  classCard.innerHTML = cardHead('Class Comparison', 'Average attendance, sessions held and how many students are below the bar');
  if (!classRows.length) {
    const empty = el('div');
    empty.innerHTML = emptyState('No classes yet', 'Add a class from the Students page to see analytics.', '🏫');
    classCard.append(empty);
  } else {
    const wrap = el('div', { class: 'table-wrap' });
    wrap.innerHTML = `
      <table class="tbl">
        <thead>
          <tr>
            <th>Class</th>
            <th class="num">Students</th>
            <th class="num">Sessions</th>
            <th>Average</th>
            <th class="num">Below</th>
            <th class="num">At risk</th>
            <th class="num">100%</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${classRows.map(({ cls, stats: cs, sessions }) => `
            <tr>
              <td>
                <div class="cell-name">${esc(cls.name)}</div>
                <div class="cell-sub">${esc(cls.subject || '—')} · ${esc(cls.room || '')}</div>
              </td>
              <td class="num">${cs.count}</td>
              <td class="num">${sessions}</td>
              <td>${percentCell(cs.classAverage, threshold, cs.count ? 1 : 0)}</td>
              <td class="num">${cs.belowThreshold.length}</td>
              <td class="num">${cs.atRisk.length}</td>
              <td class="num">${cs.perfect.length}</td>
              <td class="num nowrap">
                <button class="btn btn-sm btn-outline" type="button" data-class="${esc(cls.id)}">Analyse</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    classCard.append(wrap);
    classCard.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-class]');
      if (!button) return;
      filters.classId = button.dataset.class;
      rerender();
    });
  }
  root.append(classCard);

  /* ------------------------- Distribution + weekday ----------------------- */
  const split = el('section', { class: 'grid grid-main-side' });

  const distCard = el('div', { class: 'card' });
  distCard.innerHTML = cardHead('Attendance Distribution', `How the ${withData.length} students in scope are spread`);
  const distBody = el('div', { class: 'card-body' });
  if (!withData.length) {
    distBody.innerHTML = emptyState('No attendance recorded', 'Once sessions are marked, the distribution appears here.', '📊');
  } else {
    distBody.innerHTML = distribution.map((bucket) => `
      <div class="row" style="gap:12px;margin-bottom:12px">
        <div class="small strong" style="min-width:92px">${esc(bucket.label)}</div>
        <div class="grow">${bar((bucket.count / maxBucket) * 100, bucket.tone)}</div>
        <div class="small strong" style="min-width:52px;text-align:right">${bucket.count} stud.</div>
      </div>`).join('');
  }
  distCard.append(distBody);
  split.append(distCard);

  const dayCard = el('div', { class: 'card' });
  dayCard.innerHTML = cardHead('Weekday Pattern', 'Average attendance rate per weekday');
  const dayBody = el('div', { class: 'card-body' });
  if (!scopedSessions.length) {
    dayBody.innerHTML = emptyState('No sessions yet', 'Held sessions are grouped by weekday here.', '📅');
  } else {
    dayBody.innerHTML = dayRows.map((row) => `
      <div class="row" style="gap:12px;margin-bottom:12px">
        <div class="small strong" style="min-width:44px">${esc(row.day)}</div>
        <div class="grow">${bar((row.percent / maxDayPercent) * 100, ratioTone(row.percent, threshold))}</div>
        <div class="small strong" style="min-width:56px;text-align:right">${round1(row.percent)}%</div>
      </div>`).join('');
  }
  dayCard.append(dayBody);
  split.append(dayCard);
  root.append(split);

  /* -------------------------- Watch list + top ---------------------------- */
  const lowerSplit = el('section', { class: 'grid grid-main-side' });

  const watchCard = el('div', { class: 'card' });
  watchCard.innerHTML = cardHead(
    'Attendance Watch List',
    `Students below the ${threshold}% requirement, worst first`,
    `<button class="btn btn-sm btn-outline" type="button" data-goto="#/students">Manage students</button>`,
  );
  if (!below.length) {
    const empty = el('div');
    empty.innerHTML = emptyState('Everyone is above the bar', `No student in scope is below ${threshold}%.`, '🎉');
    watchCard.append(empty);
  } else {
    const wrap = el('div', { class: 'table-wrap' });
    wrap.innerHTML = `
      <table class="tbl">
        <thead>
          <tr>
            <th>Student</th>
            <th>Class</th>
            <th>Attendance</th>
            <th class="num">Needs</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${below.slice(0, 12).map(({ student, stats: s }) => `
            <tr>
              <td>${studentCell(student)}</td>
              <td>${esc(getClass(student.classId)?.name || '—')}</td>
              <td>${percentCell(s.percent, threshold, s.total)}</td>
              <td class="num nowrap">${s.plan.canRecover ? `${s.plan.needed} classes` : '—'}</td>
              <td class="num nowrap">
                <button class="btn btn-sm btn-outline" type="button" data-student="${esc(student.id)}">Recovery plan</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    watchCard.append(wrap);
    watchCard.addEventListener('click', (event) => {
      const goto = event.target.closest('[data-goto]');
      if (goto) { window.location.hash = goto.dataset.goto; return; }
      const button = event.target.closest('button[data-student]');
      if (button) window.location.hash = `#/students/${button.dataset.student}`;
    });
  }
  lowerSplit.append(watchCard);

  const topCard = el('div', { class: 'card' });
  topCard.innerHTML = cardHead('Top Performers', 'Highest attendance in the selected scope');
  if (!topPerformers.length) {
    const empty = el('div');
    empty.innerHTML = emptyState('Nothing to rank yet', 'Attendance records are needed before students can be ranked.', '🏅');
    topCard.append(empty);
  } else {
    const list = el('div', { class: 'att-list' });
    for (const { student, stats: s } of topPerformers) {
      const row = el('div', { class: 'att-row' });
      row.innerHTML = `
        <img class="avatar" src="${student.photo || avatarDataUri(student.name)}" alt="" width="34" height="34" style="border-radius:10px;object-fit:cover" />
        <div class="who">
          <strong>${esc(student.name)}</strong>
          <div class="small muted">${esc(getClass(student.classId)?.name || '')} · ${s.attended}/${s.total} attended</div>
        </div>
        <div class="num nowrap strong" style="color:var(--ok-700)">${round1(s.percent)}%</div>`;
      row.addEventListener('click', () => { window.location.hash = `#/students/${student.id}`; });
      list.append(row);
    }
    topCard.append(list);
  }
  lowerSplit.append(topCard);
  root.append(lowerSplit);

  /* ------------------------------- Footnote ------------------------------- */
  root.append(el('section', { class: 'card' }, [
    el('div', { class: 'card-body' }, [
      el('div', {
        html: callout(
          'Every figure on this page is calculated from attendance records stored locally in this browser. '
          + 'No AI model, external service or hidden dataset is involved, and all student data is fictional.',
          'info', '📐',
        ),
      }),
    ]),
  ]));

  const scopeName = filters.classId === 'all' ? 'All classes' : (getClass(filters.classId)?.name || '');

  return {
    title: 'Analytics',
    subtitle: `${scopeName} · average ${round1(scopeAverage)}% · ${below.length} below ${threshold}%`,
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

function ratioVar(percent, threshold) {
  if (percent < threshold) return 'danger-700';
  if (percent < threshold + 4) return 'warn-700';
  return 'ok-700';
}

function exportAnalytics(rows, threshold) {
  if (!rows.length) {
    toast('Nothing to export', 'There are no students in the current scope.', 'warn');
    return;
  }
  const headers = [
    'Roll No', 'Name', 'Class', 'Sessions Held', 'Attended', 'Present', 'Late',
    'Absent', 'Attendance %', 'Status', 'Classes Needed To Recover',
  ];
  const data = rows.map(({ student, stats: s }) => [
    student.rollNo,
    student.name,
    getClass(student.classId)?.name || '',
    s.total,
    s.attended,
    s.present,
    s.late,
    s.absent,
    round1(s.percent),
    s.total ? (s.percent < threshold ? 'Below threshold' : 'OK') : 'No data',
    s.plan.canRecover && s.plan.below ? s.plan.needed : '',
  ]);
  downloadFile(`analytics-${todayISO()}.csv`, toCSV(headers, data));
  toast('Export complete', `${data.length} rows exported to CSV.`, 'ok');
}