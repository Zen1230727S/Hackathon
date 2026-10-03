/**
 * FACE ENROLLMENT
 *
 * The only place in the app where a student receives a "reference face".
 * There are two clearly separated paths:
 *
 *   1. LIVE CAPTURE (recommended) - the camera takes 3 samples and the
 *      descriptors are averaged into one stable reference descriptor.
 *   2. SIMULATED REFERENCE - a deterministic pseudo-descriptor used only when a
 *      camera is unavailable, so the rest of the demo can still be shown. It is
 *      labelled as a simulation everywhere and is NOT real biometric data.
 *
 * Privacy: every capture stays in this browser's localStorage. No image and no
 * descriptor is uploaded anywhere. A real deployment would need consent, access
 * control, retention limits and institutional/legal review.
 */

import {
  getState,
  getClasses,
  getClass,
  getStudentsByClass,
  getActiveClassId,
  setActiveClass,
  enrollFace,
  removeEnrollment,
  getEnrolledStudents,
} from '../lib/store.js';
import {
  el, esc, debounce, toast, openModal, closeModal, confirmDialog,
  avatarDataUri, toThumbnail, clamp,
} from '../lib/utils.js';
import { cardHead, emptyState, callout, classOptions } from '../lib/ui.js';
import {
  loadModels, getEngineStatus, startCamera, stopCamera, describeCameraError,
  cameraSupported, cameraBlockedReason, captureDescriptor, averageDescriptors,
  simulatedDescriptor,
} from '../lib/faceEngine.js';

/** Module-scope filters so they survive the re-render after an enrollment. */
const filters = { classId: '', search: '', scope: 'all' };

/** Live handle to the open capture dialog (so the camera can be stopped). */
let activeEnrollment = null;
let modalObserver = null;

const isEnrolled = (student) => Array.isArray(student?.descriptor) && student.descriptor.length > 0;

export function render({ query }) {
  const classes = getClasses();
  if (!classes.length) {
    const empty = el('div', { class: 'card' });
    empty.innerHTML = `<div class="card-body">${emptyState('No classes yet', 'Restore the demo data from Settings to load fictional classes and students.', '🏫')}</div>`;
    return { title: 'Face Enrollment', subtitle: 'No classes available', element: empty };
  }

  const queryClass = query?.get('class');
  const queryStudent = query?.get('student');
  if (queryClass && classes.some((c) => c.id === queryClass)) filters.classId = queryClass;
  if (!filters.classId || !classes.some((c) => c.id === filters.classId)) {
    filters.classId = getActiveClassId() || classes[0].id;
  }
  if (queryStudent) filters.scope = 'all';

  const cls = getClass(filters.classId);
  const students = getStudentsByClass(filters.classId);
  const enrolledInClass = students.filter(isEnrolled);
  const engine = getEngineStatus();

  const search = filters.search.trim().toLowerCase();
  const visible = students.filter((student) => {
    if (filters.scope === 'enrolled' && !isEnrolled(student)) return false;
    if (filters.scope === 'missing' && isEnrolled(student)) return false;
    if (search && !`${student.name} ${student.rollNo}`.toLowerCase().includes(search)) return false;
    return true;
  });

  const root = el('div', { class: 'stack' });

  /* -------------------------------- Header -------------------------------- */
  root.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h2', { text: 'Face Enrollment' }),
      el('p', { text: 'Attach a reference face to each student so face attendance can recognise them.' }),
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', {
        class: 'btn btn-outline', type: 'button', html: '☑ Take attendance manually',
        onclick: () => { window.location.hash = `#/attendance?class=${filters.classId}`; },
      }),
      el('button', {
        class: 'btn btn-primary', type: 'button', html: '◉ Open Face Attendance',
        onclick: () => { window.location.hash = `#/face?class=${filters.classId}`; },
      }),
    ]),
  ]));

  /* ------------------------------ Status strip ----------------------------- */
  const stats = el('section', { class: 'grid grid-4' });
  stats.innerHTML = [
    statBox('Enrolled', `${enrolledInClass.length}/${students.length}`, enrolledInClass.length ? 'ok' : 'warn'),
    statBox('Missing a face', String(students.length - enrolledInClass.length), students.length - enrolledInClass.length ? 'danger' : 'ok'),
    statBox('Engine', engine.api ? (engine.modelsLoaded ? 'Ready' : 'Not loaded') : 'Missing', engine.modelsLoaded ? 'ok' : 'warn'),
    statBox('Match threshold', String(getState().settings.matchThreshold ?? 0.5), 'brand'),
  ].join('');
  root.append(stats);

  /* -------------------------------- Toolbar ------------------------------- */
  const toolbar = el('section', { class: 'card' });
  const toolbarBody = el('div', { class: 'card-body' });
  toolbarBody.innerHTML = `
    <div class="toolbar">
      <div class="field grow" style="min-width:230px">
        <label for="enrSearch">Search students</label>
        <div class="search-wrap">
          <input id="enrSearch" type="search" placeholder="Name or roll number" value="${esc(filters.search)}" />
        </div>
      </div>
      <div class="field grow" style="min-width:200px">
        <label for="enrClass">Class / Section</label>
        <select id="enrClass">${classOptions(classes, filters.classId)}</select>
      </div>
      <div class="field">
        <label>Show</label>
        <div class="segmented" id="enrScope">
          <button type="button" data-scope="all" class="${filters.scope === 'all' ? 'is-active' : ''}">All</button>
          <button type="button" data-scope="enrolled" class="${filters.scope === 'enrolled' ? 'is-active' : ''}">Enrolled</button>
          <button type="button" data-scope="missing" class="${filters.scope === 'missing' ? 'is-active' : ''}">Missing</button>
        </div>
      </div>
    </div>`;
  toolbar.append(toolbarBody);
  root.append(toolbar);

  /* ------------------------------ Tile gallery ---------------------------- */
  const galleryCard = el('section', { class: 'card' });
  galleryCard.innerHTML = cardHead(
    'Reference Faces',
    `${visible.length} of ${students.length} students shown · stored locally in this browser only`,
    `<button class="btn btn-sm btn-primary" type="button" id="enrCaptureTeacher">◉ Capture my face as a demo reference</button>`,
  );

  if (!visible.length) {
    const empty = el('div');
    empty.innerHTML = emptyState('Nothing to show', 'No students match the current filters.', '🔍');
    galleryCard.append(empty);
  } else {
    const grid = el('div', { class: 'card-body grid grid-4' });
    for (const student of visible) {
      const enrolled = isEnrolled(student);
      const tile = el('article', { class: 'face-tile', dataset: { student: student.id } });
      tile.innerHTML = `
        <img src="${student.photo || avatarDataUri(student.name)}" alt="" />
        <div class="face-tile-meta">
          <strong>${esc(student.name)}</strong>
          <span>${esc(student.rollNo)}</span>
          <div class="row wrap" style="gap:6px;margin-top:8px">
            ${enrolled
              ? '<span class="badge badge-violet">Enrolled</span>'
              : '<span class="badge">Not enrolled</span>'}
            ${enrolled ? `<span class="badge">${student.descriptorSamples || 1} sample${(student.descriptorSamples || 1) === 1 ? '' : 's'}</span>` : ''}
          </div>
          <div class="row" style="gap:6px;margin-top:10px">
            <button class="btn btn-sm ${enrolled ? 'btn-outline' : 'btn-primary'} grow" type="button" data-enroll="${esc(student.id)}">
              ${enrolled ? 'Re-enroll' : 'Enroll face'}
            </button>
            ${enrolled ? `<button class="btn btn-sm btn-ghost" type="button" data-remove="${esc(student.id)}" title="Remove enrollment">✕</button>` : ''}
          </div>
        </div>`;
      grid.append(tile);
    }
    galleryCard.append(grid);
  }
  root.append(galleryCard);

  /* ------------------------------ Info / privacy -------------------------- */
  const notes = [];
  if (!cameraSupported()) {
    notes.push(callout(esc(cameraBlockedReason() || 'This browser cannot access a camera.'), 'danger', '⚠'));
  } else if (!engine.modelsLoaded) {
    notes.push(callout(
      engine.error
        ? esc(engine.error)
        : 'The recognition models are not loaded yet. They load automatically the first time you start the camera (or run <code>npm run setup</code> if <code>vendor/face-api</code> is missing).',
      engine.error ? 'danger' : 'info', '⏳',
    ));
  }
  notes.push(callout(
    'Enrollment captures live in <strong>this browser only</strong> (localStorage). Nothing is uploaded. Reference faces are demonstrative — there is no liveness detection, so a photo could fool it. A real deployment needs consent, access controls, retention limits and legal review.',
    'warn', '🔒',
  ));

  root.append(el('section', { class: 'card' }, [
    el('div', { class: 'card-body stack' }, notes.map((html) => {
      const node = el('div');
      node.innerHTML = html;
      return node;
    })),
  ]));

  /* -------------------------------- Events -------------------------------- */
  toolbarBody.querySelector('#enrSearch')?.addEventListener('input', debounce((event) => {
    filters.search = event.target.value;
    rerender();
  }, 220));

  toolbarBody.querySelector('#enrClass')?.addEventListener('change', (event) => {
    filters.classId = event.target.value;
    setActiveClass(filters.classId);
    rerender();
  });

  toolbarBody.querySelector('#enrScope')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-scope]');
    if (!button) return;
    filters.scope = button.dataset.scope;
    rerender();
  });

  galleryCard.querySelector('#enrCaptureTeacher')?.addEventListener('click', () => {
    openCaptureDialog(visible[0]?.id || students[0]?.id || null);
  });

  galleryCard.addEventListener('click', async (event) => {
    const enrollBtn = event.target.closest('[data-enroll]');
    if (enrollBtn) {
      openCaptureDialog(enrollBtn.dataset.enroll);
      return;
    }
    const removeBtn = event.target.closest('[data-remove]');
    if (removeBtn) {
      const student = getState().students.find((s) => s.id === removeBtn.dataset.remove);
      const yes = await confirmDialog({
        title: 'Remove face enrollment',
        message: `Remove ${student?.name}'s reference face? They will no longer be recognised by face attendance until you enroll them again.`,
        confirmLabel: 'Remove enrollment',
        tone: 'danger',
      });
      if (!yes) return;
      removeEnrollment(removeBtn.dataset.remove);
      toast('Enrollment removed', `${student?.name} can no longer be recognised.`, 'warn');
    }
  });

  return {
    title: 'Face Enrollment',
    subtitle: `${cls?.name || ''} · ${enrolledInClass.length}/${students.length} students enrolled`,
    element: root,
    destroy() {
      // A re-render while the capture dialog is open must not kill the camera.
      const backdrop = document.querySelector('#modalBackdrop');
      if (!backdrop || backdrop.hidden) stopActiveEnrollment();
    },
  };
}

/* ------------------------------- Sub-parts -------------------------------- */

function statBox(label, value, tone) {
  const colorVar = { brand: 'brand-700', ok: 'ok-700', warn: 'warn-700', danger: 'danger-700' }[tone] || 'ink-900';
  return `<article class="stat stat-${tone}">
    <div class="stat-top"><span class="stat-label">${esc(label)}</span></div>
    <div class="stat-value" style="color:var(--${colorVar})">${esc(String(value))}</div>
  </article>`;
}

function rerender() {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function stopActiveEnrollment() {
  if (modalObserver) {
    modalObserver.disconnect();
    modalObserver = null;
  }
  if (activeEnrollment) {
    activeEnrollment.stop();
    activeEnrollment = null;
  }
}

/**
 * The global modal is closed by app.js (✕ button, backdrop click, Escape), so we
 * watch the backdrop for `hidden` to make sure the camera is always released.
 */
function guardModalClose(stop) {
  if (modalObserver) modalObserver.disconnect();
  const backdrop = document.querySelector('#modalBackdrop');
  if (!backdrop) return;
  modalObserver = new MutationObserver(() => {
    if (backdrop.hidden) {
      stop();
      modalObserver?.disconnect();
      modalObserver = null;
      activeEnrollment = null;
    }
  });
  modalObserver.observe(backdrop, { attributes: true, attributeFilter: ['hidden'] });
}

/* --------------------------- Capture dialog -------------------------------- */

function openCaptureDialog(studentId) {
  const students = getStudentsByClass(filters.classId);
  if (!students.length) {
    toast('No students', 'Add a student to this class before enrolling a face.', 'warn');
    return;
  }
  stopActiveEnrollment();

  const selectedId = students.some((s) => s.id === studentId) ? studentId : students[0].id;
  const engine = getEngineStatus();
  const camOk = cameraSupported();

  const session = {
    stream: null,
    descriptors: [],
    thumbnails: [],
    running: false,
    busy: false,
    simulated: false,
    stopped: false,
  };

  const body = el('div', { class: 'stack' });
  body.innerHTML = `
    <div class="field">
      <label for="enrTarget">Student to enroll</label>
      <select id="enrTarget">
        ${students.map((s) => `<option value="${esc(s.id)}" ${s.id === selectedId ? 'selected' : ''}>
          ${esc(s.rollNo)} · ${esc(s.name)}${isEnrolled(s) ? ' (already enrolled)' : ''}
        </option>`).join('')}
      </select>
    </div>
    <div id="enrAlerts"></div>
    <div class="cam-stage" id="enrStage">
      <video id="enrVideo" playsinline muted></video>
      <div class="cam-placeholder" id="enrPlaceholder">
        <div class="big">◉</div>
        <p class="strong mt-8">Camera is off</p>
        <p class="small">Start the camera, look straight at the lens and capture 3 samples.</p>
      </div>
      <div class="cam-status" id="enrStatus" hidden><span class="live-dot"></span><span id="enrStatusText">Live</span></div>
    </div>
    <div class="row wrap">
      <button class="btn btn-primary" type="button" id="enrStart">▶ Start camera</button>
      <button class="btn btn-outline" type="button" id="enrCapture" disabled>📸 Capture sample</button>
      <button class="btn btn-ghost" type="button" id="enrStop" disabled>■ Stop</button>
    </div>
    <div id="enrProgress" class="mt-8"></div>
    <div id="enrThumbs" class="row wrap mt-8"></div>
    <div class="mt-16" id="enrFallback"></div>
    <div class="row" style="justify-content:flex-end;gap:10px">
      <button class="btn btn-ghost" type="button" id="enrCancel">Cancel</button>
      <button class="btn btn-success" type="button" id="enrSave" disabled>✓ Save reference face</button>
    </div>`;

  const dom = {
    video: body.querySelector('#enrVideo'),
    placeholder: body.querySelector('#enrPlaceholder'),
    status: body.querySelector('#enrStatus'),
    statusText: body.querySelector('#enrStatusText'),
    alerts: body.querySelector('#enrAlerts'),
    start: body.querySelector('#enrStart'),
    capture: body.querySelector('#enrCapture'),
    stop: body.querySelector('#enrStop'),
    progress: body.querySelector('#enrProgress'),
    thumbs: body.querySelector('#enrThumbs'),
    fallback: body.querySelector('#enrFallback'),
    save: body.querySelector('#enrSave'),
    target: body.querySelector('#enrTarget'),
    cancel: body.querySelector('#enrCancel'),
  };

  const SAMPLES_WANTED = 3;

  /* ------------------------------- rendering ------------------------------ */

  function renderAlerts() {
    const messages = [];
    if (!camOk) {
      messages.push(callout(esc(cameraBlockedReason() || 'This browser cannot access a camera.'), 'danger', '⚠'));
    } else if (!engine.modelsLoaded) {
      messages.push(callout(
        engine.error
          ? esc(engine.error)
          : 'The recognition models are not loaded yet. They load automatically when you start the camera.',
        engine.error ? 'danger' : 'info', '⏳',
      ));
    }
    dom.alerts.innerHTML = messages.join('');
  }

  function renderFallback() {
    dom.fallback.innerHTML = `${callout(
      '<strong>No working camera?</strong> You can attach a clearly-labelled <em>simulated</em> reference so the face attendance workflow can still be demonstrated on any machine. Simulated references are not real biometrics and are stored with the method “Simulated”.',
      'warn', '🧪',
    )}
    <button class="btn btn-outline btn-block mt-8" type="button" id="enrSimulate">
      🧪 Use a simulated reference (demo only)
    </button>`;
    dom.fallback.querySelector('#enrSimulate')?.addEventListener('click', () => {
      session.simulated = !session.simulated;
      renderProgress();
      toast(
        session.simulated ? 'Simulated reference selected' : 'Simulated reference cleared',
        session.simulated ? 'This is a demo placeholder, not real recognition.' : '',
        session.simulated ? 'warn' : 'info',
        2600,
      );
    });
  }

  function renderProgress() {
    const captured = session.descriptors.length;
    const usable = captured > 0 || session.simulated;
    dom.save.disabled = !usable;

    const badges = [
      session.simulated ? '<span class="badge badge-warn">Simulated reference selected</span>' : '',
      captured ? `<span class="badge badge-ok">${captured} real sample${captured === 1 ? '' : 's'} captured</span>` : '',
      captured === 0 && !session.simulated ? '<span class="badge">No samples yet</span>' : '',
      captured >= SAMPLES_WANTED ? '<span class="badge badge-brand">Enough samples — ready to save</span>' : '',
    ].filter(Boolean).join(' ');

    dom.progress.innerHTML = `
      <div class="row-between">
        <span class="small strong">Samples captured ${captured} / ${SAMPLES_WANTED}</span>
        <span class="row wrap" style="gap:6px">${badges}</span>
      </div>
      <div class="mt-8">${barHtml(clamp((captured / SAMPLES_WANTED) * 100, 0, 100), captured >= SAMPLES_WANTED ? 'ok' : 'brand')}</div>
      <p class="small muted mt-8">Samples are averaged into one reference descriptor. More samples = a more stable match.</p>`;

    dom.thumbs.innerHTML = session.thumbnails
      .map((src, index) => `<img src="${src}" alt="Sample ${index + 1}" style="width:56px;height:56px;border-radius:12px;object-fit:cover;border:1px solid var(--ink-200)" />`)
      .join('');
  }

  function barHtml(percent, tone) {
    return `<div class="bar ${tone === 'ok' ? '' : `is-${tone}`}"><span style="width:${percent}%"></span></div>`;
  }

  /* -------------------------------- camera -------------------------------- */

  async function start() {
    if (!camOk) {
      toast('Camera unavailable', cameraBlockedReason() || 'Use the simulated reference instead.', 'warn', 5000);
      return;
    }
    dom.start.disabled = true;
    dom.start.textContent = '▶ Starting…';
    try {
      await loadModels(() => {});
      session.stream = await startCamera(dom.video, { width: 640, height: 480 });
      session.running = true;
      dom.placeholder.hidden = true;
      dom.status.hidden = false;
      dom.statusText.textContent = 'Live · capturing';
      dom.capture.disabled = false;
      dom.stop.disabled = false;
      dom.start.hidden = true;
    } catch (error) {
      dom.start.disabled = false;
      dom.start.textContent = '▶ Start camera';
      const message = error?.message && /models|library/i.test(error.message)
        ? error.message
        : describeCameraError(error);
      toast('Camera could not start', message, 'danger', 6000);
    }
  }

  function stop() {
    if (session.stopped) return;
    session.stopped = true;
    if (session.stream) stopCamera(session.stream);
    session.stream = null;
    session.running = false;
    try {
      if (dom.video) dom.video.srcObject = null;
    } catch { /* element already gone */ }
  }

  async function capture() {
    if (session.busy) return;
    if (!session.running) {
      toast('Camera is off', 'Start the camera before capturing a sample.', 'warn');
      return;
    }
    session.busy = true;
    dom.capture.disabled = true;
    try {
      const descriptor = await captureDescriptor(dom.video);
      if (!descriptor) {
        toast('No face found', 'Make sure exactly one face is visible and well lit, then try again.', 'warn', 4200);
        return;
      }
      session.descriptors.push(Array.from(descriptor));
      try {
        session.thumbnails.push(await toThumbnail(dom.video, 200));
      } catch { /* thumbnails are a nicety only */ }
      renderProgress();
      if (session.descriptors.length >= SAMPLES_WANTED) {
        toast('Samples complete', 'You can save the reference face now (or capture a few more).', 'ok', 2600);
      }
    } finally {
      session.busy = false;
      dom.capture.disabled = !session.running;
    }
  }

  /* --------------------------------- events ------------------------------- */

  dom.start.addEventListener('click', start);
  dom.capture.addEventListener('click', capture);
  dom.stop.addEventListener('click', () => {
    stop();
    dom.status.hidden = true;
    dom.placeholder.hidden = false;
    dom.start.hidden = false;
    dom.start.disabled = false;
    dom.start.textContent = '▶ Start camera';
    dom.capture.disabled = true;
    dom.stop.disabled = true;
  });

  dom.target.addEventListener('change', () => {
    // A reference face belongs to one student - start clean when the target changes.
    session.descriptors = [];
    session.thumbnails = [];
    session.simulated = false;
    renderProgress();
  });

  dom.cancel.addEventListener('click', () => {
    stopActiveEnrollment();
    closeModal();
  });

  dom.save.addEventListener('click', () => {
    const studentId = dom.target.value;
    const student = getState().students.find((s) => s.id === studentId);
    const realSamples = session.descriptors.length;

    let descriptor = null;
    let photo = null;
    let samples = 0;
    let simulated = false;

    if (realSamples > 0) {
      descriptor = averageDescriptors(session.descriptors);
      photo = session.thumbnails[0] || student?.photo || null;
      samples = realSamples;
    } else if (session.simulated) {
      descriptor = Array.from(simulatedDescriptor(`${studentId}:demo`));
      photo = student?.photo || null;
      samples = 1;
      simulated = true;
    }

    if (!descriptor) {
      toast('Nothing to save', 'Capture at least one sample first.', 'warn');
      return;
    }

    stopActiveEnrollment();
    closeModal();
    const result = enrollFace(studentId, descriptor, photo, samples);
    if (!result.ok) {
      toast('Enrollment failed', result.reason || 'Unknown error', 'danger');
      return;
    }
    toast(
      'Reference face saved',
      simulated
        ? `${student?.name} now has a SIMULATED reference (demo only).`
        : `${student?.name} enrolled from ${samples} averaged sample${samples === 1 ? '' : 's'}.`,
      simulated ? 'warn' : 'ok',
      simulated ? 5000 : 3200,
    );
  });

  /* --------------------------------- mount -------------------------------- */

  activeEnrollment = { stop };
  guardModalClose(stop);
  renderAlerts();
  renderFallback();
  renderProgress();
  openModal('Enroll a reference face', body);
}