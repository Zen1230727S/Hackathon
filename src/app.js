/**
 * Application entry point.
 *
 * Responsibilities:
 *   - initialise the store (seeds fictional demo data on first run)
 *   - a tiny hash router (#/dashboard, #/students/:id, ...)
 *   - shell chrome: sidebar, topbar, mobile menu, modal close button
 *
 * Views live in ./views/*.js and each exports:
 *   render(ctx) -> { title, subtitle, element, destroy? }
 * where ctx = { params: string[], query: URLSearchParams, navigate }
 */

import { getState, getSettings, subscribe, save } from './lib/store.js';
import { qs, formatDate, todayISO, closeModal, toast } from './lib/utils.js';

import * as dashboard from './views/dashboard.js';
import * as students from './views/students.js';
import * as studentDetail from './views/studentDetail.js';
import * as attendance from './views/attendance.js';
import * as faceAttendance from './views/faceAttendance.js';
import * as enrollment from './views/enrollment.js';
import * as analytics from './views/analytics.js';
import * as reports from './views/reports.js';
import * as settings from './views/settings.js';

/* --------------------------------- routes --------------------------------- */

const routes = [
  { pattern: [], view: dashboard, nav: 'dashboard' },
  { pattern: ['dashboard'], view: dashboard, nav: 'dashboard' },
  { pattern: ['students'], view: students, nav: 'students' },
  { pattern: ['students', ':id'], view: studentDetail, nav: 'students' },
  { pattern: ['attendance'], view: attendance, nav: 'attendance' },
  { pattern: ['face'], view: faceAttendance, nav: 'face' },
  { pattern: ['enrollment'], view: enrollment, nav: 'enrollment' },
  { pattern: ['analytics'], view: analytics, nav: 'analytics' },
  { pattern: ['reports'], view: reports, nav: 'reports' },
  { pattern: ['settings'], view: settings, nav: 'settings' },
];

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  return { segments, query: new URLSearchParams(queryPart || '') };
}

function matchRoute(segments) {
  for (const route of routes) {
    if (route.pattern.length !== segments.length) continue;
    const params = [];
    let ok = true;
    route.pattern.forEach((token, index) => {
      if (token.startsWith(':')) params.push(decodeURIComponent(segments[index]));
      else if (token !== segments[index]) ok = false;
    });
    if (ok) return { route, params };
  }
  return null;
}

/* ---------------------------------- shell --------------------------------- */

let currentView = null;

function renderShellUser() {
  const settings = getSettings();
  const teacher = settings.teacher || {};
  const name = teacher.name || 'Teacher';
  const parts = name.replace(/^Prof\.\s*/i, '').trim().split(/\s+/);
  qs('#teacherName').textContent = name;
  qs('#teacherEmail').textContent = teacher.email || 'teacher@demo.college';
  qs('#teacherAvatar').textContent = (parts[0]?.[0] || 'T') + (parts[1]?.[0] || '');
  qs('#todayPill').textContent = formatDate(todayISO());
}

function setActiveNav(navKey) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.route === navKey);
  });
}

export function navigate(path) {
  window.location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
}

function renderRoute() {
  const { segments, query } = parseHash();
  const matched = matchRoute(segments) || { route: routes[0], params: [] };

  // Tear down the previous view (stops cameras, clears intervals).
  if (currentView && typeof currentView.destroy === 'function') {
    try {
      currentView.destroy();
    } catch (error) {
      console.warn('[app] view destroy failed:', error);
    }
  }
  currentView = null;

  setActiveNav(matched.route.nav);
  qs('#sidebar').classList.remove('is-open');

  const host = qs('#view');
  host.replaceChildren();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

  let result;
  try {
    result = matched.route.view.render({ params: matched.params, query, navigate });
  } catch (error) {
    console.error('[app] view render failed:', error);
    host.innerHTML = `<div class="card"><div class="card-body">
      <h3>Something went wrong while rendering this page</h3>
      <p class="muted small mt-8">${String(error.message || error)}</p>
      <button class="btn btn-primary mt-16" onclick="window.location.hash='#/dashboard'">Back to dashboard</button>
    </div></div>`;
    return;
  }

  if (!result || !result.element) return;
  currentView = result;
  qs('#pageTitle').textContent = result.title || 'Smart Attendance';
  qs('#pageSubtitle').textContent = result.subtitle || '';
  host.append(result.element);
  if (typeof result.mount === 'function') {
    try {
      result.mount();
    } catch (error) {
      console.error('[app] view mount failed:', error);
    }
  }
}

/* ---------------------------------- boot ---------------------------------- */

function boot() {
  getState();          // seeds fictional demo data on the very first run
  save();
  renderShellUser();
  renderRoute();

  window.addEventListener('hashchange', renderRoute);

  qs('#menuBtn').addEventListener('click', () => {
    qs('#sidebar').classList.toggle('is-open');
  });

  qs('#modalClose').addEventListener('click', closeModal);
  qs('#modalBackdrop').addEventListener('click', (event) => {
    if (event.target === qs('#modalBackdrop')) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });

  // Re-render the current page whenever data changes, so every screen stays
  // consistent with the one data model.
  subscribe((_state, detail) => {
    renderShellUser();
    if (detail && detail.type === 'settings') return; // settings page renders itself
    if (currentView && currentView.refreshOnChange === false) return;
    renderRoute();
  });

  // Keyboard shortcut: G then D is overkill - a single key is friendlier.
  document.addEventListener('keydown', (event) => {
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (event.key === 'f' && !event.ctrlKey && !event.metaKey) {
      navigate('/face');
    }
  });

  if (!window.location.hash) navigate('/dashboard');

  // Small startup hint about the face library (non-blocking).
  window.addEventListener('load', () => {
    if (!window.faceapi) {
      toast('Face library not found', 'Run "npm run setup" to enable face recognition. Manual attendance works.', 'warn', 7000);
    }
  });
}

boot();