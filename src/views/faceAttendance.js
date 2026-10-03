/**
 * FACE ATTENDANCE
 *
 * Two clearly separated modes:
 *
 *  1. LIVE CAMERA (default) - real face detection + real descriptor matching
 *     against students that were enrolled on the Face Enrollment page.
 *  2. SIMULATED DEMO - a deterministic stand-in used only when a camera or the
 *     model files are unavailable. It is labelled as a simulation everywhere and
 *     is never presented as real recognition.
 *
 * Safety rules enforced here:
 *   - an unknown / unmatched face NEVER becomes present automatically
 *   - the teacher must confirm before anything is recorded (unless they
 *     explicitly turn on auto-confirm)
 *   - manual attendance stays one click away at all times
 *
 * This view opts out of automatic re-rendering (refreshOnChange = false) so the
 * camera stream is not torn down when attendance is recorded.
 */

import {
  getClasses,
  getClass,
  getStudentsByClass,
  getSessionsByClass,
  getSession,
  getAttendanceForSession,
  getEnrolledStudents,
  getState,
  getActiveClassId,
  setActiveClass,
  ensureSession,
  markAttendance,
} from '../lib/store.js';
import {
  el, esc, todayISO, formatDate, toast, round1, clamp,
  statusBadge,
} from '../lib/utils.js';
import { cardHead, emptyState, callout, classOptions, sessionOptions } from '../lib/ui.js';
import {
  loadModels, getEngineStatus, startCamera, stopCamera, describeCameraError,
  cameraSupported, cameraBlockedReason, detectFaces, findBestMatch, simulatedDescriptor,
} from '../lib/faceEngine.js';

export function render({ query }) {
  const classes = getClasses();
  const state = getState();
  const threshold = state.settings.matchThreshold ?? 0.5;

  /* --------------------------- Local view state --------------------------- */
  const view = {
    classId: query?.get('class') || getActiveClassId() || classes[0]?.id || null,
    sessionId: query?.get('session') || null,
    mode: 'live',            // 'live' | 'sim'
    running: false,
    stream: null,
    timer: null,
    candidate: null,         // { studentId, distance, confidence, faces, at }
    candidateHits: 0,
    lastSeen: 0,
    autoConfirm: false,
    processing: false,
    lastResult: null,
    destroyed: false,
  };

  if (view.classId && !classes.some((c) => c.id === view.classId)) view.classId = classes[0]?.id || null;
  const initialSessions = view.classId ? getSessionsByClass(view.classId) : [];
  if (!view.sessionId || !getSession(view.sessionId)) {
    // Prefer today's session, else the newest one.
    const todaySession = initialSessions.find((s) => s.date === todayISO());
    view.sessionId = todaySession?.id || initialSessions[0]?.id || null;
  } else {
    view.classId = getSession(view.sessionId).classId;
  }

  const root = el('div', { class: 'stack' });

  /* --------------------------------- Header ------------------------------- */
  root.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h2', { text: 'Face Attendance' }),
      el('p', { text: 'Recognise enrolled students from the camera, then confirm before recording.' }),
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', {
        class: 'btn btn-outline', type: 'button', html: '☑ Manual attendance',
        onclick: () => { window.location.hash = `#/attendance?class=${view.classId}${view.sessionId ? `&session=${view.sessionId}` : ''}`; },
      }),
      el('button', {
        class: 'btn btn-outline', type: 'button', html: '✚ Enroll a face',
        onclick: () => { window.location.hash = '#/enrollment'; },
      }),
    ]),
  ]));

  /* ------------------------------- Controls ------------------------------- */
  const controls = el('section', { class: 'card' });
  const controlsBody = el('div', { class: 'card-body' });
  controlsBody.innerHTML = `
    <div class="toolbar">
      <div class="field grow" style="min-width:210px">
        <label for="faceClass">Class / Section</label>
        <select id="faceClass">${classOptions(classes, view.classId)}</select>
      </div>
      <div class="field grow" style="min-width:230px">
        <label for="faceSession">Attendance session</label>
        <select id="faceSession">${sessionOptions(getSessionsByClass(view.classId), view.sessionId, { includeEmpty: true })}</select>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn btn-outline" type="button" id="faceCreateSession">＋ Create today's session</button>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <div class="segmented" id="modeSwitch">
          <button type="button" data-mode="live" class="is-active">Live camera</button>
          <button type="button" data-mode="sim">Simulated demo</button>
        </div>
      </div>
    </div>`;
  controls.append(controlsBody);
  root.append(controls);

  /* ------------------------------ Status area ----------------------------- */
  const statusArea = el('div', { id: 'faceStatusArea' });
  root.append(statusArea);

  /* ------------------------------- Main grid ------------------------------ */
  const grid = el('section', { class: 'grid grid-main-side' });

  const cameraCard = el('section', { class: 'card' });
  cameraCard.innerHTML = cardHead('Camera', 'Live recognition runs entirely inside your browser');
  const cameraBody = el('div', { class: 'card-body' });
  cameraBody.innerHTML = `
    <div class="cam-stage" id="camStage">
      <video id="camVideo" playsinline muted></video>
      <canvas id="camCanvas"></canvas>
      <div class="cam-placeholder" id="camPlaceholder">
        <div class="big">◉</div>
        <p class="strong mt-8">Camera is off</p>
        <p class="small">Click “Start camera” to begin a face attendance session.</p>
      </div>
      <div class="cam-status" id="camStatus" hidden><span class="live-dot"></span><span id="camStatusText">Live</span></div>
      <div class="cam-hint" id="camHint" hidden></div>
    </div>
    <div class="row wrap mt-16">
      <button class="btn btn-primary" type="button" id="startBtn">▶ Start camera</button>
      <button class="btn btn-ghost" type="button" id="stopBtn" disabled>■ Stop</button>
      <label class="row small" style="gap:6px;margin-left:auto">
        <input type="checkbox" id="autoConfirm" style="width:auto" />
        Auto-confirm matches (skip manual confirmation)
      </label>
    </div>
    <div id="engineInfo" class="mt-16"></div>`;
  cameraCard.append(cameraBody);

  const resultCard = el('section', { class: 'card' });
  resultCard.innerHTML = cardHead('Recognition Result', 'Nothing is recorded until you confirm');
  const resultBody = el('div', { class: 'card-body' });
  resultCard.append(resultBody);

  grid.append(cameraCard, resultCard);
  root.append(grid);

  /* ------------------------------- Roster --------------------------------- */
  const rosterCard = el('section', { class: 'card' });
  rosterCard.innerHTML = cardHead('Session Roster', 'Students already marked in this session');
  const rosterBody = el('div', { class: 'card-body flush' });
  rosterCard.append(rosterBody);
  root.append(rosterCard);

  /* ------------------------------ DOM handles ----------------------------- */
  const dom = {
    video: cameraBody.querySelector('#camVideo'),
    canvas: cameraBody.querySelector('#camCanvas'),
    placeholder: cameraBody.querySelector('#camPlaceholder'),
    camStatus: cameraBody.querySelector('#camStatus'),
    camStatusText: cameraBody.querySelector('#camStatusText'),
    camHint: cameraBody.querySelector('#camHint'),
    startBtn: cameraBody.querySelector('#startBtn'),
    stopBtn: cameraBody.querySelector('#stopBtn'),
    autoConfirm: cameraBody.querySelector('#autoConfirm'),
    engineInfo: cameraBody.querySelector('#engineInfo'),
    statusArea,
    resultBody,
    rosterBody,
    faceClass: controlsBody.querySelector('#faceClass'),
    faceSession: controlsBody.querySelector('#faceSession'),
    modeSwitch: controlsBody.querySelector('#modeSwitch'),
  };

  /* ================================ HELPERS =============================== */

  const enrolled = () => getEnrolledStudents(view.classId);

  function renderEngineInfo() {
    const status = getEngineStatus();
    const cls = getClass(view.classId);
    const enrolledCount = enrolled().length;
    const messages = [];

    if (view.mode === 'sim') {
      messages.push(callout(
        '<strong>Simulated demo mode is ON.</strong> No camera image is analysed. Names are chosen deterministically from the class roster so the workflow can be demonstrated on any machine. This is <strong>not</strong> face recognition — switch back to “Live camera” for the real feature.',
        'warn', '⚠',
      ));
    } else if (!cameraSupported()) {
      messages.push(callout(esc(cameraBlockedReason() || 'Camera unavailable.'), 'danger', '⚠'));
    }

    if (view.mode === 'live' && !status.modelsLoaded) {
      messages.push(callout(
        status.error
          ? esc(status.error)
          : (status.loading ? 'Loading the face recognition models…' : 'The face recognition models are not loaded yet. They load automatically when you start the camera.'),
        status.error ? 'danger' : 'info', '⏳',
      ));
    }

    if (view.mode === 'live' && status.modelsLoaded && enrolledCount === 0) {
      messages.push(callout(
        `No student in <strong>${esc(cls?.name || 'this class')}</strong> has a reference face yet, so nothing can be recognised. Enrol at least one face on the <strong>Face Enrollment</strong> page (you may capture your own face as a demo reference), or use <strong>Simulated demo</strong> mode.`,
        'warn', '👤',
      ));
    }

    if (view.mode === 'live' && status.modelsLoaded && enrolledCount > 0) {
      messages.push(callout(
        `${enrolledCount} student${enrolledCount === 1 ? '' : 's'} enrolled for recognition in this class. Match threshold: <strong>${threshold}</strong> (lower = stricter). ${status.backend ? `Compute backend: ${esc(status.backend)}.` : ''}`,
        'ok', '✓',
      ));
    }

    if (!view.sessionId) {
      messages.push(callout('Select or create an attendance session above — attendance is always recorded against a session.', 'warn', '📅'));
    }

    dom.engineInfo.innerHTML = messages.join('');
  }

  function renderResult() {
    const candidate = view.candidate;
    const session = view.sessionId ? getSession(view.sessionId) : null;
    const faceCount = view.lastResult?.faces ?? 0;

    if (view.mode === 'sim') {
      dom.resultBody.innerHTML = `
        <div class="match-card is-warn">
          <div class="row" style="gap:12px">
            <span class="stat-ico" style="background:var(--warn-50);color:var(--warn-700)">⚠</span>
            <div>
              <h3 style="font-size:15px">Simulation active</h3>
              <p class="small muted">Click “Simulate a detection” below. Results are clearly marked as simulated.</p>
            </div>
          </div>
        </div>
        <button class="btn btn-primary btn-block mt-16" type="button" id="simulateBtn">⚡ Simulate a detection</button>
        <div id="simResult" class="mt-16"></div>`;
      wireSimulate();
      return;
    }

    if (!candidate) {
      dom.resultBody.innerHTML = `
        <div class="match-card is-none">
          <div class="row" style="gap:12px">
            <span class="stat-ico">👤</span>
            <div>
              <h3 style="font-size:15px">${view.running ? 'Looking for a face…' : 'Camera is off'}</h3>
              <p class="small muted">${view.running
                ? (faceCount ? 'A face is visible but not yet confidently matched to an enrolled student.' : 'Position one face in the frame, in good lighting.')
                : 'Start the camera to begin recognising enrolled students.'}</p>
            </div>
          </div>
        </div>
        <p class="small muted mt-16">Unknown faces are never marked present automatically. Use manual attendance if recognition does not work.</p>`;
      return;
    }

    const student = getState().students.find((s) => s.id === candidate.studentId);
    if (!student) {
      view.candidate = null;
      renderResult();
      return;
    }
    const already = session ? getAttendanceForSession(session.id).find((a) => a.studentId === student.id) : null;
    const cls = getClass(student.classId);

    dom.resultBody.innerHTML = `
      <div class="match-card">
        <div class="match-top">
          <img class="match-photo" src="${student.photo}" alt="" />
          <div class="match-meta grow">
            <h3>${esc(student.name)}</h3>
            <p>${esc(student.rollNo)} · ${esc(cls?.name || '')}</p>
            <div class="row" style="gap:6px;margin-top:6px">
              <span class="badge badge-violet">Recognised</span>
              ${already ? `<span class="badge ${already.status === 'present' ? 'badge-ok' : 'badge-warn'}">Already ${esc(already.status)}</span>` : '<span class="badge">Not yet marked</span>'}
            </div>
          </div>
        </div>
        <div class="confidence">
          <span class="small strong nowrap">Match confidence</span>
          <div class="bar grow"><span style="width:${clamp(candidate.confidence, 0, 100)}%"></span></div>
          <strong class="nowrap">${round1(candidate.confidence)}%</strong>
        </div>
        <p class="small muted mt-8">Distance ${candidate.distance.toFixed(3)} (match threshold ${threshold}) · ${candidate.hits} consecutive frames · confidence is an estimate derived from descriptor distance, not a security guarantee.</p>
      </div>
      <div class="row wrap mt-16">
        <button class="btn btn-success grow" type="button" id="confirmBtn" ${!session ? 'disabled' : ''}>✓ Confirm &amp; mark PRESENT</button>
        <button class="btn btn-ghost" type="button" id="rejectBtn">Reject</button>
      </div>
      ${!session ? '<p class="small muted mt-8">Create or select a session first.</p>' : ''}`;

    dom.resultBody.querySelector('#confirmBtn')?.addEventListener('click', () => confirmCandidate('present'));
    dom.resultBody.querySelector('#rejectBtn')?.addEventListener('click', () => {
      view.candidate = null;
      view.candidateHits = 0;
      view.lastSeen = 0;
      renderResult();
      toast('Match rejected', 'Nothing was recorded.', 'warn', 2200);
    });
  }

  function renderRoster() {
    const session = view.sessionId ? getSession(view.sessionId) : null;
    if (!session) {
      dom.rosterBody.innerHTML = emptyState('No session selected', 'Create or pick a session to see who has been marked.', '📋');
      return;
    }
    const students = getStudentsByClass(view.classId);
    const records = new Map(getAttendanceForSession(session.id).map((r) => [r.studentId, r]));
    const present = students.filter((s) => ['present', 'late'].includes(records.get(s.id)?.status));
    const absent = students.filter((s) => records.get(s.id)?.status === 'absent');
    const unmarked = students.filter((s) => !records.has(s.id));

    const rowHtml = (student, record) => `
      <div class="att-row">
        <div class="who">
          <strong>${esc(student.name)}</strong>
          <div class="small muted">${esc(student.rollNo)}</div>
        </div>
        ${record ? statusBadge(record.status) : '<span class="badge">Not marked</span>'}
        ${record?.method === 'face' ? '<span class="badge badge-violet">Face</span>'
          : record?.method === 'face-sim' ? '<span class="badge badge-warn">Sim</span>'
            : record ? '<span class="badge">Manual</span>' : ''}
      </div>`;

    dom.rosterBody.innerHTML = `
      <div class="row" style="padding:12px 18px;gap:14px;border-bottom:1px solid var(--ink-100)">
        <span class="badge badge-ok">${present.length} present</span>
        <span class="badge badge-danger">${absent.length} absent</span>
        <span class="badge">${unmarked.length} not marked</span>
        <span class="small muted" style="margin-left:auto">${formatDate(session.date)}</span>
      </div>
      <div style="max-height:380px;overflow-y:auto">
        ${[...present, ...absent, ...unmarked].map((s) => rowHtml(s, records.get(s.id))).join('')}
      </div>`;
  }

  function confirmCandidate(status) {
    if (!view.candidate || !view.sessionId) return;
    const student = getState().students.find((s) => s.id === view.candidate.studentId);
    const result = markAttendance({
      sessionId: view.sessionId,
      studentId: view.candidate.studentId,
      status,
      method: view.mode === 'sim' ? 'face-sim' : 'face',
      confidence: round1(view.candidate.confidence),
    });
    if (result.ok) {
      toast(
        result.updated ? 'Attendance updated' : 'Attendance recorded',
        `${student?.name} marked ${status}${view.mode === 'sim' ? ' (simulated demo)' : ' via face recognition'}.`,
        'ok',
      );
      if (status === 'absent') toast('Guardian notified', `${student?.name} absent.`, 'warn', 2600);
    }
    view.candidate = null;
    view.candidateHits = 0;
    view.lastSeen = 0;
    renderResult();
    renderRoster();
  }

  /* ------------------------------ Detection loop --------------------------- */

  function drawOverlay(detections, videoWidth, videoHeight) {
    const canvas = dom.canvas;
    if (!canvas || !videoWidth) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scaleX = canvas.width / videoWidth;
    const scaleY = canvas.height / videoHeight;

    for (const detection of detections) {
      const { x, y, width, height } = detection.box;
      const isMatch = Boolean(detection.match);
      ctx.strokeStyle = isMatch ? '#6b95f7' : '#16a34a';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY);

      const label = detection.label || 'Unknown face';
      ctx.font = '600 13px Inter, Segoe UI, sans-serif';
      const textWidth = ctx.measureText(label).width + 14;
      const labelY = Math.max(16, y * scaleY - 8);
      ctx.fillStyle = isMatch ? '#2f6bed' : '#16a34a';
      ctx.fillRect(x * scaleX, labelY - 16, textWidth, 20);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x * scaleX + 7, labelY - 2);
    }
  }

  async function detectionTick() {
    if (!view.running || view.destroyed || view.mode !== 'live') return;
    if (view.processing) {
      view.timer = setTimeout(detectionTick, 250);
      return;
    }
    view.processing = true;
    try {
      const faces = await detectFaces(dom.video);
      const pool = enrolled();
      const annotated = faces.map((face) => {
        const best = findBestMatch(face.descriptor, pool, threshold);
        return {
          box: face.box,
          match: best.isMatch ? best.match : null,
          distance: best.distance,
          confidence: best.confidence,
          label: best.isMatch ? `${best.match.name} · ${round1(best.confidence)}%` : 'Unknown face',
        };
      });
      view.lastResult = { faces: faces.length, at: Date.now() };
      drawOverlay(annotated, dom.video.videoWidth, dom.video.videoHeight);

      dom.camHint.hidden = false;
      dom.camHint.textContent = faces.length
        ? `${faces.length} face${faces.length === 1 ? '' : 's'} detected · ${pool.length} enrolled`
        : `Scanning… ${pool.length} enrolled`;

      const matched = annotated.find((a) => a.match);
      if (matched) {
        const sameStudent = view.candidate && view.candidate.studentId === matched.match.id;
        view.candidateHits = sameStudent ? view.candidateHits + 1 : 1;
        view.candidate = {
          studentId: matched.match.id,
          distance: matched.distance,
          confidence: matched.confidence,
          hits: view.candidateHits,
        };
        view.lastSeen = Date.now();

        // Require a stable match across frames, then optionally auto-confirm.
        if (view.candidateHits === 2) renderResult();
        if (view.autoConfirm && view.candidateHits === 3) {
          const already = view.sessionId
            ? getAttendanceForSession(view.sessionId).find((a) => a.studentId === matched.match.id)
            : null;
          if (!already || already.status === 'absent') confirmCandidate('present');
        } else if (view.candidateHits === 2 || view.candidateHits % 6 === 0) {
          renderResult();
        }
      } else if (view.candidate && Date.now() - view.lastSeen > 1400) {
        view.candidate = null;
        view.candidateHits = 0;
        renderResult();
      } else if (!view.candidate && !faces.length) {
        // Keep the "looking for a face" card up to date.
        renderResult();
      }
    } catch (error) {
      console.warn('[faceAttendance] tick failed:', error);
    } finally {
      view.processing = false;
      if (view.running && !view.destroyed) view.timer = setTimeout(detectionTick, 320);
    }
  }

  /* ---------------------------- Simulation mode ---------------------------- */

  function wireSimulate() {
    const button = dom.resultBody.querySelector('#simulateBtn');
    button?.addEventListener('click', () => {
      const students = getStudentsByClass(view.classId);
      if (!students.length) {
        toast('No students', 'This class has no students.', 'warn');
        return;
      }
      if (!view.sessionId) {
        toast('No session', 'Create or select a session first.', 'warn');
        return;
      }
      // Deterministic pick so repeated demos behave the same way.
      const seed = `${view.classId}:${view.sessionId}:${Date.now() % 1000 > 500 ? 'a' : 'b'}`;
      const descriptor = simulatedDescriptor(seed);
      const pseudoPool = students.map((s, index) => ({
        ...s,
        descriptor: Array.from(simulatedDescriptor(`${s.id}:${index}`)),
      }));
      const best = findBestMatch(descriptor, pseudoPool, 1.2);
      const chosen = best.match || students[Math.floor(Math.random() * students.length)];
      const confidence = clamp(72 + (chosen.name.length % 18) + Math.random() * 8, 60, 99);

      view.candidate = {
        studentId: chosen.id,
        distance: Number((1 - confidence / 100).toFixed(3)),
        confidence,
        hits: 3,
      };
      renderSimResult(chosen, confidence);
    });
  }

  function renderSimResult(student, confidence) {
    const session = getSession(view.sessionId);
    const already = session ? getAttendanceForSession(session.id).find((a) => a.studentId === student.id) : null;
    const cls = getClass(student.classId);
    const holder = dom.resultBody.querySelector('#simResult');
    holder.innerHTML = `
      <div class="match-card is-warn">
        <div class="match-top">
          <img class="match-photo" src="${student.photo}" alt="" />
          <div class="match-meta grow">
            <h3>${esc(student.name)}</h3>
            <p>${esc(student.rollNo)} · ${esc(cls?.name || '')}</p>
            <div class="row" style="gap:6px;margin-top:6px">
              <span class="badge badge-warn">Simulated match</span>
              ${already ? `<span class="badge">Already ${esc(already.status)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="confidence">
          <span class="small strong nowrap">Simulated confidence</span>
          <div class="bar is-warn grow"><span style="width:${round1(confidence)}%"></span></div>
          <strong class="nowrap">${round1(confidence)}%</strong>
        </div>
        <p class="small muted mt-8">No camera image was analysed. This exists so the attendance workflow can be shown even without a working camera, and is stored with the method “Simulated”.</p>
      </div>
      <div class="row wrap mt-16">
        <button class="btn btn-success grow" type="button" id="simConfirm">✓ Confirm &amp; mark PRESENT</button>
        <button class="btn btn-ghost" type="button" id="simReject">Reject</button>
      </div>`;

    holder.querySelector('#simConfirm')?.addEventListener('click', () => confirmCandidate('present'));
    holder.querySelector('#simReject')?.addEventListener('click', () => {
      view.candidate = null;
      holder.innerHTML = '';
    });
  }

  /* ------------------------------ Camera control --------------------------- */

  async function start() {
    if (!view.sessionId) {
      toast('No session selected', 'Create or select an attendance session first.', 'warn');
      return;
    }
    if (view.mode === 'sim') {
      view.running = true;
      dom.startBtn.disabled = true;
      dom.stopBtn.disabled = false;
      dom.camPlaceholder.hidden = false;
      dom.camPlaceholder.innerHTML = '<div class="big">⚡</div><p class="strong mt-8">Simulated mode</p><p class="small">No camera is used. Use the panel on the right.</p>';
      dom.camStatus.hidden = true;
      renderResult();
      return;
    }

    dom.startBtn.disabled = true;
    dom.startBtn.textContent = 'Starting…';
    try {
      await loadModels((info) => {
        dom.engineInfo.innerHTML = callout(esc(info.message), 'info', '⏳');
      });
      view.stream = await startCamera(dom.video);
      view.running = true;
      view.destroyed = false;
      dom.placeholder.hidden = true;
      dom.camStatus.hidden = false;
      dom.camStatusText.textContent = 'Live recognition';
      dom.camHint.hidden = false;
      dom.stopBtn.disabled = false;
      dom.startBtn.textContent = '▶ Start camera';
      dom.startBtn.disabled = true;
      renderEngineInfo();
      renderResult();
      detectionTick();
      toast('Camera started', 'Look at the camera and hold still for a moment.', 'ok');
    } catch (error) {
      const message = error?.name ? describeCameraError(error) : (error?.message || String(error));
      stop();
      dom.startBtn.disabled = false;
      dom.startBtn.textContent = '▶ Start camera';
      statusArea.innerHTML = callout(
        `${esc(message)}<div class="mt-8"><button class="btn btn-sm btn-outline" type="button" id="manualFromError">Go to manual attendance</button></div>`,
        'danger', '⚠',
      );
      statusArea.querySelector('#manualFromError')?.addEventListener('click', () => {
        window.location.hash = `#/attendance?class=${view.classId}${view.sessionId ? `&session=${view.sessionId}` : ''}`;
      });
      renderEngineInfo();
      toast('Camera problem', 'Manual attendance is still fully available.', 'danger', 6000);
    }
  }

  function stop() {
    view.running = false;
    clearTimeout(view.timer);
    view.timer = null;
    stopCamera(view.stream);
    view.stream = null;
    if (dom.video) dom.video.srcObject = null;
    dom.placeholder.hidden = false;
    dom.placeholder.innerHTML = '<div class="big">◉</div><p class="strong mt-8">Camera is off</p><p class="small">Click “Start camera” to begin a face attendance session.</p>';
    dom.camStatus.hidden = true;
    dom.camHint.hidden = true;
    dom.startBtn.disabled = false;
    dom.startBtn.textContent = '▶ Start camera';
    dom.stopBtn.disabled = true;
    const canvas = dom.canvas;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    view.candidate = null;
    view.candidateHits = 0;
    view.lastResult = null;
    renderResult();
  }

  /* --------------------------------- Events -------------------------------- */

  dom.startBtn.addEventListener('click', start);
  dom.stopBtn.addEventListener('click', () => {
    stop();
    toast('Camera stopped', '', 'info', 1800);
  });
  dom.autoConfirm.addEventListener('change', (event) => {
    view.autoConfirm = event.target.checked;
    if (view.autoConfirm) {
      toast('Auto-confirm on', 'Matches will be recorded automatically. Use with care during the demo.', 'warn', 4000);
    }
  });

  dom.faceClass.addEventListener('change', (event) => {
    stop();
    view.classId = event.target.value;
    setActiveClass(view.classId);
    const sessions = getSessionsByClass(view.classId);
    view.sessionId = (sessions.find((s) => s.date === todayISO()) || sessions[0])?.id || null;
    dom.faceSession.innerHTML = sessionOptions(sessions, view.sessionId, { includeEmpty: true });
    renderEngineInfo();
    renderRoster();
    renderResult();
  });

  dom.faceSession.addEventListener('change', (event) => {
    view.sessionId = event.target.value || null;
    view.candidate = null;
    renderEngineInfo();
    renderRoster();
    renderResult();
  });

  controlsBody.querySelector('#faceCreateSession').addEventListener('click', () => {
    const session = ensureSession(view.classId, todayISO());
    view.sessionId = session.id;
    dom.faceSession.innerHTML = sessionOptions(getSessionsByClass(view.classId), view.sessionId, { includeEmpty: true });
    renderEngineInfo();
    renderRoster();
    renderResult();
    toast('Session ready', `Today's session for ${getClass(view.classId)?.name} is selected.`, 'ok');
  });

  dom.modeSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    const nextMode = button.dataset.mode;
    if (nextMode === view.mode) return;
    stop();
    view.mode = nextMode;
    dom.modeSwitch.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === button));
    dom.autoConfirm.closest('label').hidden = nextMode === 'sim';
    renderEngineInfo();
    renderResult();
    renderRoster();
  });

  /* ------------------------------- First paint ----------------------------- */
  renderEngineInfo();
  renderResult();
  renderRoster();
  if (view.mode === 'live' && cameraSupported()) {
    // Preload the models quietly so the first "Start camera" click is instant.
    loadModels(() => {}).catch(() => {});
  }

  const cls = getClass(view.classId);

  return {
    title: 'Face Attendance',
    subtitle: `${cls?.name || ''} · ${view.sessionId ? formatDate(getSession(view.sessionId)?.date) : 'no session selected'}`,
    element: root,
    // Keep the camera alive when attendance is recorded.
    refreshOnChange: false,
    destroy() {
      view.destroyed = true;
      stop();
    },
  };
}