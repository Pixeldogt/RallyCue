import type { RallyCuePiperSessionOptions } from './rallycue-piper-session';

type WorkerRequest =
  | { id: number; type: 'initialize'; options: RallyCuePiperSessionOptions }
  | { id: number; type: 'predict'; text: string };

type WorkerResponse =
  | { id: number; ok: true; audio?: Blob }
  | { id: number; ok: false; error: string };

type PendingRequest = {
  resolve: (audio?: Blob) => void;
  reject: (error: Error) => void;
};

export type RallyCueTtsWorkerSession = {
  predict: (text: string) => Promise<Blob>;
  dispose: () => void;
};

export async function createRallyCueTtsWorkerSession(
  options: RallyCuePiperSessionOptions,
): Promise<RallyCueTtsWorkerSession> {
  const worker = new Worker(new URL('./rallycue-tts.worker.ts', import.meta.url), {
    name: 'rallycue-tts',
    type: 'module',
  });
  const pending = new Map<number, PendingRequest>();
  let requestId = 0;
  let disposed = false;

  const rejectPending = (message: string) => {
    for (const request of pending.values()) request.reject(new Error(message));
    pending.clear();
  };

  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) request.resolve(response.audio);
    else request.reject(new Error(response.error));
  });
  worker.addEventListener('error', (event) => {
    rejectPending(event.message || 'Der Sprach-Worker wurde unerwartet beendet.');
  });

  const send = (
    message:
      | Omit<Extract<WorkerRequest, { type: 'initialize' }>, 'id'>
      | Omit<Extract<WorkerRequest, { type: 'predict' }>, 'id'>,
  ) => {
    if (disposed) return Promise.reject(new Error('Der Sprach-Worker wurde beendet.'));
    const id = ++requestId;
    return new Promise<Blob | undefined>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id });
    });
  };

  try {
    await send({ type: 'initialize', options });
  } catch (error) {
    disposed = true;
    worker.terminate();
    rejectPending('Der Sprach-Worker konnte nicht initialisiert werden.');
    throw error;
  }

  return {
    async predict(text) {
      const audio = await send({ type: 'predict', text });
      if (!(audio instanceof Blob)) throw new Error('Der Sprach-Worker lieferte keine Audiodatei.');
      return audio;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.terminate();
      rejectPending('Der Sprach-Worker wurde beendet.');
    },
  };
}
