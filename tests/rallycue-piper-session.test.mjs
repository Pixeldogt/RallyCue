import assert from 'node:assert/strict';
import test from 'node:test';

import {
  neutralSpeakerTensorValues,
  validateThorstenEmotionalModelConfig,
} from '../lib/rallycue-piper-session.ts';

function validModelConfig() {
  return {
    audio: { sample_rate: 22050 },
    espeak: { voice: 'de' },
    inference: {
      noise_scale: 0.667,
      length_scale: 1,
      noise_w: 0.8,
    },
    speaker_id_map: {
      amused: 0,
      angry: 1,
      disgusted: 2,
      drunk: 3,
      neutral: 4,
      sleepy: 5,
      surprised: 6,
      whisper: 7,
    },
  };
}

test('der ONNX-Speaker-Tensor verwendet ausschließlich neutral mit ID 4', () => {
  assert.deepEqual(neutralSpeakerTensorValues(), [4]);
});

test('die erwartete Thorsten-Emotional-Konfiguration wird akzeptiert', () => {
  const config = validateThorstenEmotionalModelConfig(validModelConfig());
  assert.equal(config.speaker_id_map.neutral, 4);
  assert.equal(config.espeak.voice, 'de');
});

test('eine unerwartete neutrale Speaker-ID stoppt die Initialisierung', () => {
  const config = validModelConfig();
  config.speaker_id_map.neutral = 0;
  assert.throws(
    () => validateThorstenEmotionalModelConfig(config),
    /neutral ist Speaker 0, erwartet wurde 4/,
  );
});

test('eine fehlende neutrale Speaker-ID stoppt die Initialisierung', () => {
  const config = validModelConfig();
  delete config.speaker_id_map.neutral;
  assert.throws(
    () => validateThorstenEmotionalModelConfig(config),
    /neutral ist Speaker undefined, erwartet wurde 4/,
  );
});
