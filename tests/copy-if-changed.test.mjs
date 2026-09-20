import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { copyIfChanged } from '../scripts/copy-if-changed.mjs';

const temporaryDirectories = [];

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rallycue-copy-'));
  temporaryDirectories.push(directory);
  return {
    source: join(directory, 'source.bin'),
    destination: join(directory, 'destination.bin'),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test('copyIfChanged kopiert ein fehlendes Ziel', async () => {
  const { source, destination } = await createFixture();
  await writeFile(source, 'runtime-v1');

  assert.equal(await copyIfChanged(source, destination), 'copied');
  assert.equal(await readFile(destination, 'utf8'), 'runtime-v1');
});

test('copyIfChanged schreibt identischen Inhalt nicht erneut', async () => {
  const { source, destination } = await createFixture();
  await writeFile(source, 'runtime-v1');
  await writeFile(destination, 'runtime-v1');
  const fixedTime = new Date('2026-01-01T00:00:00.000Z');
  await utimes(destination, fixedTime, fixedTime);
  const modifiedBefore = (await stat(destination)).mtimeMs;

  assert.equal(await copyIfChanged(source, destination), 'unchanged');
  assert.equal((await stat(destination)).mtimeMs, modifiedBefore);
});

test('copyIfChanged aktualisiert unterschiedlichen Inhalt', async () => {
  const { source, destination } = await createFixture();
  await writeFile(source, 'runtime-v2');
  await writeFile(destination, 'runtime-v1');

  assert.equal(await copyIfChanged(source, destination), 'updated');
  assert.equal(await readFile(destination, 'utf8'), 'runtime-v2');
});
