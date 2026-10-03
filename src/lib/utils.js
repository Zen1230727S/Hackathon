/**
 * Small helpers shared by every view: DOM lookup, escaping, dates, CSV.
 * No framework - everything here is plain browser JavaScript.
 */

/* ------------------------------- DOM helpers ------------------------------ */
export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Escape a value before putting it inside an HTML template string. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function debounce(fn, wait = 220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* --------------------------------- Numbers -------------------------------- */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const round1 = (value) => Math.round(value * 10) / 10;

/** Map a 0..1 ratio to a CSS bar / badge tone. */
export function ratioTone(percent, threshold = 75) {
  if (percent < threshold) return 'danger';
  if (percent < threshold + 8) return 'warn';
  return 'ok';
}

/* ---------------------------------- Dates --------------------------------- */
/** Local date as YYYY-MM-DD (NOT UTC - avoids off-by-one-day bugs). */
export function toISODate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO() {
  return toISODate(new Date());
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysBetween(isoA, isoB) {
  const a = new Date(`${isoA}T00:00:00`).getTime();
  const b = new Date(`${isoB}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDate(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateShort(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function relativeTime(value) {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return '—';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(toISODate(value));
}

/** "2026-02-14" -> "Saturday" */
export function weekdayName(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
}

/* ---------------------------------- Text ---------------------------------- */
export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase();
}

export function titleCase(text) {
  return String(text || '').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : (pluralForm || `${singular}s`)}`;
}

/* ------------------------------ Demo avatars ------------------------------ */
const AVATAR_PALETTE = [
  ['#eef4ff', '#2454c4'], ['#e8f8ef', '#157f3c'], ['#fff6e6', '#a66300'],
  ['#f1ecff', '#5b3fd0'], ['#fdecec', '#a51f1f'], ['#e6f7fb', '#0e7490'],
  ['#fdf0f7', '#a1246b'], ['#eef1f6', '#33415a'],
];

/**
 * Builds a deterministic illustrated avatar as an SVG data URI.
 * Deliberately synthetic - this prototype must not use real people's photos.
 */
export function avatarDataUri(name) {
  const letters = initials(name);
  let hash = 0;
  for (let i = 0; i < letters.length; i += 1) hash = (hash * 31 + letters.charCodeAt(i)) % 9973;
  const [bg, fg] = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="20" fill="${bg}"/>
  <circle cx="48" cy="38" r="16" fill="${fg}" opacity="0.28"/>
  <path d="M18 88c2-16 14-24 30-24s28 8 30 24z" fill="${fg}" opacity="0.22"/>
  <text x="48" y="56" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="30" font-weight="700"
        fill="${fg}" text-anchor="middle" dominant-baseline="middle">${letters}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ----------------------------------- CSV ---------------------------------- */
export function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCSV(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\r\n');
}

export function downloadFile(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([`\uFEFF${content}`], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* -------------------------------- UI helpers ------------------------------ */
export function toast(title, message = '', tone = 'info', timeout = 3800) {
  const stack = qs('#toastStack');
  if (!stack) return;
  const node = el('div', { class: `toast is-${tone}` }, [
    el('div', { class: 'grow' }, [
      el('strong', { text: title }),
      message ? el('small', { text: message }) : null,
    ]),
  ]);
  stack.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s ease, transform .2s ease';
    node.style.opacity = '0';
    node.style.transform = 'translateX(18px)';
    setTimeout(() => node.remove(), 220);
  }, timeout);
}

export function openModal(title, bodyNode) {
  const backdrop = qs('#modalBackdrop');
  qs('#modalTitle').textContent = title;
  const body = qs('#modalBody');
  body.replaceChildren(bodyNode);
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
}

export function closeModal() {
  const backdrop = qs('#modalBackdrop');
  if (!backdrop || backdrop.hidden) return;
  backdrop.hidden = true;
  qs('#modalBody').replaceChildren();
  document.body.style.overflow = '';
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', tone = 'primary' }) {
  return new Promise((resolve) => {
    const body = el('div', { class: 'stack' }, [
      el('p', { text: message }),
      el('div', { class: 'row', style: 'justify-content:flex-end' }, [
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => { closeModal(); resolve(false); } }),
        el('button', { class: `btn btn-${tone}`, type: 'button', text: confirmLabel, onclick: () => { closeModal(); resolve(true); } }),
      ]),
    ]);
    openModal(title, body);
  });
}

/** Renders an SVG donut showing a percentage. */
export function progressRing(percent, tone = 'ok') {
  const value = clamp(Number(percent) || 0, 0, 100);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);
  const color = { ok: 'var(--ok-500)', warn: 'var(--warn-500)', danger: 'var(--danger-500)', brand: 'var(--brand-600)' }[tone] || 'var(--brand-600)';
  return `<div class="ring">
    <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
      <circle class="ring-track" cx="48" cy="48" r="${radius}"></circle>
      <circle class="ring-val" cx="48" cy="48" r="${radius}" stroke="${color}"
              stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"></circle>
    </svg>
    <span class="ring-label">${round1(value)}%</span>
  </div>`;
}

export function bar(percent, tone = 'ok', extraClass = '') {
  const value = clamp(Number(percent) || 0, 0, 100);
  return `<div class="bar ${tone === 'ok' ? '' : `is-${tone}`} ${extraClass}">
    <span style="width:${value}%"></span>
  </div>`;
}

export function badge(text, tone = '') {
  return `<span class="badge ${tone ? `badge-${tone}` : ''}">${esc(text)}</span>`;
}

export function statusBadge(status) {
  if (status === 'present') return '<span class="badge badge-ok">Present</span>';
  if (status === 'late') return '<span class="badge badge-warn">Late</span>';
  if (status === 'absent') return '<span class="badge badge-danger">Absent</span>';
  return '<span class="badge">Not marked</span>';
}

/** Resize/crop an image-like source into a small square JPEG data URI. */
export function toThumbnail(source, size = 240) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    const side = Math.min(sw, sh);
    ctx.drawImage(source, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, size, size);
    resolve(canvas.toDataURL('image/jpeg', 0.78));
  });
}