/**
 * STUDENT PORTAL - read-only view for the signed-in student.
 *
 * The portal shows ONLY the attendance of the student whose id is stored in the
 * session. It reuses the existing store + analytics directly:
 *   - studentStats(id)  -> percent, present, late, absent, plan, history
 *   - plan              -> 75% status, classes needed, what-if projections
 *
 * There are NO write actions here and no links into teacher features.
 */

import { getStudent, studentStats, getClass } from '../lib/store.js';
import {
  el, esc, round1, avatarDataUri, progressRing, bar, ratioTone, formatDate, statusBadge,
} from '../lib/utils.js';
import { cardHead, emptyState, callout, riskBadge } from '../lib/ui.js';
import { recoverySentence } from '../lib/analytics.js';
import { getStudentSession, clearAllSessions } from '../lib/session.js';

export function render() {
  const session = getStudentSession();
  const student = session ? getStudent(session.studentId) : null;

  const root = el('div', { class: 'stack student-portal' });

  /* ----------------------- Not signed in / not found ---------------------- */
  if (!student) {
    const card = el('section', { class: 'card' });
    card.innerHTML = cardHead('Student Portal', 'Read-only attendance view');
    const body = el('div', { class: 'card-body' });
    body.innerHTML = emptyState('No student session', 'Sign in with your roll number to view your attendance.', '🎒')
      + '<div class="center mt-16"><button class="btn btn-primary" data-goto="#/login">Go to sign in</button></div>';
    card.append(body);
    root.append(card);
    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-goto]');
      if (btn) { clearAllSessions(); window.location.hash = btn.dataset.goto; }
    });
    return { title: 'Student Portal', subtitle: 'Please sign in', element: root };
  }

  const stats = studentStats(student.id);
  const cls = getClass(student.classId);
  const plan = stats.plan;
  const tone = ratioTone(stats.percent, plan.threshold);

  /* --------------------------------- Header -------------------------------- */
  root.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h2', { text: 'My Attendance' }),
      el('p', { text: `${esc(student.rollNo)} · ${esc(cls?.name || '—')} · read-only student view` }),
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', { class: 'btn btn-ghost', type: 'button', html: '⎋ Log out', onclick: logout }),
    ]),
  ]));

  /* ------------------------------- Identity ------------------------------- */
  const identity = el('section', { class: 'card' });
  identity.innerHTML = `
    <div class="card-body">
      <div class="person-head">
        <img class="person-photo" src="${student.photo || avatarDataUri(student.name)}" alt="" />
        <div class="grow">
          <div class="row wrap" style="gap:10px">
            <h2 style="font-size:20px;font-weight:750">${esc(student.name)}</h2>
            ${riskBadge(stats.percent, plan.threshold, stats.total)}
          </div>
          <div class="person-facts">
            <div class="fact"><div class="k">Student ID</div><div class="v">${esc(student.rollNo)}</div></div>
            <div class="fact"><div class="k">Class</div><div class="v">${esc(cls?.name || '—')}</div></div>
            <div class="fact"><div class="k">Sessions held</div><div class="v">${stats.total}</div></div>
          </div>
        </div>
        <div class="center">
          ${progressRing(stats.percent, tone)}
          <div class="small muted mt-8">Required ${plan.threshold}%</div>
        </div>
      </div>

      <div class="grid grid-4 mt-24">
        ${miniStat('Present', stats.present, 'ok')}
        ${miniStat('Late', stats.late, 'warn')}
        ${miniStat('Absent', stats.absent, 'danger')}
        ${miniStat('Attended total', stats.attended, 'brand')}
      </div>
    </div>`;
  root.append(identity);

  /* ------------------------- 75% status + recovery ------------------------ */
  root.append(buildRecovery(student, stats));

  /* --------------------------- Attendance history ------------------------- */
  root.append(buildHistory(stats, cls));

  root.append(el('section', { class: 'card' }, [
    el('div', { class: 'card-body' }, [
      el('div', { html: callout(
        'This is a read-only demo view with fictional data. You cannot mark or change attendance from here.',
        'warn', '🔒',
      ) }),
    ]),
  ]));

  return {
    title: 'My Attendance',
    subtitle: `${student.rollNo} · ${cls?.name || ''} · ${round1(stats.percent)}%`,
    element: root,
  };
}

function logout() {
  clearAllSessions();
  window.location.hash = '#/login';
}

/* ------------------------------- Sub-parts -------------------------------- */

function miniStat(label, value, tone) {
  const colorVar = { brand: 'brand-700', ok: 'ok-700', warn: 'warn-700', danger: 'danger-700' }[tone] || 'ink-900';
  return `<div class="kpi">
    <div class="k">${esc(label)}</div>
    <div class="v" style="color:var(--${colorVar})">${value}</div>
  </div>`;
}

/** 75% status + classes needed + what-if (attend / miss) tables. */
function buildRecovery(student, stats) {
  const plan = stats.plan;
  const bannerTone = !plan.hasData ? '' : plan.below ? 'is-danger' : (plan.atRisk ? 'is-warn' : 'is-ok');

  const card = el('section', { class: 'card' });
  card.innerHTML = cardHead(
    'Attendance Recovery Planner',
    `What-if analysis over your ${plan.total} stored sessions`,
  );

  const body = el('div', { class: 'card-body' });
  const planner = el('div', { class: 'planner' });
  body.append(planner);
  card.append(body);

  planner.append(el('div', { class: `planner-banner ${bannerTone}` }, [
    el('div', { html: progressRing(plan.current, plan.below ? 'danger' : (plan.atRisk ? 'warn' : 'ok')) }),
    el('div', { class: 'grow' }, [
      el('div', { class: 'row wrap', style: 'gap:8px' }, [
        el('span', { class: 'badge badge-brand', text: `Current ${round1(plan.current)}%` }),
        el('span', { class: 'badge', text: `Required ${plan.threshold}%` }),
        el('span', {
          class: plan.below ? 'badge badge-danger' : 'badge badge-ok',
          text: plan.below ? `Below ${plan.threshold}%` : `At/above ${plan.threshold}%`,
        }),
      ]),
      el('h3', { class: 'mt-8', style: 'font-size:16px', text: recoverySentence(plan, student.name.split(' ')[0]) }),
      el('p', {
        class: 'small muted mt-8',
        text: `${plan.attended} attended out of ${plan.total} held classes. Calculated from your stored records.`,
      }),
    ]),
  ]));

  /* Consecutive classes needed to reach 75%. */
  planner.append(el('p', {
    class: 'small strong mt-16',
    text: plan.below
      ? `Consecutive classes needed to reach ${plan.threshold}%: ${Number.isFinite(plan.needed) ? plan.needed : '—'}`
      : `You are at or above ${plan.threshold}%.`,
  }));

  /* What-if tables (reuse plan.missProjection / plan.attendProjection). */
  const tables = el('div', { class: 'grid grid-2 mt-16' });
  tables.innerHTML = `
    <div class="card" style="box-shadow:none">
      <div class="card-head" style="padding:14px 16px"><h3 style="font-size:14px">What if I attend the next…</h3></div>
      <div class="table-wrap">
        <table class="tbl"><thead><tr><th>Classes</th><th class="num">Projected %</th><th class="num">Change</th></tr></thead>
        <tbody>
          ${plan.attendProjection.slice(0, 3).map((row) => `<tr>
            <td>${row.attendedNext} class${row.attendedNext === 1 ? '' : 'es'}</td>
            <td class="num"><strong>${round1(row.percent)}%</strong></td>
            <td class="num" style="color:var(--ok-700)">+${round1(row.percent - plan.current)}%</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
    </div>
    <div class="card" style="box-shadow:none">
      <div class="card-head" style="padding:14px 16px"><h3 style="font-size:14px">What if I miss the next…</h3></div>
      <div class="table-wrap">
        <table class="tbl"><thead><tr><th>Classes</th><th class="num">Projected %</th><th class="num">Change</th></tr></thead>
        <tbody>
          ${plan.missProjection.slice(0, 3).map((row) => `<tr>
            <td>${row.missed} class${row.missed === 1 ? '' : 'es'}</td>
            <td class="num"><strong>${round1(row.percent)}%</strong></td>
            <td class="num" style="color:var(--danger-700)">${round1(row.percent - plan.current)}%</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
    </div>`;
  planner.append(tables);

  return card;
}

function buildHistory(stats, cls) {
  const card = el('section', { class: 'card' });
  card.innerHTML = cardHead('Attendance History', `${stats.sessions.length} sessions for ${cls?.name || 'your class'}`);

  if (!stats.sessions.length) {
    const empty = el('div');
    empty.innerHTML = emptyState('No sessions yet', 'Your attendance history will appear here.', '📅');
    card.append(empty);
    return card;
  }

  // Running percentage computed oldest -> newest, displayed newest first.
  const chronological = [...stats.sessions].reverse();
  let attended = 0;
  let total = 0;
  const rows = chronological.map((entry) => {
    total += 1;
    if (entry.status === 'present' || entry.status === 'late') attended += 1;
    return { ...entry, running: (attended / total) * 100 };
  }).reverse();

  const wrap = el('div', { class: 'table-wrap', style: 'max-height:460px;overflow-y:auto' });
  wrap.innerHTML = `
    <table class="tbl">
      <thead>
        <tr>
          <th>Date</th>
          <th>Session</th>
          <th>Status</th>
          <th>Marked at</th>
          <th>Running %</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((entry) => `
          <tr>
            <td class="nowrap">${esc(formatDate(entry.session.date))}</td>
            <td class="nowrap">${esc(entry.session.label || 'Session')}</td>
            <td>${entry.marked ? statusBadge(entry.status) : '<span class="badge badge-danger">Absent</span>'}</td>
            <td class="nowrap small muted">${entry.record?.markedAt ? esc(new Date(entry.record.markedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : '—'}</td>
            <td style="min-width:140px">${bar(entry.running, ratioTone(entry.running, stats.plan.threshold))}<span class="small muted">${round1(entry.running)}%</span></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  card.append(wrap);
  return card;
}