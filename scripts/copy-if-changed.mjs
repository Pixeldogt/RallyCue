import { copyFile, readFile, unlink } from 'node:fs/promises';

const RETRY_DELAYS_MS = [50, 100, 200, 400, 800];
const RETRYABLE_ERROR_CODES = new Set(['EACCES', 'EPERM']);

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function copyWithRetry(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await unlink(destination).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await copyFile(source, destination);
      return;
    } catch (error) {
      const retryDelay = RETRY_DELAYS_MS[attempt];
      if (!RETRYABLE_ERROR_CODES.has(error.code) || retryDelay === undefined) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Could not update generated asset "${destination}" after ${attempt + 1} attempts: ${reason}`,
          { cause: error },
        );
      }
      await wait(retryDelay);
    }
  }
}

export async function copyIfChanged(source, destination) {
  const sourceContents = await readFile(source);
  let destinationContents;

  try {
    destinationContents = await readFile(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (destinationContents?.equals(sourceContents)) return 'unchanged';

  await copyWithRetry(source, destination);
  return destinationContents ? 'updated' : 'copied';
}
