import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_PRONUNCIATION_DICTIONARY,
  applyPronunciationDictionary,
  buildCourtAnnouncement,
  mergePronunciationDictionaries,
  prepareNameForAnnouncement,
  validatePronunciationDictionary,
} from '../lib/pronunciation-dictionary.ts';

const builtIns = mergePronunciationDictionaries([]);

test('das mitgelieferte Wörterbuch enthält genau die 34 geprüften Einträge', () => {
  assert.equal(BUILTIN_PRONUNCIATION_DICTIONARY.length, 34);
});

test('zentrale Problemnamen werden für Piper korrigiert', () => {
  assert.equal(
    applyPronunciationDictionary('Marcel, Nikhilesh, Nguyen und Zheng.', builtIns),
    'Marsell, Nikhilesch, Nüyen und Dscheng.',
  );
});

test('Matching ist unabhängig von Groß- und Kleinschreibung', () => {
  assert.equal(
    applyPronunciationDictionary('marcel MARCEL Marcel', builtIns),
    'Marsell Marsell Marsell',
  );
});

test('nur vollständige Tokens werden ersetzt und Satzzeichen bleiben erhalten', () => {
  assert.equal(
    applyPronunciationDictionary('Marcelino trifft Marcel; Nguyen!', builtIns),
    'Marcelino trifft Marsell; Nüyen!',
  );
});

test('Bindestriche und Apostrophe bilden sinnvolle Namensgrenzen', () => {
  assert.equal(
    applyPronunciationDictionary("Marcel-Nguyen und Marcel'Nguyen", builtIns),
    "Marsell-Nüyen und Marsell'Nüyen",
  );
});

test('Vor- und Nachnamen werden korrigiert, ohne die Namensmelodie zu zerhacken', () => {
  assert.equal(
    prepareNameForAnnouncement('Sally Chen Xuan Zhu', builtIns),
    'Sällie Schän Schüän Dschu',
  );
  assert.equal(
    prepareNameForAnnouncement('Tim Hoang Nguyen', builtIns),
    'Tim Hwang Nüyen',
  );
  assert.equal(
    prepareNameForAnnouncement('Stella Ying Loi', builtIns),
    'Stella Jing Loi',
  );
});

test('mehrteilige Custom-Einträge greifen vor der Namensaufbereitung', () => {
  const entries = mergePronunciationDictionaries([
    { source: 'Stella Ying Loi', replacement: 'Stella Jing Loy' },
  ]);
  assert.equal(
    prepareNameForAnnouncement('Stella Ying Loi', entries),
    'Stella Jing Loy',
  );
});

test('Begegnungsansagen setzen nur vor gegen eine weiche Sprechpause', () => {
  assert.equal(
    buildCourtAnnouncement(
      1,
      'Jungen Einzel U13',
      'Tim Hoang Nguyen',
      'Lucas Chen Xuan Zhu',
      builtIns,
    ),
    'Es spielen auf Feld 1, Jungen Einzel U13: Tim Hwang Nüyen, gegen Lucas Schän Schüän Dschu. Ich wiederhole: Tim Hwang Nüyen, gegen Lucas Schän Schüän Dschu, auf Feld 1.',
  );
});

test('Unicode und deutsche Umlaute werden unterstützt', () => {
  const entries = [{ source: 'Müller', replacement: 'Mühler' }];
  assert.equal(
    applyPronunciationDictionary('MÜLLER gegen Müller.', entries),
    'Mühler gegen Mühler.',
  );
});

test('mehrteilige Einträge gewinnen vor kürzeren Einträgen', () => {
  const entries = [
    { source: 'Jean', replacement: 'Schan' },
    { source: 'Jean Dupont', replacement: 'Schan Düpong' },
  ];
  assert.equal(
    applyPronunciationDictionary('Jean Dupont gegen Jean.', entries),
    'Schan Düpong gegen Schan.',
  );
});

test('benutzerdefinierte Einträge überschreiben mitgelieferte Einträge', () => {
  const entries = mergePronunciationDictionaries([
    { source: 'marcel', replacement: 'Marßell' },
  ]);
  assert.equal(applyPronunciationDictionary('Marcel', entries), 'Marßell');
});

test('Text ohne Treffer bleibt unverändert', () => {
  const text = 'Es spielen Anna gegen Bernd.';
  assert.equal(applyPronunciationDictionary(text, builtIns), text);
});

test('doppelte benutzerdefinierte Sources werden case-insensitive abgelehnt', () => {
  const result = validatePronunciationDictionary([
    { source: 'Marcel', replacement: 'Marsell' },
    { source: ' marCEL ', replacement: 'Marßell' },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /mehrfach/);
});
