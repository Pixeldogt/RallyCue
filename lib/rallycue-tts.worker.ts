/// <reference lib="webworker" />

import {
  RallyCuePiperSession,
  type RallyCuePiperSessionOptions,
} from './rallycue-piper-session';

type WorkerRequest =
  | { id: number; type: 'initialize'; options: RallyCuePiperSessionOptions }
  | { id: number; type: 'predict'; text: string };

type WorkerResponse =
  | { id: number; ok: true; audio?: Blob }
  | { id: number; ok: false; error: string };

let session: RallyCuePiperSession | null = null;

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'initialize') {
      session = await RallyCuePiperSession.create(request.options);
      self.postMessage({ id: request.id, ok: true } satisfies WorkerResponse);
      return;
    }

    if (!session) throw new Error('Piper wurde noch nicht initialisiert.');
    const audio = await session.predict(request.text);
    self.postMessage({ id: request.id, ok: true, audio } satisfies WorkerResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ id: request.id, ok: false, error: message } satisfies WorkerResponse);
  }
});
