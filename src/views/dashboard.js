/**
 * Teacher dashboard: headline numbers, low-attendance warnings, recent
 * activity and the primary "Start Face Attendance" call to action.
 */

import {
  dashboardStats,
  getActivity,
  getClass,
  getActiveClassId,
  setActiveClass,
  getState,
} from '../lib/store.js';
import { el, esc, round1, relativeTime, todayISO, formatDate, toast } from '../lib/utils.js';
import { statCard, cardHead, studentCell, percentCell, emptyState, callout } from '../lib/ui.js';

export function render() {
  const stats = dashboardStats();
  const state = getState();
  const activeClassId = getActiveClassId();
  const activeClass = getClass(activeClassId);
  const feed = getActivity(9);

  const marked = stats.todayPresent + stats.todayAbsent;
  const attendanceToday = marked ? (stats.todayPresent / marked) * 100 : 0;

  const root = el('div', { class: 'stack' });

  /* ------------------------------- Hero / CTA ------------------------------ */
  const hero = el('section', { class: 'hero' }, [
    el('div', {}, [
      el('h2', { text: `Good day, ${(state.settings.teacher?.name || 'Teacher').replace(/^Prof\.\s*/i, '')}` }),
      el('p', {
        text: `Today is ${formatDate(todayISO())}. ${stats.todaySessions.length
          ? `${stats.todaySessions.length} session${stats.todaySessions.length === 1 ? '' : 's'} scheduled. ${stats.todayUnmarked} student${stats.todayUnmarked === 1 ? '' : 's'} still unmarked.`
          : 'No sessions are scheduled for today.'}`,
      }),
    ]),
    el('div', { class: 'hero-actions' }, [
      el('button', {
        class: 'btn btn-primary btn-lg',
        type: 'button',
        html: '◉ Start Face Attendance',
        onclick: () => { window.location.hash = `#/face${activeClassId ? `?class=${activeClassId}` : ''}`; },
      }),
      el('button', {
        class: 'btn btn-ghost btn-lg',
        type: 'button',
        html: '☑ Take Attendance Manually',
        onclick: () => { window.location.hash = `#/attendance${activeClassId ? `?class=${activeClassId}` : ''}`; },
      }),
    ]),
  ]);
  root.append(hero);

  /* ------------------------------- Stat cards ------------------------------ */
  const cards = el('section', { class: 'grid grid-5' });
  cards.innerHTML = [
    statCard({
      label: 'Total Students', value: stats.totalStudents, icon: '☺',
      foot: `Across ${stats.totalClasses} classes · ${stats.enrolled} face-enrolled`,
      tone: 'brand',
    }),
    statCard({
      label: "Today's Present", value: stats.todayPresent, icon: '✓',
      foot: marked ? `${round1(attendanceToday)}% of marked students` : 'No attendance marked yet',
      tone: 'ok', percent: marked ? attendanceToday : null,
    }),
    statCard({
      label: "Today's Absent", value: stats.todayAbsent, icon: '✕',
      foot: stats.todayUnmarked > 0 ? `${stats.todayUnmarked} not marked yet` : 'All students marked',
      tone: 'danger',
    }),
    statCard({
      label: 'Overall Attendance', value: round1(stats.overallPercent), unit: '%', icon: '∿',
      foot: `Average across all ${stats.totalStudents} students`,
      tone: stats.overallPercent >= stats.threshold ? 'ok' : 'warn',
      percent: stats.overallPercent,
    }),
    statCard({
      label: 'Low Attendance', value: stats.lowAttendance.length, icon: '⚠',
      foot: `Students below the ${stats.threshold}% threshold`,
      tone: stats.lowAttendance.length ? 'danger' : 'ok',
    }),
  ].join('');
  root.append(cards);

  /* --------------------- Notice about today's sessions --------------------- */
  if (stats.todaySessions.length) {
    const chips = el('div', { class: 'chip-row' });
    for (const session of stats.todaySessions) {
      const cls = getClass(session.classId);
      const markedHere = state.attendance.filter((a) => a.sessionId === session.id).length;
      const total = state.students.filter((s) => s.classId === session.classId).length;
      chips.append(el('button', {
        class: 'chip',
        type: 'button',
        text: `${cls?.name || 'Class'} · ${markedHere}/${total} marked · ${session.status === 'open' ? 'Open' : 'Closed'}`,
        onclick: () => { window.location.hash = `#/attendance?class=${session.classId}&session=${session.id}`; },
      }));
    }
    const sessionsCard = el('section', { class: 'card' }, [
      el('div', { class: 'card-body' }, [chips]),
    ]);
    // cardHead() returns an HTML string - inject it via innerHTML (as the other
    // cards do) so it renders as markup, not as literal text.
    sessionsCard.insertAdjacentHTML('afterbegin', cardHead("Today's Sessions", 'Jump straight into an open session'));
    root.append(sessionsCard);
  }

  /* ------------------------ Main grid: low attendance + feed --------------- */
  const grid = el('section', { class: 'grid grid-main-side' });

  // Low attendance table with a direct route to the recovery planner.
  const lowCard = el('div', { class: 'card' });
  lowCard.innerHTML = cardHead(
    'Low Attendance Warnings',
    `Students below the ${stats.threshold}% threshold`,
    `<button class="btn btn-sm btn-outline" type="button" data-goto="#/analytics">View analytics</button>`,
  );

  if (!stats.lowAttendance.length) {
    const empty = el('div');
    empty.innerHTML = emptyState('No low-attendance students', `Every student is at or above ${stats.threshold}%.`, '🎉');
    lowCard.append(empty);
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
          ${stats.lowAttendance.slice(0, 8).map(({ student, stats: s }) => `
            <tr>
              <td>${studentCell(student)}</td>
              <td>${esc(getClass(student.classId)?.name || '—')}</td>
              <td>${percentCell(s.percent, stats.threshold, s.total)}</td>
              <td class="num nowrap">${s.plan.canRecover ? `${s.plan.needed} classes` : '—'}</td>
              <td class="num">
                <button class="btn btn-sm btn-outline" type="button" data-goto="#/students/${student.id}">Recovery plan</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    lowCard.append(wrap);
  }

  // Recent activity feed.
  const feedCard = el('div', { class: 'card' });
  feedCard.innerHTML = cardHead('Recent Activity', 'Latest attendance events');
  if (!feed.length) {
    const empty = el('div');
    empty.innerHTML = emptyState('No activity yet', 'Attendance events will appear here.', '🕓');
    feedCard.append(empty);
  } else {
    const list = el('div', { class: 'feed' });
    for (const item of feed) {
      const toneClass = item.type === 'present' ? 'is-present'
        : item.type === 'absent' ? 'is-absent'
          : item.type === 'face' ? 'is-face' : '';
      list.append(el('div', { class: 'feed-item' }, [
        el('span', { class: `feed-dot ${toneClass}` }),
        el('div', { class: 'feed-body' }, [
          el('div', { class: 'small', html: esc(item.message) }),
        ]),
        el('span', { class: 'feed-time', text: relativeTime(item.at) }),
      ]));
    }
    feedCard.append(list);
  }

  grid.append(lowCard, feedCard);
  root.append(grid);

  /* ------------------------------ Quick insights --------------------------- */
  const insightRows = [];
  const totalHeld = state.sessions.filter((s) => s.date <= todayISO()).length;
  insightRows.push(['Sessions recorded', String(totalHeld)]);
  insightRows.push(['Attendance records', String(stats.totalRecords)]);
  insightRows.push(['Marked via face recognition', `${stats.faceRecords} (${stats.totalRecords ? round1((stats.faceRecords / stats.totalRecords) * 100) : 0}%)`]);
  insightRows.push(['Students with a face reference', `${stats.enrolled} of ${stats.totalStudents}`]);
  insightRows.push(['Students at risk (within 4%)', String(stats.atRisk.length)]);

  const insightCard = el('section', { class: 'card' }, [
    el('div', { class: 'card-body' }, [
      el('div', { class: 'kpi-ribbon' }, insightRows.map(([label, value]) => {
        const node = el('div', { class: 'kpi' });
        node.innerHTML = `<div class="k">${esc(label)}</div><div class="v">${esc(value)}</div>`;
        return node;
      })),
      el('div', { class: 'mt-16' }, [
        el('div', { html: callout(
          `This is a hackathon prototype using <strong>fictional demo data</strong>. Real deployment would require consent, access controls, retention rules and institutional/legal review.`,
          'warn', '⚠',
        ) }),
      ]),
    ]),
  ]);
  root.append(insightCard);

  // Delegate navigation for inline buttons.
  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-goto]');
    if (target) {
      window.location.hash = target.dataset.goto;
      return;
    }
    const classPick = event.target.closest('[data-active-class]');
    if (classPick) {
      setActiveClass(classPick.dataset.activeClass);
      toast('Active class updated', '', 'ok', 1800);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  });

  return {
    title: 'Dashboard',
    subtitle: `${activeClass ? `${activeClass.name} · ${activeClass.subject}` : 'Overview'} · ${stats.totalStudents} students`,
    element: root,
  };
}