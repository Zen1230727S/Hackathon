/**
 * Student detail view.
 *
 * Sections:
 *   - identity header with attendance ring
 *   - ATTENDANCE RECOVERY / WHAT-IF PLANNER (the product USP)
 *   - attendance history table (present / late / absent per session)
 */

import {
  getStudent,
  studentStats,
  getClass,
  getAttendanceForStudent,
  getSession,
} from '../lib/store.js';
import {
  el, esc, round1, avatarDataUri, progressRing, bar, ratioTone, formatDate,
  statusBadge, toCSV, downloadFile, todayISO, toast,
} from '../lib/utils.js';
import { cardHead, emptyState, callout, riskBadge } from '../lib/ui.js';
import { recoverySentence } from '../lib/analytics.js';
import { openStudentForm } from './students.js';

export function render({ params }) {
  const student = getStudent(params[0]);
  if (!student) {
    const missing = el('div', { class: 'card' });
    missing.innerHTML = `<div class="card-body">${emptyState('Student not found', 'This student may have been deleted. Use Demo Reset to restore the demo data.', '🔎')}
      <div class="center"><button class="btn btn-primary" onclick="window.location.hash='#/students'">Back to students</button></div></div>`;
    return { title: 'Student', subtitle: 'Not found', element: missing };
  }

  const stats = studentStats(student.id);
  const cls = getClass(student.classId);
  const plan = stats.plan;
  const tone = ratioTone(stats.percent, plan.threshold);

  const root = el('div', { class: 'stack' });

  /* ------------------------- Back + action buttons ------------------------ */
  root.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('button', { class: 'btn btn-sm btn-ghost', type: 'button', html: '← Back to students', onclick: () => { window.location.hash = '#/students'; } }),
      el('h2', { class: 'mt-8', text: student.name }),
      el('p', { text: `${student.rollNo} · ${cls?.name || '—'} · ${cls?.subject || ''}` }),
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', { class: 'btn btn-outline', type: 'button', html: '✎ Edit details', onclick: () => openStudentForm(student.id) }),
      el('button', { class: 'btn btn-outline', type: 'button', html: '⇩ Export history', onclick: () => exportHistory(student) }),
      el('button', { class: 'btn btn-primary', type: 'button', html: '◉ Enroll face', onclick: () => { window.location.hash = `#/enrollment?student=${student.id}`; } }),
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
            ${Array.isArray(student.descriptor) && student.descriptor.length
              ? '<span class="badge badge-violet">Face enrolled</span>'
              : '<span class="badge">Face not enrolled</span>'}
          </div>
          <div class="person-facts">
            <div class="fact"><div class="k">Roll number</div><div class="v">${esc(student.rollNo)}</div></div>
            <div class="fact"><div class="k">Class</div><div class="v">${esc(cls?.name || '—')}</div></div>
            <div class="fact"><div class="k">Email</div><div class="v">${esc(student.email || '—')}</div></div>
            <div class="fact"><div class="k">Sessions held</div><div class="v">${stats.total}</div></div>
            <div class="fact"><div class="k">Current streak</div><div class="v">${stats.streak} attended</div></div>
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

  /* ------------------------ RECOVERY / WHAT-IF PANEL ---------------------- */
  root.append(recoveryPanel(student, stats));

  /* --------------------------- Attendance history ------------------------- */
  const historyCard = el('section', { class: 'card' });
  historyCard.innerHTML = cardHead('Attendance History', `${stats.sessions.length} sessions recorded for ${cls?.name || 'this class'}`);

  if (!stats.sessions.length) {
    const empty = el('div');
    empty.innerHTML = emptyState('No sessions yet', 'Create an attendance session to start building history.', '📅');
    historyCard.append(empty);
  } else {
    const wrap = el('div', { class: 'table-wrap', style: 'max-height:460px;overflow-y:auto' });
    wrap.innerHTML = `
      <table class="tbl">
        <thead>
          <tr>
            <th>Date</th>
            <th>Session</th>
            <th>Status</th>
            <th>Method</th>
            <th>Marked at</th>
            <th>Running %</th>
          </tr>
        </thead>
        <tbody>${buildHistoryRows(stats)}</tbody>
      </table>`;
    historyCard.append(wrap);
  }
  root.append(historyCard);

  /* ------------------------ Privacy / limitation note --------------------- */
  root.append(el('section', { class: 'card' }, [
    el('div', { class: 'card-body' }, [
      el('div', { html: callout(
        'Demo prototype with fictional data. Face recognition here is demonstrative only — it is not production biometrics and has no liveness detection. A real deployment needs consent, access controls, retention limits and legal review.',
        'warn', '🔒',
      ) }),
    ]),
  ]));

  return {
    title: student.name,
    subtitle: `${student.rollNo} · ${cls?.name || ''} · ${round1(stats.percent)}% attendance`,
    element: root,
  };
}

/* ------------------------------- Sub-parts -------------------------------- */

function miniStat(label, value, tone) {
  const colorVar = { brand: 'brand-700', ok: 'ok-700', warn: 'warn-700', danger: 'danger-700' }[tone] || 'ink-900';
  return `<div class="kpi">
    <div class="k">${esc(label)}</div>
    <div class="v" style="color:var(--${colorVar})">${value}</div>
  </div>`;
}

/** The differentiator: deterministic recovery + what-if simulation. */
function recoveryPanel(student, stats) {
  const plan = stats.plan;
  const bannerTone = !plan.hasData ? '' : plan.below ? 'is-danger' : (plan.atRisk ? 'is-warn' : 'is-ok');

  const card = el('section', { class: 'card' });
  card.innerHTML = cardHead(
    'Attendance Recovery Planner',
    "Deterministic what-if analysis over this student's existing records",
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
          text: plan.below ? `Short by ${round1(plan.gap)}%` : 'Above requirement',
        }),
      ]),
      el('h3', { class: 'mt-8', style: 'font-size:16px', text: recoverySentence(plan, student.name.split(' ')[0]) }),
      el('p', {
        class: 'small muted mt-8',
        text: `${plan.attended} attended out of ${plan.total} held classes. Calculated from real stored records — no AI or estimation involved.`,
      }),
    ]),
  ]));

  /* Recovery path visual: one dot per class that must be attended. */
  if (plan.below && plan.canRecover && Number.isFinite(plan.needed)) {
    const dots = el('div', { class: 'planner-steps' });
    const shown = Math.min(plan.needed, 24);
    for (let i = 0; i < shown; i += 1) dots.append(el('span', { class: 'step-dot', text: String(i + 1) }));
    if (plan.needed > shown) dots.append(el('span', { class: 'step-dot is-goal', text: `+${plan.needed - shown}` }));
    planner.append(el('div', {}, [
      el('p', { class: 'small strong', text: `Consecutive classes needed to reach ${plan.threshold}%` }),
      el('div', { class: 'mt-8' }, [dots]),
    ]));
  }

  /* --------------------------- What-if simulator -------------------------- */
  const simCard = el('div', { class: 'card', style: 'box-shadow:none' });
  simCard.innerHTML = `
    <div class="card-head" style="padding:14px 16px">
      <div>
        <h3 style="font-size:14px">What-If Simulator</h3>
        <p>Projected attendance after future classes</p>
      </div>
    </div>
    <div class="card-body">
      <div class="whatif-controls">
        <label class="small strong" for="simFuture">Future classes:</label>
        <input id="simFuture" type="number" min="1" max="40" value="3" style="width:96px" />
        <div class="segmented" id="simMode">
          <button type="button" data-mode="miss" class="is-active">If absent</button>
          <button type="button" data-mode="attend">If present</button>
        </div>
      </div>
      <div class="whatif-grid mt-16" id="simOut"></div>
      <p class="small muted mt-8" id="simNote"></p>
    </div>`;
  planner.append(simCard);

  /* Fixed projection tables from the analytics module. */
  const tables = el('div', { class: 'grid grid-2' });
  tables.innerHTML = `
    <div class="card" style="box-shadow:none">
      <div class="card-head" style="padding:14px 16px"><h3 style="font-size:14px">If they miss the next…</h3></div>
      <div class="table-wrap">
        <table class="tbl"><thead><tr><th>Classes missed</th><th class="num">Projected %</th><th class="num">Change</th></tr></thead>
        <tbody>
          ${plan.missProjection.map((row) => `<tr>
            <td>${row.missed} class${row.missed === 1 ? '' : 'es'}</td>
            <td class="num"><strong>${round1(row.percent)}%</strong></td>
            <td class="num" style="color:var(--danger-700)">${round1(row.percent - plan.current)}%</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
    </div>
    <div class="card" style="box-shadow:none">
      <div class="card-head" style="padding:14px 16px"><h3 style="font-size:14px">If they attend the next…</h3></div>
      <div class="table-wrap">
        <table class="tbl"><thead><tr><th>Classes attended</th><th class="num">Projected %</th><th class="num">Change</th></tr></thead>
        <tbody>
          ${plan.attendProjection.map((row) => `<tr>
            <td>${row.attendedNext} class${row.attendedNext === 1 ? '' : 'es'}</td>
            <td class="num"><strong>${round1(row.percent)}%</strong></td>
            <td class="num" style="color:var(--ok-700)">+${round1(row.percent - plan.current)}%</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
    </div>`;
  planner.append(tables);

  planner.append(el('div', { html: callout(
    `Safe-skip allowance: this student can currently miss <strong>${plan.missable === Infinity ? 'any number of' : plan.missable}</strong> more class${plan.missable === 1 ? '' : 'es'} and still stay at or above ${plan.threshold}%.`,
    plan.missable > 0 ? 'ok' : 'warn', '📐',
  ) }));

  /* Wire the simulator (pure arithmetic, recalculated on every input change). */
  const input = simCard.querySelector('#simFuture');
  const modeWrap = simCard.querySelector('#simMode');
  const out = simCard.querySelector('#simOut');
  const note = simCard.querySelector('#simNote');
  let mode = 'miss';

  const recalc = () => {
    const n = Math.max(1, Math.min(40, Number(input.value) || 1));
    const rows = [];
    for (let i = 1; i <= n; i += 1) {
      const projected = mode === 'miss'
        ? (plan.attended / (plan.total + i)) * 100
        : ((plan.attended + i) / (plan.total + i)) * 100;
      rows.push({ i, projected, delta: projected - plan.current });
    }
    out.innerHTML = rows.map((row) => `
      <div class="whatif-cell" style="border-color:${row.projected < plan.threshold ? '#f4c2c2' : '#b6e5c8'}">
        <div class="k">Next ${row.i} class${row.i === 1 ? '' : 'es'} ${mode === 'miss' ? 'missed' : 'attended'}</div>
        <div class="v" style="color:${row.projected < plan.threshold ? 'var(--danger-700)' : 'var(--ok-700)'}">${round1(row.projected)}%</div>
        <div class="d" style="color:${row.delta < 0 ? 'var(--danger-700)' : 'var(--ok-700)'}">${row.delta >= 0 ? '+' : ''}${round1(row.delta)}%</div>
      </div>`).join('');

    if (plan.total === 0) {
      note.textContent = 'No sessions have been held yet — projections become meaningful once attendance is recorded.';
    } else if (plan.current >= plan.threshold && mode === 'attend') {
      note.textContent = `Already above ${plan.threshold}%. Attending more classes still nudges the average up.`;
    } else {
      note.textContent = mode === 'miss'
        ? `Current: ${round1(plan.current)}% · Required: ${plan.threshold}% · Assumes all other records stay unchanged.`
        : `Current: ${round1(plan.current)}% · Required: ${plan.threshold}% · Assumes the student attends every upcoming class.`;
    }
  };

  input.addEventListener('input', recalc);
  modeWrap.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    mode = button.dataset.mode;
    modeWrap.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === button));
    recalc();
  });
  recalc();

  return card;
}

function buildHistoryRows(stats) {
  // Running percentage computed oldest -> newest, displayed newest first.
  const chronological = [...stats.sessions].reverse();
  let attended = 0;
  let total = 0;
  const rows = chronological.map((entry) => {
    total += 1;
    if (entry.status === 'present' || entry.status === 'late') attended += 1;
    return { ...entry, running: (attended / total) * 100 };
  }).reverse();

  return rows.map((entry) => `
    <tr>
      <td class="nowrap">${esc(formatDate(entry.session.date))}</td>
      <td class="nowrap">${esc(entry.session.label || 'Session')}</td>
      <td>${entry.marked ? statusBadge(entry.status) : '<span class="badge badge-danger">Absent</span>'}</td>
      <td>${entry.record?.method === 'face'
        ? '<span class="badge badge-violet">Face</span>'
        : entry.record ? '<span class="badge">Manual</span>' : '<span class="muted small">Not recorded</span>'}</td>
      <td class="nowrap small muted">${entry.record?.markedAt ? esc(new Date(entry.record.markedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : '—'}</td>
      <td style="min-width:140px">${bar(entry.running, ratioTone(entry.running, stats.plan.threshold))}<span class="small muted">${round1(entry.running)}%</span></td>
    </tr>`).join('');
}

function exportHistory(student) {
  const records = getAttendanceForStudent(student.id);
  const headers = ['Date', 'Session', 'Status', 'Method', 'Marked at'];
  const rows = records.map((r) => [
    r.date,
    getSession(r.sessionId)?.label || r.sessionId,
    r.status,
    r.method,
    r.markedAt || '',
  ]);
  downloadFile(`${student.rollNo}-attendance-${todayISO()}.csv`, toCSV(headers, rows));
  toast('Export complete', `${rows.length} records exported.`, 'ok');
}