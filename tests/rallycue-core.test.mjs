import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGE_GROUPS,
  DEFAULT_VOICE_ID,
  EMPTY_AGE_GROUP,
  LEGACY_VOICE_IDS,
  THORSTEN_EMOTIONAL_SPEAKER,
  THORSTEN_EMOTIONAL_SPEAKER_ID,
  assignPlayerToCourt,
  clearCourt,
  createBackup,
  createEmptyCourts,
  divisionOf,
  isPlayerDraftValid,
  migrateVoiceId,
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

test('ein neuer Spieler benötigt eine echte Altersklassenauswahl', () => {
  assert.equal(EMPTY_AGE_GROUP, '');
  assert.equal(isPlayerDraftValid('Max Mustermann', EMPTY_AGE_GROUP, 'Jungen Einzel'), false);
  assert.equal(isPlayerDraftValid('Max Mustermann', 'U13', 'Jungen Einzel'), true);
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

test('Jungen und Mädchen derselben Altersklasse bleiben getrennte Divisionen', () => {
  assert.notEqual(divisionOf(max), divisionOf(nora));
});

test('Feld leeren entfernt beide Slots und lässt andere Felder unverändert', () => {
  const courts = withCourt(1, max.id, bernd.id);
  courts[1].players[0] = nora.id;
  const otherCourtBefore = courts[1];
  const result = clearCourt(courts, 1);

  assert.deepEqual(result[0].players, [null, null]);
  assert.equal(result[1], otherCourtBefore);
  assert.equal(result[1].players[0], nora.id);
});

test('Thorsten Emotional neutral ist die feste RallyCue-Stimme', () => {
  assert.equal(DEFAULT_VOICE_ID, 'de_DE-thorsten_emotional-medium');
  assert.equal(THORSTEN_EMOTIONAL_SPEAKER_ID, 4);
  assert.deepEqual(THORSTEN_EMOTIONAL_SPEAKER, { id: 4, label: 'neutral' });
  assert.equal(migrateVoiceId(DEFAULT_VOICE_ID), DEFAULT_VOICE_ID);
  for (const voiceId of LEGACY_VOICE_IDS) {
    assert.equal(migrateVoiceId(voiceId), DEFAULT_VOICE_ID);
  }
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
    { voiceId: DEFAULT_VOICE_ID, speedId: 'fast' },
    [],
    '2026-09-20T12:00:00.000Z',
  );
  const result = parseBackup(JSON.stringify(backup));

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.players, players);
  assert.deepEqual(result.value.courts, courts);
  assert.deepEqual(result.value.settings, {
    voiceId: DEFAULT_VOICE_ID,
    speedId: 'fast',
  });
  assert.deepEqual(result.value.pronunciationDictionary, []);
});

test('alte Version-1-Backups ohne Aussprachewörterbuch bleiben importierbar', () => {
  const result = parseBackup({
    format: 'rallycue-backup',
    version: 1,
    exportedAt: '2026-09-20T12:00:00.000Z',
    players,
    courts: withCourt(1, max.id, bernd.id),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.pronunciationDictionary, []);
});

test('neue Backups erhalten das benutzerdefinierte Aussprachewörterbuch', () => {
  const pronunciationDictionary = [
    { source: '  Chen   Xuan ', replacement: ' Tschenn   Schüän ' },
  ];
  const backup = createBackup(
    players,
    withCourt(1, max.id, bernd.id),
    { voiceId: DEFAULT_VOICE_ID, speedId: 'standard' },
    pronunciationDictionary,
    '2026-09-20T12:00:00.000Z',
  );
  const result = parseBackup(JSON.stringify(backup));

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.pronunciationDictionary, [
    { source: 'Chen Xuan', replacement: 'Tschenn Schüän' },
  ]);
});

test('ein Backup mit ungültigem Aussprachewörterbuch wird vollständig abgelehnt', () => {
  const result = parseBackup({
    format: 'rallycue-backup',
    version: 1,
    exportedAt: '2026-09-20T12:00:00.000Z',
    players,
    courts: withCourt(1, max.id, bernd.id),
    pronunciationDictionary: [
      { source: 'Marcel', replacement: 'Marsell' },
      { source: 'MARCEL', replacement: 'Marßell' },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /mehrfach/);
});

for (const legacyVoiceId of LEGACY_VOICE_IDS) {
  const sourceVersion = legacyVoiceId === 'de_DE-thorsten-high' ? '0.1.6' : '0.1.2';
  test(`${sourceVersion}-Backup mit ${legacyVoiceId} bleibt kompatibel`, () => {
    const result = parseBackup({
      format: 'rallycue-backup',
      version: 1,
      exportedAt: '2026-09-20T12:00:00.000Z',
      players,
      courts: withCourt(1, max.id, bernd.id),
      settings: { voiceId: legacyVoiceId, speedId: 'slow' },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.value.settings, {
      voiceId: DEFAULT_VOICE_ID,
      speedId: 'slow',
    });
  });
}

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
