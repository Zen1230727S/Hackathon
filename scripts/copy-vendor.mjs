/**
 * Copies the face recognition library + the model files we actually use from
 * node_modules into ./vendor/face-api so the app can be served offline.
 *
 * Run once after "npm install":   npm run setup
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules', '@vladmandic', 'face-api');
const DEST = path.join(ROOT, 'vendor', 'face-api');

const FILES = [
  // Browser bundle (includes TensorFlow.js backends).
  ['dist/face-api.js', 'face-api.js'],
  // Face detector (small + fast enough for a live webcam loop).
  ['model/tiny_face_detector_model-weights_manifest.json', 'model/tiny_face_detector_model-weights_manifest.json'],
  ['model/tiny_face_detector_model.bin', 'model/tiny_face_detector_model.bin'],
  // 68-point landmarks - used for face alignment before recognition.
  ['model/face_landmark_68_model-weights_manifest.json', 'model/face_landmark_68_model-weights_manifest.json'],
  ['model/face_landmark_68_model.bin', 'model/face_landmark_68_model.bin'],
  // Face recognition network that produces the 128-D face descriptor.
  ['model/face_recognition_model-weights_manifest.json', 'model/face_recognition_model-weights_manifest.json'],
  ['model/face_recognition_model.bin', 'model/face_recognition_model.bin'],
];

if (!fs.existsSync(SRC)) {
  console.error('\n  node_modules/@vladmandic/face-api not found.');
  console.error('  Run "npm install" first, then "npm run setup".\n');
  process.exit(1);
}

let copied = 0;
for (const [from, to] of FILES) {
  const source = path.join(SRC, from);
  const target = path.join(DEST, to);
  if (!fs.existsSync(source)) {
    console.error(`  Missing source file: ${from}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copied += 1;
  console.log(`  copied ${to}`);
}

console.log(`\n  Face recognition assets ready in ./vendor/face-api (${copied} files).\n`);