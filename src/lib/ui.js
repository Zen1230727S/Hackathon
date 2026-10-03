/**
 * Reusable HTML snippets shared by the views.
 * Kept as template-string helpers so views stay short and readable.
 */

import { esc, bar, round1, statusBadge, avatarDataUri, formatDateShort, ratioTone } from './utils.js';

/** One dashboard/analytics stat card. */
export function statCard({ label, value, unit = '', foot = '', icon = '•', tone = 'brand', percent = null }) {
  const barHtml = percent === null ? '' : `<div class="mini-bar">${bar(percent, ratioTone(percent, 75))}</div>`;
  return `
    <article class="stat stat-${tone}">
      <div class="stat-top">
        <span class="stat-label">${esc(label)}</span>
        <span class="stat-ico" aria-hidden="true">${icon}</span>
      </div>
      <div class="stat-value">${esc(String(value))}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
      ${foot ? `<div class="stat-foot">${foot}</div>` : ''}
      ${barHtml}
    </article>`;
}

/** Section header with optional actions on the right. */
export function cardHead(title, subtitle = '', actionsHtml = '') {
  return `
    <div class="card-head">
      <div>
        <h2>${esc(title)}</h2>
        ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
      </div>
      ${actionsHtml ? `<div class="row">${actionsHtml}</div>` : ''}
    </div>`;
}

/** Avatar + name + roll number table cell. */
export function studentCell(student) {
  const photo = student.photo || avatarDataUri(student.name);
  return `
    <div class="cell-student">
      <img class="avatar" src="${photo}" alt="" width="34" height="34" style="border-radius:10px;object-fit:cover;" />
      <div>
        <div class="cell-name">${esc(student.name)}</div>
        <div class="cell-sub">${esc(student.rollNo)}</div>
      </div>
    </div>`;
}

/** Attendance percentage with a small bar and a risk badge. */
export function percentCell(percent, threshold = 75, total = 1) {
  if (!total) return '<span class="muted small">No data</span>';
  const tone = ratioTone(percent, threshold);
  return `
    <div style="min-width:132px">
      <div class="row-between" style="margin-bottom:5px">
        <strong>${round1(percent)}%</strong>
        ${riskBadge(percent, threshold, total)}
      </div>
      ${bar(percent, tone)}
    </div>`;
}

export function riskBadge(percent, threshold = 75, total = 1) {
  if (!total) return '<span class="badge">No data</span>';
  if (percent < threshold) return '<span class="badge badge-danger">Below</span>';
  if (percent < threshold + 4) return '<span class="badge badge-warn">At risk</span>';
  return '<span class="badge badge-ok">Safe</span>';
}

/** Present / absent / late counts rendered as small pills. */
export function countPills(stats) {
  return `
    <div class="row" style="gap:6px">
      <span class="badge badge-ok">${stats.present} P</span>
      <span class="badge badge-warn">${stats.late} L</span>
      <span class="badge badge-danger">${stats.absent} A</span>
    </div>`;
}

/** Standard "nothing here yet" block. */
export function emptyState(title, message, icon = '🗂') {
  return `
    <div class="empty">
      <div class="empty-ico">${icon}</div>
      <h3>${esc(title)}</h3>
      <p class="small">${esc(message)}</p>
    </div>`;
}

/** Class/session <select> markup. */
export function classOptions(classes, selectedId) {
  return classes
    .map((c) => `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)} · ${esc(c.subject || '')}</option>`)
    .join('');
}

export function sessionOptions(sessions, selectedId, { includeEmpty = false } = {}) {
  const options = sessions
    .map((s) => `<option value="${esc(s.id)}" ${s.id === selectedId ? 'selected' : ''}>${esc(formatDateShort(s.date))} · ${esc(s.startTime || '')} · ${s.status === 'open' ? 'Open' : 'Closed'}</option>`)
    .join('');
  return (includeEmpty ? '<option value="">— select a session —</option>' : '') + options;
}

/** Attendance status badge with method information. */
export function statusWithMethod(record) {
  if (!record) return '<span class="badge">Not marked</span>';
  const method = record.method === 'face' ? ' <span class="badge badge-violet">Face</span>' : ' <span class="badge">Manual</span>';
  return statusBadge(record.status) + method;
}

/** Thin colored callout box. */
export function callout(message, tone = 'info', icon = 'ℹ') {
  const cls = tone === 'info' ? '' : `is-${tone}`;
  return `<div class="callout ${cls}"><span class="co-ico">${icon}</span><div>${message}</div></div>`;
}