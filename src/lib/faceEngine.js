/**
 * Face recognition wrapper around @vladmandic/face-api (face-api.js).
 *
 * HOW IT WORKS
 *   1. TinyFaceDetector finds face bounding boxes in the webcam frame.
 *   2. 68-point landmarks align the face.
 *   3. The recognition network turns the aligned face into a 128-number
 *      "face descriptor" (an embedding).
 *   4. We compare that descriptor to the descriptors stored for enrolled
 *      students using Euclidean distance. The closest descriptor under the
 *      match threshold is the recognised student.
 *
 * HONEST LIMITATIONS (please state these to judges):
 *   - This is a prototype, NOT production biometrics. No liveness / anti-spoofing.
 *   - Accuracy depends on lighting, camera angle and image quality.
 *   - The descriptor threshold (default 0.5) is a tunable demo setting, not a
 *     security parameter.
 *   - Only fictional demo students are registered; the operator chooses which
 *     face to enrol. Never enrol other people's faces without their consent.
 *
 * If the library or models cannot be loaded, every caller must degrade to
 * MANUAL attendance - the app must never break because of the camera.
 */

const MODEL_URL = './vendor/face-api/model';

/** Runtime status of the engine, useful for the UI. */
const status = {
  available: false,
  modelsLoaded: false,
  loading: false,
  error: null,
  backend: null,
};

let loadPromise = null;

export function getEngineStatus() {
  return { ...status, api: typeof window !== 'undefined' && Boolean(window.faceapi) };
}

/** True when the browser can even ask for a camera. */
export function cameraSupported() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function cameraBlockedReason() {
  if (!cameraSupported()) {
    return 'This browser does not expose a camera API. Use Chrome or Edge on http://localhost.';
  }
  if (!window.isSecureContext) {
    return 'The page is not running in a secure context. Open the app via http://localhost, not file://.';
  }
  return null;
}

/* ------------------------------ model loading ----------------------------- */

/**
 * Load the three models we need. Safe to call many times - the work happens once.
 * @param {(info:{message:string, progress:number}) => void} [onProgress]
 */
export function loadModels(onProgress = () => {}) {
  if (status.modelsLoaded) {
    onProgress({ message: 'Face models already loaded', progress: 100 });
    return Promise.resolve(true);
  }
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const faceapi = window.faceapi;
    if (!faceapi) {
      status.error = 'The face recognition library could not be loaded. Check that vendor/face-api/face-api.js exists (run "npm run setup").';
      status.available = false;
      throw new Error(status.error);
    }

    status.loading = true;
    status.available = true;

    try {
      // Prefer WebGL (GPU) and fall back to the CPU backend.
      try {
        await faceapi.tf.setBackend('webgl');
        await faceapi.tf.ready();
        status.backend = 'webgl';
      } catch {
        await faceapi.tf.setBackend('cpu');
        await faceapi.tf.ready();
        status.backend = 'cpu';
      }

      const steps = [
        ['Loading face detector…', faceapi.nets.tinyFaceDetector],
        ['Loading face landmarks…', faceapi.nets.faceLandmark68Net],
        ['Loading recognition network…', faceapi.nets.faceRecognitionNet],
      ];

      for (let i = 0; i < steps.length; i += 1) {
        const [message, net] = steps[i];
        onProgress({ message, progress: Math.round((i / steps.length) * 100) });
        await net.loadFromUri(MODEL_URL);
      }

      status.modelsLoaded = true;
      status.loading = false;
      onProgress({ message: 'Face recognition ready', progress: 100 });
      return true;
    } catch (error) {
      status.loading = false;
      status.error = `Face models failed to load: ${error.message}. Manual attendance is still available.`;
      loadPromise = null;
      throw new Error(status.error);
    }
  })();

  return loadPromise;
}

/* ------------------------------ camera control ---------------------------- */

/**
 * Start the webcam and attach the stream to a <video> element.
 * @returns {Promise<MediaStream>}
 */
export async function startCamera(videoElement, { width = 1280, height = 720, deviceId = null } = {}) {
  const blocked = cameraBlockedReason();
  if (blocked) throw new Error(blocked);

  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: width }, height: { ideal: height } }
      : { facingMode: 'user', width: { ideal: width }, height: { ideal: height } },
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoElement.srcObject = stream;
  videoElement.setAttribute('playsinline', 'true');
  videoElement.muted = true;
  await videoElement.play().catch(() => {});

  // Wait until we actually have frames (avoids the "blank first detection" bug).
  await new Promise((resolve) => {
    if (videoElement.readyState >= 2 && videoElement.videoWidth) {
      resolve();
      return;
    }
    const onReady = () => {
      videoElement.removeEventListener('loadeddata', onReady);
      resolve();
    };
    videoElement.addEventListener('loadeddata', onReady);
    setTimeout(resolve, 2500);
  });

  return stream;
}

export function stopCamera(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

/** Turns a getUserMedia error into a teacher-friendly sentence. */
export function describeCameraError(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was denied. Click the camera icon in the address bar to allow access, then try again. Manual attendance still works.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device. Use manual attendance instead.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is already in use by another application. Close it and try again.';
  }
  if (name === 'OverconstrainedError') {
    return 'The requested camera settings are not supported. Try again with default settings.';
  }
  return `${error?.message || 'The camera could not be started.'} Manual attendance is still available.`;
}

/* ------------------------------ detection --------------------------------- */

export const detectorOptions = () =>
  new window.faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 });

/**
 * Detect every face in a video/image element and compute descriptors.
 * @returns {Promise<Array<{descriptor:Float32Array, box:{x:number,y:number,width:number,height:number}, score:number}>>}
 */
export async function detectFaces(input) {
  if (!status.modelsLoaded) return [];
  const faceapi = window.faceapi;
  try {
    const results = await faceapi
      .detectAllFaces(input, detectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors();
    return results.map((r) => ({
      descriptor: r.descriptor,
      box: r.detection.box,
      score: r.detection.score,
    }));
  } catch (error) {
    console.warn('[faceEngine] detection failed:', error);
    return [];
  }
}

/** Convenience wrapper for a single face (used by the enrollment page). */
export async function detectSingleFace(input) {
  const faces = await detectFaces(input);
  if (!faces.length) return null;
  // Return the largest face - most likely the person in front of the camera.
  return faces.reduce((best, face) => (face.box.width * face.box.height > best.box.width * best.box.height ? face : best));
}

/** Same as detectFaces but with a single descriptor for enrollment captures. */
export async function captureDescriptor(input) {
  const face = await detectSingleFace(input);
  return face ? face.descriptor : null;
}

/* -------------------------------- matching -------------------------------- */

/** Euclidean distance between two 128-D descriptors (lower = more similar). */
export function euclideanDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Average several descriptors into one, then re-normalise (more stable enrollment). */
export function averageDescriptors(descriptors) {
  const valid = descriptors.filter((d) => Array.isArray(d) || d instanceof Float32Array);
  if (!valid.length) return null;
  const length = valid[0].length;
  const out = new Float32Array(length);
  for (const descriptor of valid) {
    for (let i = 0; i < length; i += 1) out[i] += descriptor[i];
  }
  let norm = 0;
  for (let i = 0; i < length; i += 1) {
    out[i] /= valid.length;
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < length; i += 1) out[i] /= norm;
  return Array.from(out);
}

/**
 * Compare one live descriptor against every enrolled student.
 * @param {ArrayLike<number>} descriptor
 * @param {Array<{id:string,name:string,rollNo:string,classId:string,descriptor:number[]}>} enrolled
 * @param {number} threshold maximum Euclidean distance that still counts as a match
 */
export function findBestMatch(descriptor, enrolled, threshold = 0.5) {
  let best = null;
  for (const student of enrolled) {
    if (!Array.isArray(student.descriptor) || !student.descriptor.length) continue;
    const distance = euclideanDistance(descriptor, student.descriptor);
    if (!best || distance < best.distance) best = { student, distance };
  }
  if (!best) return { match: null, distance: Infinity, confidence: 0, isMatch: false, candidates: [] };

  // A simple, explainable confidence: 0.0 distance -> 100%, threshold -> ~50%.
  const confidence = Math.max(0, Math.min(100, (1 - best.distance) * 100));

  const candidates = enrolled
    .filter((s) => Array.isArray(s.descriptor) && s.descriptor.length)
    .map((s) => ({ student: s, distance: euclideanDistance(descriptor, s.descriptor) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((c) => ({ ...c, confidence: Math.max(0, Math.min(100, (1 - c.distance) * 100)) }));

  return {
    match: best.student,
    distance: best.distance,
    confidence,
    isMatch: best.distance <= threshold,
    candidates,
  };
}

/* ------------------------- deterministic demo fallback --------------------- */

/**
 * Deterministic pseudo-descriptor generator.
 *
 * Used ONLY when the teacher explicitly switches the Face Attendance page into
 * "Simulated demo" mode (for example when a judge's laptop has no working
 * camera). It is clearly labelled as a simulation in the UI - it is not real
 * recognition and must never be presented as such.
 */
export function simulatedDescriptor(seedText, length = 128) {
  let h = 2166136261;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    h ^= seedText.charCodeAt(i % seedText.length) + i;
    h = Math.imul(h, 16777619);
    out[i] = ((h >>> 0) / 4294967295) * 2 - 1;
  }
  let norm = 0;
  for (let i = 0; i < length; i += 1) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < length; i += 1) out[i] /= norm;
  return out;
}