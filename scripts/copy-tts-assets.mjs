import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const assets = [
  [
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
    'public/onnx/ort-wasm-simd-threaded.mjs',
  ],
  [
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
    'public/onnx/ort-wasm-simd-threaded.wasm',
  ],
  [
    'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data',
    'public/piper/piper_phonemize.data',
  ],
  [
    'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm',
    'public/piper/piper_phonemize.wasm',
  ],
];

for (const [source, destination] of assets) {
  const outputPath = resolve(projectRoot, destination);
  await mkdir(dirname(outputPath), { recursive: true });
  await copyFile(resolve(projectRoot, source), outputPath);
}

console.log('Local Piper runtime assets are ready.');
