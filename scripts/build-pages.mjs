import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const basePath = '/RallyCue';
const outDir = resolve(projectRoot, 'out');

await import('./copy-tts-assets.mjs');

const nextBin = resolve(projectRoot, 'node_modules/next/dist/bin/next');
const build = spawnSync(process.execPath, [nextBin, 'build', '--webpack'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    GITHUB_PAGES: 'true',
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_ENABLE_PWA: 'true',
  },
  stdio: 'inherit',
});

if (build.status !== 0) process.exit(build.status ?? 1);

const packageJson = JSON.parse(
  await readFile(resolve(projectRoot, 'package.json'), 'utf8'),
);

const manifest = {
  id: `${basePath}/`,
  name: 'RallyCue',
  short_name: 'RallyCue',
  description: 'Spieler auf neun Felder verteilen und Begegnungen direkt aufrufen.',
  start_url: `${basePath}/`,
  scope: `${basePath}/`,
  display: 'standalone',
  background_color: '#f7f5f8',
  theme_color: '#6845b7',
  lang: 'de',
  icons: [
    {
      src: `${basePath}/rallycue-logo.png`,
      sizes: 'any',
      type: 'image/png',
      purpose: 'any maskable',
    },
  ],
};

await writeFile(
  resolve(outDir, 'manifest.webmanifest'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);
await writeFile(resolve(outDir, '.nojekyll'), '', 'utf8');

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    if (entry.isFile() && !entry.name.startsWith('.') && entry.name !== 'sw.js') {
      files.push(path);
    }
  }
  return files;
}

const assets = (await collectFiles(outDir))
  .map((path) => `${basePath}/${relative(outDir, path).split(sep).join('/')}`)
  .sort();

const serviceWorker = `const CACHE_PREFIX = 'rallycue-';
const CACHE_NAME = ${JSON.stringify(`rallycue-${packageJson.version}`)};
const APP_SHELL = ${JSON.stringify(assets, null, 2)};
const START_URL = ${JSON.stringify(`${basePath}/`)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => event.request.mode === 'navigate' ? caches.match(START_URL) : undefined);
    }),
  );
});
`;

await writeFile(resolve(outDir, 'sw.js'), serviceWorker, 'utf8');
console.log(`GitHub Pages export is ready with ${assets.length} cached files.`);
