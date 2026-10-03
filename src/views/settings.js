/**
 * SETTINGS & DEMO
 *
 * Central place for the settings that actually change how the app behaves, plus
 * the demo/data controls used during a presentation.
 *
 * Sections:
 *   - teacher profile (shown in the top bar)
 *   - attendance rules (low-attendance threshold, default class)
 *   - face recognition settings (match threshold) + live engine status
 *   - demo data (reset / clear / export / import)
 *   - recent activity log
 *
 * The app's re-render loop deliberately skips `type: 'settings'` changes so the
 * user can keep typing, so this view refreshes itself after each save.
 */

import {
  getState,
  getSettings,
  getClasses,
  getActiveClassId,
  setActiveClass,
  updateSettings,
  resetDemo,
  clearAll,
  exportStateJSON,
  importStateJSON,
  getActivity,
} from '../lib/store.js';
import {
  el, esc, round1, relativeTime, todayISO, downloadFile, confirmDialog,
  toast, formatDateTime, plural,
} from '../lib/utils.js';
import { cardHead, callout } from '../lib/ui.js';
import {
  getEngineStatus, cameraSupported, cameraBlockedReason, loadModels,
} from '../lib/faceEngine.js';

export function render() {
  const state = getState();
  const settings = getSettings();
  const classes = getClasses();
  const teacher = settings.teacher || {};
  const activity = getActivity(20);

  const rerender = () => window.dispatchEvent(new Event('hashchange'));

  const root = el('div', { class: 'stack' });

  root.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h2', { text: 'Settings & Demo' }),
      el('p', { text: 'Teacher profile, attendance rules, face recognition tuning and demo data controls.' }),
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', {
        class: 'btn btn-outline', type: 'button', html: '⇩ Export backup (JSON)',
        onclick: () => exportBackup(),
      }),
    ]),
  ]));

  /* ------------------------------ Profile -------------------------------- */
  const profileCard = el('section', { class: 'card' });
  profileCard.innerHTML = cardHead('Teacher Profile', 'Shown in the top bar and on exported reports');
  const profileBody = el('div', { class: 'card-body' });
  const profileForm = el('form', { class: 'grid grid-2' });
  profileForm.innerHTML = `
    <div class="field">
      <label for="setName">Teacher name</label>
      <input id="setName" type="text" value="${esc(teacher.name || '')}" placeholder="Prof. Meera Nair" />
    </div>
    <div class="field">
      <label for="setEmail">Email</label>
      <input id="setEmail" type="email" value="${esc(teacher.email || '')}" placeholder="teacher@demo.college" />
    </div>
    <div class="field">
      <label for="setSchool">Institution name</label>
      <input id="setSchool" type="text" value="${esc(settings.schoolName || '')}" placeholder="Sunrise Institute of Technology" />
    </div>
    <div class="field">
      <label for="setActiveClass">Default class</label>
      <select id="setActiveClass">
        ${classes.map((c) => `<option value="${esc(c.id)}" ${c.id === getActiveClassId() ? 'selected' : ''}>${esc(c.name)} · ${esc(c.subject || '')}</option>`).join('')}
      </select>
      <span class="hint">Pre-selected on the dashboard and attendance screens.</span>
    </div>`;
  profileForm.append(el('div', { class: 'row', style: 'justify-content:flex-end;grid-column:1/-1' }, [
    el('button', { class: 'btn btn-primary', type: 'submit', text: 'Save profile' }),
  ]));
  profileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = profileForm.querySelector('#setName').value.trim();
    const email = profileForm.querySelector('#setEmail').value.trim();
    const schoolName = profileForm.querySelector('#setSchool').value.trim();
    const classId = profileForm.querySelector('#setActiveClass').value;
    if (!name) {
      toast('Name required', 'Enter a teacher name before saving.', 'warn');
      return;
    }
    updateSettings({ schoolName, teacher: { name, email: email || 'teacher@demo.college' } });
    if (classId) setActiveClass(classId);
    toast('Profile saved', `${name} · default class updated.`, 'ok');
    rerender();
  });
  profileBody.append(profileForm);
  profileCard.append(profileBody);
  root.append(profileCard);

  /* --------------------------- Attendance rules --------------------------- */
  const rulesCard = el('section', { class: 'card' });
  rulesCard.innerHTML = cardHead('Attendance Rules', 'Drives the low-attendance warnings and the recovery planner');
  const rulesBody = el('div', { class: 'card-body' });
  const rulesForm = el('form', { class: 'stack' });
  rulesForm.innerHTML = `
    <div class="field">
      <label for="setThreshold">Low-attendance threshold (%)</label>
      <input id="setThreshold" type="number" min="1" max="100" step="1" value="${esc(settings.lowAttendanceThreshold ?? 75)}" style="max-width:160px" />
      <span class="hint">Students below this value are flagged on the dashboard, analytics and reports.</span>
    </div>
    <div class="row" style="justify-content:flex-start">
      <button class="btn btn-primary" type="submit">Save threshold</button>
    </div>`;
  rulesForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = Number(rulesForm.querySelector('#setThreshold').value);
    const value = Math.min(100, Math.max(1, Math.round(raw || 75)));
    updateSettings({ lowAttendanceThreshold: value });
    toast('Threshold updated', `Low-attendance warnings now use ${value}%.`, 'ok');
    rerender();
  });
  rulesBody.append(rulesForm);
  rulesBody.append(el('div', { class: 'mt-16', html: callout(
    `Currently <strong>${state.students.length}</strong> students across <strong>${classes.length}</strong> classes. `
    + 'The threshold is used by the recovery planner to work out how many consecutive classes a student must attend.',
    'info', '📐',
  ) }));
  rulesCard.append(rulesBody);
  root.append(rulesCard);

  /* --------------------------- Face recognition --------------------------- */
  const engineStatus = getEngineStatus();
  const faceCard = el('section', { class: 'card' });
  faceCard.innerHTML = cardHead('Face Recognition', 'Match tolerance and the live state of the recognition engine');
  const faceBody = el('div', { class: 'card-body' });

  const threshold = settings.matchThreshold ?? 0.5;
  const slideWrap = el('div', { class: 'field' });
  slideWrap.innerHTML = `
    <label for="setMatch">Match threshold: <strong id="setMatchValue">${round1(threshold * 100) / 100}</strong></label>
    <input id="setMatch" type="range" min="0.3" max="0.8" step="0.01" value="${esc(threshold)}" style="max-width:340px" />
    <span class="hint">Lower = stricter (fewer false matches, more "unknown face"). Higher = looser. Euclidean distance on the 128-d descriptor; default 0.5.</span>`;
  const matchInput = slideWrap.querySelector('#setMatch');
  const matchValue = slideWrap.querySelector('#setMatchValue');
  matchInput.addEventListener('input', () => { matchValue.textContent = Number(matchInput.value).toFixed(2); });
  matchInput.addEventListener('change', () => {
    updateSettings({ matchThreshold: Number(matchInput.value) });
    toast('Match threshold saved', `Recognition now uses ${Number(matchInput.value).toFixed(2)}.`, 'ok');
  });
  faceBody.append(slideWrap);

  const statusGrid = el('div', { class: 'kpi-ribbon mt-16' });
  statusGrid.innerHTML = [
    statusCell('Library', engineStatus.api ? 'Loaded' : 'Not found', engineStatus.api ? 'ok-700' : 'danger-700'),
    statusCell('Models', engineStatus.modelsLoaded ? 'Ready' : (engineStatus.loading ? 'Loading…' : 'Idle'), engineStatus.modelsLoaded ? 'ok-700' : 'warn-700'),
    statusCell('Camera API', cameraSupported() ? 'Available' : 'Unsupported', cameraSupported() ? 'ok-700' : 'danger-700'),
    statusCell('Backend', engineStatus.backend || '—', 'brand-700'),
  ].join('');
  faceBody.append(statusGrid);

  const blocked = cameraBlockedReason();
  if (blocked) {
    faceBody.append(el('div', { class: 'mt-16', html: callout(esc(blocked), 'warn', '⚠') }));
  } else if (!engineStatus.api) {
    faceBody.append(el('div', { class: 'mt-16', html: callout(
      'The face library (vendor/face-api) is not available. Run <code>npm run setup</code> and reload. '
      + 'Manual attendance keeps working regardless.',
      'warn', '⚠',
    ) }));
  } else if (engineStatus.error) {
    faceBody.append(el('div', { class: 'mt-16', html: callout(esc(engineStatus.error), 'danger', '✕') }));
  }

  const loadBtn = el('button', {
    class: 'btn btn-primary mt-16', type: 'button', text: engineStatus.modelsLoaded ? 'Models loaded' : 'Load face models',
    disabled: engineStatus.modelsLoaded || !engineStatus.api,
  });
  loadBtn.addEventListener('click', () => {
    loadBtn.disabled = true;
    loadBtn.textContent = 'Loading…';
    loadModels((info) => { loadBtn.textContent = `${info.message} (${info.progress}%)`; })
      .then(() => { toast('Face models ready', 'Face attendance can now recognise enrolled students.', 'ok'); rerender(); })
      .catch((error) => {
        toast('Could not load models', String(error?.message || error), 'danger');
        loadBtn.disabled = false;
        loadBtn.textContent = 'Retry loading models';
      });
  });
  faceBody.append(loadBtn);
  faceBody.append(el('div', { class: 'mt-16', html: callout(
    'This is a prototype, not production biometrics. There is no liveness detection and accuracy depends on lighting, '
    + 'camera quality and angle. Only enrol fictional demo students, and never capture real people without consent.',
    'warn', '🔒',
  ) }));
  faceCard.append(faceBody);
  root.append(faceCard);

  /* ------------------------------ Demo data ------------------------------- */
  const meta = state.meta || {};
  const dataCard = el('section', { class: 'card' });
  dataCard.innerHTML = cardHead('Demo Data', 'Reset, clear, back up or restore the locally stored demo dataset');
  const dataBody = el('div', { class: 'card-body' });
  dataBody.append(el('div', { class: 'kpi-ribbon' }, [
    statusCell('Students', String(state.students.length), 'brand-700'),
    statusCell('Sessions', String(state.sessions.length), 'brand-700'),
    statusCell('Records', String(state.attendance.length), 'brand-700'),
    statusCell('Seed version', String(meta.version ?? '—'), 'brand-700'),
  ]));
  dataBody.append(el('p', {
    class: 'small muted mt-16',
    text: `Last updated ${meta.updatedAt ? formatDateTime(meta.updatedAt) : '—'} · stored locally in this browser only.`,
  }));

  const dataActions = el('div', { class: 'row wrap mt-16', style: 'gap:10px' });
  dataActions.append(
    el('button', {
      class: 'btn btn-outline', type: 'button', html: '⇩ Export backup',
      onclick: () => exportBackup(),
    }),
    el('label', { class: 'btn btn-outline', style: 'cursor:pointer' }, [
      el('span', { text: '⇧ Import backup' }),
      el('input', {
        type: 'file', accept: 'application/json,.json', style: 'display:none',
        onchange: (event) => importBackup(event.target),
      }),
    ]),
    el('button', {
      class: 'btn btn-outline', type: 'button', html: '↺ Demo Reset',
      onclick: async () => {
        const yes = await confirmDialog({
          title: 'Reset demo data',
          message: 'Restore the original fictional dataset? Any changes you made will be lost.',
          confirmLabel: 'Reset demo', tone: 'primary',
        });
        if (!yes) return;
        resetDemo();
        toast('Demo data reset', 'The original fictional dataset has been restored.', 'ok');
        rerender();
      },
    }),
    el('button', {
      class: 'btn btn-danger', type: 'button', html: '🗑 Clear all data',
      onclick: async () => {
        const yes = await confirmDialog({
          title: 'Clear all data',
          message: 'Remove every student, session and attendance record? This shows the empty onboarding state. Use Demo Reset to restore.',
          confirmLabel: 'Clear everything', tone: 'danger',
        });
        if (!yes) return;
        clearAll();
        toast('All data cleared', 'The app is now empty — use Demo Reset to restore the demo.', 'warn');
        rerender();
      },
    }),
  );
  dataBody.append(dataActions);
  dataCard.append(dataBody);
  root.append(dataCard);

  /* ------------------------------- Activity ------------------------------- */
  const feedCard = el('section', { class: 'card' });
  feedCard.innerHTML = cardHead('Recent Activity', 'The latest events recorded by the app');
  if (!activity.length) {
    feedCard.append(el('div', { class: 'card-body' }, [
      el('p', { class: 'small muted', text: 'No activity recorded yet.' }),
    ]));
  } else {
    const feed = el('div', { class: 'feed' });
    for (const item of activity) {
      const dot = el('span', { class: `feed-dot is-${item.type}` });
      feed.append(el('div', { class: 'feed-item' }, [
        dot,
        el('div', { class: 'feed-body' }, [
          el('strong', { text: item.message }),
          el('div', { class: 'small muted', text: `${item.type} · ${formatDateTime(item.at)}` }),
        ]),
        el('span', { class: 'feed-time', text: relativeTime(item.at) }),
      ]));
    }
    feedCard.append(feed);
  }
  root.append(feedCard);

  return {
    title: 'Settings & Demo',
    subtitle: `${teacher.name || 'Teacher'} · ${settings.schoolName || 'Institution'} · ${plural(state.students.length, 'student')}`,
    element: root,
    // Settings changes are handled here, so the shell must not force a re-render.
    refreshOnChange: false,
  };
}

/* ------------------------------- Sub-parts -------------------------------- */

function statusCell(label, value, colorVar) {
  return `<div class="kpi">
    <div class="k">${esc(label)}</div>
    <div class="v" style="color:var(--${colorVar})">${esc(value)}</div>
  </div>`;
}

function exportBackup() {
  downloadFile(`smart-attendance-backup-${todayISO()}.json`, exportStateJSON(), 'application/json');
  toast('Backup exported', 'A JSON snapshot of the current demo data was downloaded.', 'ok');
}

function importBackup(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      importStateJSON(String(reader.result));
      toast('Backup imported', 'The demo data was restored from your file.', 'ok');
    } catch (error) {
      toast('Import failed', String(error?.message || error), 'danger');
    } finally {
      input.value = '';
    }
  };
  reader.onerror = () => {
    toast('Import failed', 'The file could not be read.', 'danger');
    input.value = '';
  };
  reader.readAsText(file);
}