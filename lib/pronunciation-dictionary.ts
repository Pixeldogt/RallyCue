export type PronunciationEntry = {
  source: string;
  replacement: string;
};

export const BUILTIN_PRONUNCIATION_DICTIONARY = [
  { source: 'Marcel', replacement: 'Marsell' },
  { source: 'Abby', replacement: 'Äbbi' },
  { source: 'George', replacement: 'Dschordsch' },
  { source: 'Jaden', replacement: 'Dscheiden' },
  { source: 'Bazhenova', replacement: 'Baschenowa' },
  { source: 'Bashir', replacement: 'Baschiir' },
  { source: 'Fakhro', replacement: 'Fachro' },
  { source: 'Younis', replacement: 'Junus' },
  { source: 'Matyas', replacement: 'Maatjaasch' },
  { source: 'Geanta', replacement: 'Dscheanta' },
  { source: 'Nikhilesh', replacement: 'Nikhilesch' },
  { source: 'Srushti', replacement: 'Sruschti' },
  { source: 'Aavish', replacement: 'Aawisch' },
  { source: 'Nayee', replacement: 'Naai' },
  { source: 'Yuvan', replacement: 'Juwan' },
  { source: 'Uthpala', replacement: 'Utpala' },
  { source: 'Ekanayake', replacement: 'Eikenaiake' },
  { source: 'Pathirajar', replacement: 'Patiradschar' },
  { source: 'Nguyen', replacement: 'Ngwien' },
  { source: 'Hoang', replacement: 'Hwang' },
  { source: 'Rosicki', replacement: 'Rositzki' },
  { source: 'Savucu', replacement: 'Savudschu' },
  { source: 'Yezda', replacement: 'Jesda' },
  { source: 'Xheka', replacement: 'Dscheka' },
  { source: 'Zheng', replacement: 'Dscheng' },
  { source: 'Zhu', replacement: 'Dschu' },
] as const satisfies readonly PronunciationEntry[];

export const MAX_PRONUNCIATION_SOURCE_LENGTH = 100;
export const MAX_PRONUNCIATION_REPLACEMENT_LENGTH = 160;

export type PronunciationValidationResult =
  | { ok: true; value: PronunciationEntry[] }
  | { ok: false; error: string };

export function normalizePronunciationText(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function pronunciationSourceKey(value: string) {
  return normalizePronunciationText(value).toLocaleLowerCase('de-DE');
}

export function validatePronunciationDictionary(
  input: unknown,
): PronunciationValidationResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: 'Das Aussprachewörterbuch muss eine Liste sein.' };
  }

  const entries: PronunciationEntry[] = [];
  const sourceKeys = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { ok: false, error: 'Mindestens ein Ausspracheeintrag ist ungültig.' };
    }

    const sourceValue = (item as Record<string, unknown>).source;
    const replacementValue = (item as Record<string, unknown>).replacement;
    if (typeof sourceValue !== 'string' || typeof replacementValue !== 'string') {
      return { ok: false, error: 'Original und Aussprache müssen Text sein.' };
    }

    const source = normalizePronunciationText(sourceValue);
    const replacement = normalizePronunciationText(replacementValue);
    if (!source || !replacement) {
      return { ok: false, error: 'Original und Aussprache dürfen nicht leer sein.' };
    }
    if (source.length > MAX_PRONUNCIATION_SOURCE_LENGTH) {
      return { ok: false, error: 'Ein Original ist zu lang.' };
    }
    if (replacement.length > MAX_PRONUNCIATION_REPLACEMENT_LENGTH) {
      return { ok: false, error: 'Eine Aussprache ist zu lang.' };
    }

    const sourceKey = pronunciationSourceKey(source);
    if (sourceKeys.has(sourceKey)) {
      return { ok: false, error: `Der Eintrag „${source}“ ist mehrfach vorhanden.` };
    }
    sourceKeys.add(sourceKey);
    entries.push({ source, replacement });
  }

  return { ok: true, value: entries };
}

export function mergePronunciationDictionaries(
  customEntries: readonly PronunciationEntry[],
): PronunciationEntry[] {
  const merged = new Map<string, PronunciationEntry>();
  for (const entry of BUILTIN_PRONUNCIATION_DICTIONARY) {
    merged.set(pronunciationSourceKey(entry.source), { ...entry });
  }
  for (const entry of customEntries) {
    merged.set(pronunciationSourceKey(entry.source), { ...entry });
  }

  return [...merged.values()].sort(
    (left, right) =>
      [...right.source].length - [...left.source].length ||
      left.source.localeCompare(right.source, 'de', { sensitivity: 'base' }),
  );
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function entryPattern(source: string) {
  return normalizePronunciationText(source)
    .split(' ')
    .map(escapeRegularExpression)
    .join('\\s+');
}

export function applyPronunciationDictionary(
  text: string,
  entries: readonly PronunciationEntry[],
) {
  if (!text || entries.length === 0) return text;

  const sortedEntries = [...entries].sort(
    (left, right) => [...right.source].length - [...left.source].length,
  );
  const replacements = new Map(
    sortedEntries.map((entry) => [pronunciationSourceKey(entry.source), entry.replacement]),
  );
  const alternatives = sortedEntries.map((entry) => entryPattern(entry.source));
  const matcher = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{M}\\p{N}])`,
    'giu',
  );

  return text.replace(matcher, (match) =>
    replacements.get(pronunciationSourceKey(match)) ?? match,
  );
}
