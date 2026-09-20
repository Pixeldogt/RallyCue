import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGE_GROUPS,
  assignPlayerToCourt,
  createBackup,
  createEmptyCourts,
  parseBackup,
} from '../lib/rallycue-core.ts';

const max = {
  id: 'max',
  name: 'Max Mustermann',
  ageGroup: 'U13',
  category: 'Jungen Einzel',
};
const bernd = {
  id: 'bernd',
  name: 'Bernd Beispiel',
  ageGroup: 'U13',
  category: 'Jungen Einzel',
};
const nora = {
  id: 'nora',
  name: 'Nora Klein',
  ageGroup: 'U13',
  category: 'Mädchen Einzel',
};
const players = [max, bernd, nora];

function withCourt(courtId, first, second) {
  return createEmptyCourts().map((court) =>
    court.id === courtId ? { ...court, players: [first, second] } : court,
  );
}

test('U9 ist eine gültige Altersklasse', () => {
  assert.equal(AGE_GROUPS.includes('U9'), true);
});

test('ein Spieler kann nicht auf den anderen Slot desselben Feldes wechseln', () => {
  const courts = withCourt(1, max.id, bernd.id);
  const result = assignPlayerToCourt(players, courts, max.id, 1, 1);

  assert.equal(result.status, 'rejected');
  assert.equal(result.code, 'same-court');
  assert.deepEqual(result.courts, courts);
});

test('ein Spieler kann zwischen Feldern verschoben werden', () => {
  const courts = withCourt(1, max.id, null);
  const result = assignPlayerToCourt(players, courts, max.id, 2, 0);

  assert.equal(result.status, 'ready');
  assert.equal(result.courts[0].players[0], null);
  assert.equal(result.courts[1].players[0], max.id);
});

test('Spieler unterschiedlicher Division werden abgelehnt', () => {
  const courts = withCourt(1, max.id, null);
  const result = assignPlayerToCourt(players, courts, nora.id, 1, 1);

  assert.equal(result.status, 'rejected');
  assert.equal(result.code, 'division-mismatch');
  assert.deepEqual(result.courts, courts);
});

test('ein belegter Zielslot benötigt weiterhin eine Bestätigung', () => {
  const courts = withCourt(1, max.id, bernd.id);
  const move = assignPlayerToCourt(players, courts, nora.id, 2, 0);
  assert.equal(move.status, 'ready');

  const overwrite = assignPlayerToCourt(players, move.courts, max.id, 2, 0);
  assert.equal(overwrite.status, 'overwrite-required');
  assert.equal(overwrite.existingPlayerId, nora.id);
  assert.deepEqual(overwrite.courts, move.courts);
});

test('Backup-Export und -Import erhalten Spieler und Felder', () => {
  const courts = withCourt(1, max.id, bernd.id);
  const backup = createBackup(
    players,
    courts,
    { voiceId: 'de_DE-karlsson-low', speedId: 'fast' },
    '2026-09-20T12:00:00.000Z',
  );
  const result = parseBackup(JSON.stringify(backup));

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.players, players);
  assert.deepEqual(result.value.courts, courts);
  assert.deepEqual(result.value.settings, {
    voiceId: 'de_DE-karlsson-low',
    speedId: 'fast',
  });
});

test('ein ungültiges Backup verändert vorhandene Daten nicht', () => {
  const courts = withCourt(1, max.id, bernd.id);
  const existing = structuredClone({ players, courts });
  const result = parseBackup('{kaputt');

  assert.equal(result.ok, false);
  assert.deepEqual({ players, courts }, existing);
});

test('eine unbekannte zukünftige Backupversion wird abgelehnt', () => {
  const result = parseBackup({
    format: 'rallycue-backup',
    version: 2,
    exportedAt: '2026-09-20T12:00:00.000Z',
    players,
    courts: createEmptyCourts(),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /keine unterstützte RallyCue-Sicherung/);
});

test('ein Backup mit doppelter Spielerzuweisung wird abgelehnt', () => {
  const courts = withCourt(1, max.id, null);
  courts[1].players[0] = max.id;
  const result = parseBackup({
    format: 'rallycue-backup',
    version: 1,
    exportedAt: '2026-09-20T12:00:00.000Z',
    players,
    courts,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /mehrfach/);
});

test('ein Backup mit Spieler gegen sich selbst wird abgelehnt', () => {
  const courts = withCourt(1, max.id, max.id);
  const result = parseBackup({
    format: 'rallycue-backup',
    version: 1,
    exportedAt: '2026-09-20T12:00:00.000Z',
    players,
    courts,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /sich selbst/);
});

test('eine normale Zuordnung funktioniert weiterhin', () => {
  const courts = createEmptyCourts();
  const result = assignPlayerToCourt(players, courts, bernd.id, 4, 1);

  assert.equal(result.status, 'ready');
  assert.equal(result.courts[3].players[1], bernd.id);
});

test('erneute Zuweisung auf denselben Slot ist ein No-op', () => {
  const courts = withCourt(1, max.id, null);
  const result = assignPlayerToCourt(players, courts, max.id, 1, 0);

  assert.equal(result.status, 'noop');
  assert.equal(result.courts, courts);
});
