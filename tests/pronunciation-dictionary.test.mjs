import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_PRONUNCIATION_DICTIONARY,
  applyPronunciationDictionary,
  mergePronunciationDictionaries,
  validatePronunciationDictionary,
} from '../lib/pronunciation-dictionary.ts';

const builtIns = mergePronunciationDictionaries([]);

test('das mitgelieferte Wörterbuch enthält genau die 26 geprüften Einträge', () => {
  assert.equal(BUILTIN_PRONUNCIATION_DICTIONARY.length, 26);
});

test('zentrale Problemnamen werden für Piper korrigiert', () => {
  assert.equal(
    applyPronunciationDictionary('Marcel, Nikhilesh, Nguyen und Zheng.', builtIns),
    'Marsell, Nikhilesch, Ngwien und Dscheng.',
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
    'Marcelino trifft Marsell; Ngwien!',
  );
});

test('Bindestriche und Apostrophe bilden sinnvolle Namensgrenzen', () => {
  assert.equal(
    applyPronunciationDictionary("Marcel-Nguyen und Marcel'Nguyen", builtIns),
    "Marsell-Ngwien und Marsell'Ngwien",
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
