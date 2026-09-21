import {
  DEFAULT_VOICE_ID,
  THORSTEN_EMOTIONAL_SPEAKER,
  type VoiceId,
} from './rallycue-core.ts';

type PiperWasmPaths = {
  onnxWasm: string;
  piperData: string;
  piperWasm: string;
};

type PiperModelConfig = {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: {
    noise_scale: number;
    length_scale: number;
    noise_w: number;
  };
  speaker_id_map: Record<string, number>;
};

type OrtSession = {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: unknown }>>;
};

type OrtRuntime = {
  env: {
    allowLocalModels?: boolean;
    wasm: {
      numThreads: number;
      wasmPaths:
        | string
        | {
            mjs: URL | string;
            wasm: URL | string;
          };
    };
  };
  Tensor: new (
    type: 'int64' | 'float32',
    data: readonly number[] | Float32Array,
    dimensions?: readonly number[],
  ) => unknown;
  InferenceSession: {
    create: (
      model: ArrayBuffer,
      options: { executionProviders: ['wasm'] },
    ) => Promise<OrtSession>;
  };
};

type SessionOptions = {
  voiceId: VoiceId;
  speakerId: number;
  wasmPaths: PiperWasmPaths;
};

const MAX_CHUNK_LENGTH = 400;
export const LEADING_SILENCE_MS = 180;
export const SPEECH_LENGTH_SCALE = 1.08;

export function leadingSilenceSampleCount(sampleRate: number) {
  return Math.max(0, Math.round((sampleRate * LEADING_SILENCE_MS) / 1000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Piper-Modellkonfiguration: ${label} fehlt.`);
  return value;
}

function requireNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Piper-Modellkonfiguration: ${label} ist ungültig.`);
  }
  return value;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Piper-Modellkonfiguration: ${label} ist ungültig.`);
  }
  return value;
}

export function validateThorstenEmotionalModelConfig(
  input: unknown,
): PiperModelConfig {
  const config = requireRecord(input, 'Wurzelobjekt');
  const audio = requireRecord(config.audio, 'audio');
  const espeak = requireRecord(config.espeak, 'espeak');
  const inference = requireRecord(config.inference, 'inference');
  const speakerMap = requireRecord(config.speaker_id_map, 'speaker_id_map');
  const neutralSpeakerId = speakerMap[THORSTEN_EMOTIONAL_SPEAKER.label];

  if (neutralSpeakerId !== THORSTEN_EMOTIONAL_SPEAKER.id) {
    throw new Error(
      `Unerwartete Thorsten-Emotional-Konfiguration: neutral ist Speaker ${String(neutralSpeakerId)}, erwartet wurde ${THORSTEN_EMOTIONAL_SPEAKER.id}.`,
    );
  }

  return {
    audio: { sample_rate: requireNumber(audio.sample_rate, 'audio.sample_rate') },
    espeak: { voice: requireString(espeak.voice, 'espeak.voice') },
    inference: {
      noise_scale: requireNumber(inference.noise_scale, 'inference.noise_scale'),
      length_scale: requireNumber(inference.length_scale, 'inference.length_scale'),
      noise_w: requireNumber(inference.noise_w, 'inference.noise_w'),
    },
    speaker_id_map: Object.fromEntries(
      Object.entries(speakerMap).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number',
      ),
    ),
  };
}

export function neutralSpeakerTensorValues() {
  return [THORSTEN_EMOTIONAL_SPEAKER.id] as const;
}

async function readStoredVoiceFile(fileName: string) {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle('piper');
  const handle = await directory.getFileHandle(fileName);
  return handle.getFile();
}

function splitIntoChunks(text: string, maxLength = MAX_CHUNK_LENGTH) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLength) return [trimmed];

  const sentences = trimmed.match(/[^.!?…\n]+[.!?…]*\s*/gu) ?? [trimmed];
  const chunks: string[] = [];
  let current = '';
  const pushCurrent = () => {
    const chunk = current.trim();
    if (chunk) chunks.push(chunk);
    current = '';
  };

  for (const sentence of sentences) {
    if ((current + sentence).length > maxLength) pushCurrent();
    if (sentence.length > maxLength) {
      let piece = '';
      for (const word of sentence.split(/\s+/u)) {
        if (`${piece} ${word}`.trim().length > maxLength) {
          if (piece.trim()) chunks.push(piece.trim());
          piece = word;
        } else {
          piece = piece ? `${piece} ${word}` : word;
        }
      }
      current = piece;
    } else {
      current += sentence;
    }
  }
  pushCurrent();
  return chunks;
}

function pcmToWav(buffer: Float32Array, sampleRate: number) {
  const headerLength = 44;
  const view = new DataView(new ArrayBuffer(buffer.length * 2 + headerLength));
  view.setUint32(0, 0x46464952, true);
  view.setUint32(4, view.buffer.byteLength - 8, true);
  view.setUint32(8, 0x45564157, true);
  view.setUint32(12, 0x20746d66, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, 2 * sampleRate, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x61746164, true);
  view.setUint32(40, buffer.length * 2, true);

  let position = headerLength;
  for (const sample of buffer) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      position,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
    position += 2;
  }
  return view.buffer;
}

/**
 * Minimal RallyCue adapter based on the MIT-licensed inference flow from
 * @mintplex-labs/piper-tts-web 1.0.5
 * (https://github.com/Mintplex-Labs/piper-tts-web).
 *
 * The upstream package remains responsible for OPFS download/storage. This
 * adapter only reads that stored model and makes the required speaker tensor
 * explicit instead of using upstream's hard-coded speaker 0.
 */
export class RallyCuePiperSession {
  private readonly ort: OrtRuntime;
  private readonly ortSession: OrtSession;
  private readonly modelConfig: PiperModelConfig;
  private readonly createPiperPhonemize: typeof import('@diffusionstudio/piper-wasm').default;
  private readonly wasmPaths: PiperWasmPaths;
  private readonly speakerId: number;

  private constructor(
    ort: OrtRuntime,
    ortSession: OrtSession,
    modelConfig: PiperModelConfig,
    createPiperPhonemize: typeof import('@diffusionstudio/piper-wasm').default,
    wasmPaths: PiperWasmPaths,
    speakerId: number,
  ) {
    this.ort = ort;
    this.ortSession = ortSession;
    this.modelConfig = modelConfig;
    this.createPiperPhonemize = createPiperPhonemize;
    this.wasmPaths = wasmPaths;
    this.speakerId = speakerId;
  }

  static async create(options: SessionOptions) {
    if (options.voiceId !== DEFAULT_VOICE_ID) {
      throw new Error(`RallyCue unterstützt nur die feste Stimme ${DEFAULT_VOICE_ID}.`);
    }
    if (options.speakerId !== THORSTEN_EMOTIONAL_SPEAKER.id) {
      throw new Error(
        `RallyCue erwartet den neutralen Speaker ${THORSTEN_EMOTIONAL_SPEAKER.id}.`,
      );
    }

    const [ortModule, piperModule, modelFile, configFile] = await Promise.all([
      import('onnxruntime-web/wasm'),
      import('@diffusionstudio/piper-wasm'),
      readStoredVoiceFile(`${options.voiceId}.onnx`),
      readStoredVoiceFile(`${options.voiceId}.onnx.json`),
    ]);
    const ort = ortModule as unknown as OrtRuntime;
    if ('allowLocalModels' in ort.env) ort.env.allowLocalModels = false;
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated
      ? navigator.hardwareConcurrency
      : 1;
    ort.env.wasm.wasmPaths = {
      mjs: new URL(
        `${options.wasmPaths.onnxWasm}ort-wasm-simd-threaded.mjs`,
        window.location.href,
      ),
      wasm: new URL(
        `${options.wasmPaths.onnxWasm}ort-wasm-simd-threaded.wasm`,
        window.location.href,
      ),
    };

    const modelConfig = validateThorstenEmotionalModelConfig(
      JSON.parse(await configFile.text()) as unknown,
    );
    const ortSession = await ort.InferenceSession.create(
      await modelFile.arrayBuffer(),
      { executionProviders: ['wasm'] },
    );

    return new RallyCuePiperSession(
      ort,
      ortSession,
      modelConfig,
      piperModule.default,
      options.wasmPaths,
      options.speakerId,
    );
  }

  private async phonemize(text: string) {
    let resolvePhonemes!: (value: number[]) => void;
    let rejectPhonemes!: (reason: unknown) => void;
    const phonemes = new Promise<number[]>((resolve, reject) => {
      resolvePhonemes = resolve;
      rejectPhonemes = reject;
    });
    const phonemizerModule = await this.createPiperPhonemize({
      print: (data) => {
        try {
          const parsed = JSON.parse(data) as { phoneme_ids?: unknown };
          if (!Array.isArray(parsed.phoneme_ids)) {
            throw new Error('Piper-Phonemizer lieferte keine Phonem-IDs.');
          }
          resolvePhonemes(parsed.phoneme_ids.map(Number));
        } catch (error) {
          rejectPhonemes(error);
        }
      },
      printErr: rejectPhonemes,
      locateFile: (url) => {
        if (url.endsWith('.wasm')) return this.wasmPaths.piperWasm;
        if (url.endsWith('.data')) return this.wasmPaths.piperData;
        return url;
      },
    });
    phonemizerModule.callMain([
      '-l',
      this.modelConfig.espeak.voice,
      '--input',
      JSON.stringify([{ text: text.trim() }]),
      '--espeak_data',
      '/espeak-ng-data',
    ]);
    return phonemes;
  }

  private async predictChunk(text: string) {
    const phonemeIds = await this.phonemize(text);
    const feeds = {
      input: new this.ort.Tensor('int64', phonemeIds, [1, phonemeIds.length]),
      input_lengths: new this.ort.Tensor('int64', [phonemeIds.length]),
      scales: new this.ort.Tensor('float32', [
        this.modelConfig.inference.noise_scale,
        this.modelConfig.inference.length_scale * SPEECH_LENGTH_SCALE,
        this.modelConfig.inference.noise_w,
      ]),
      sid: new this.ort.Tensor('int64', [this.speakerId]),
    };
    const result = await this.ortSession.run(feeds);
    const pcm = result.output?.data;
    if (!(pcm instanceof Float32Array)) {
      throw new Error('Piper-Inferenz lieferte keine PCM-Audiodaten.');
    }
    return pcm;
  }

  async predict(text: string) {
    const chunks = splitIntoChunks(text);
    if (chunks.length === 0) throw new Error('Kein Text für die Sprachausgabe vorhanden.');

    const pcmChunks: Float32Array[] = [];
    for (const chunk of chunks) pcmChunks.push(await this.predictChunk(chunk));
    const leadingSilenceLength = leadingSilenceSampleCount(
      this.modelConfig.audio.sample_rate,
    );
    const totalLength =
      leadingSilenceLength + pcmChunks.reduce((sum, pcm) => sum + pcm.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = leadingSilenceLength;
    for (const pcm of pcmChunks) {
      merged.set(pcm, offset);
      offset += pcm.length;
    }
    return new Blob(
      [pcmToWav(merged, this.modelConfig.audio.sample_rate)],
      { type: 'audio/x-wav' },
    );
  }
}
