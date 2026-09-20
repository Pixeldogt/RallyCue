import {
  validatePronunciationDictionary,
  type PronunciationEntry,
} from './pronunciation-dictionary.ts';

export const AGE_GROUPS = ['U9', 'U11', 'U13', 'U15', 'U17', 'U19'] as const;
export const CATEGORIES = ['Jungen Einzel', 'Mädchen Einzel'] as const;

export const FIXED_VOICE = {
  id: 'de_DE-thorsten-high',
  label: 'Thorsten',
} as const;

export const LEGACY_VOICE_IDS = [
  'de_DE-thorsten-medium',
  'de_DE-thorsten_emotional-medium',
  'de_DE-karlsson-low',
  'de_DE-kerstin-low',
  'de_DE-ramona-low',
] as const;

export const SPEED_OPTIONS = [
  { id: 'slow', label: 'Langsam', rate: 0.9 },
  { id: 'standard', label: 'Standard', rate: 1 },
  { id: 'fast', label: 'Schnell', rate: 1.15 },
] as const;

export const DEFAULT_VOICE_ID = FIXED_VOICE.id;
export const DEFAULT_SPEED_ID = SPEED_OPTIONS[1].id;
export const EMPTY_AGE_GROUP = '' as const;

export type AgeGroup = (typeof AGE_GROUPS)[number];
export type Category = (typeof CATEGORIES)[number];
export type VoiceId = typeof DEFAULT_VOICE_ID;
export type SpeedId = (typeof SPEED_OPTIONS)[number]['id'];
export type SlotIndex = 0 | 1;

export type Player = {
  id: string;
  name: string;
  ageGroup: AgeGroup;
  category: Category;
};

export type Court = {
  id: number;
  players: [string | null, string | null];
};

export type RallyCueSettings = {
  voiceId: VoiceId;
  speedId: SpeedId;
};

export type TournamentState = {
  players: Player[];
  courts: Court[];
};

export type RallyCueBackup = TournamentState & {
  format: 'rallycue-backup';
  version: 1;
  exportedAt: string;
  settings?: RallyCueSettings;
  pronunciationDictionary?: PronunciationEntry[];
};

export type ValidationResult =
  | { ok: true; value: TournamentState }
  | { ok: false; error: string };

export type BackupValidationResult =
  | { ok: true; value: RallyCueBackup }
  | { ok: false; error: string };

export type AssignmentDecision =
  | { status: 'ready' }
  | { status: 'noop' }
  | { status: 'overwrite-required'; existingPlayerId: string }
  | {
      status: 'rejected';
      code: 'missing-player' | 'missing-court' | 'same-court' | 'division-mismatch';
      message: string;
    };

export type AssignmentResult = AssignmentDecision & { courts: Court[] };

const COURT_IDS = Array.from({ length: 9 }, (_, index) => index + 1);

export function createEmptyCourts(): Court[] {
  return COURT_IDS.map((id) => ({ id, players: [null, null] }));
}

export function isAgeGroup(value: unknown): value is AgeGroup {
  return typeof value === 'string' && AGE_GROUPS.includes(value as AgeGroup);
}

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && CATEGORIES.includes(value as Category);
}

export function isVoiceId(value: unknown): value is VoiceId {
  return value === DEFAULT_VOICE_ID;
}

export function migrateVoiceId(value: unknown): VoiceId | null {
  if (isVoiceId(value)) return value;
  if (
    typeof value === 'string' &&
    LEGACY_VOICE_IDS.includes(value as (typeof LEGACY_VOICE_IDS)[number])
  ) {
    return DEFAULT_VOICE_ID;
  }
  return null;
}

export function isSpeedId(value: unknown): value is SpeedId {
  return typeof value === 'string' && SPEED_OPTIONS.some((speed) => speed.id === value);
}

export function divisionOf(player: Player) {
  return `${player.category} ${player.ageGroup}`;
}

export function speedRate(speedId: SpeedId) {
  return SPEED_OPTIONS.find((speed) => speed.id === speedId)?.rate ?? 1;
}

export function isPlayerDraftValid(
  name: unknown,
  ageGroup: unknown,
  category: unknown,
) {
  return (
    typeof name === 'string' &&
    Boolean(name.trim()) &&
    isAgeGroup(ageGroup) &&
    isCategory(category)
  );
}

export function clearCourt(courts: Court[], courtId: number): Court[] {
  return courts.map((court) =>
    court.id === courtId ? { ...court, players: [null, null] } : court,
  );
}

export function evaluateAssignment(
  players: Player[],
  courts: Court[],
  playerId: string,
  courtId: number,
  slotIndex: SlotIndex,
  allowOverwrite = false,
): AssignmentDecision {
  const player = players.find((item) => item.id === playerId);
  if (!player) {
    return {
      status: 'rejected',
      code: 'missing-player',
      message: 'Der ausgewählte Spieler ist nicht mehr vorhanden.',
    };
  }

  const targetCourt = courts.find((court) => court.id === courtId);
  if (!targetCourt) {
    return {
      status: 'rejected',
      code: 'missing-court',
      message: 'Das ausgewählte Feld ist nicht vorhanden.',
    };
  }

  if (targetCourt.players[slotIndex] === playerId) return { status: 'noop' };

  const otherSlot = slotIndex === 0 ? 1 : 0;
  if (targetCourt.players[otherSlot] === playerId) {
    return {
      status: 'rejected',
      code: 'same-court',
      message: `${player.name} ist bereits auf Feld ${courtId}.`,
    };
  }

  const opponentId = targetCourt.players[otherSlot];
  const opponent = opponentId ? players.find((item) => item.id === opponentId) : null;
  if (opponent && divisionOf(opponent) !== divisionOf(player)) {
    return {
      status: 'rejected',
      code: 'division-mismatch',
      message: `${divisionOf(player)} passt nicht zu ${divisionOf(opponent)}.`,
    };
  }

  const existingPlayerId = targetCourt.players[slotIndex];
  if (existingPlayerId && existingPlayerId !== playerId && !allowOverwrite) {
    return { status: 'overwrite-required', existingPlayerId };
  }

  return { status: 'ready' };
}

export function assignPlayerToCourt(
  players: Player[],
  courts: Court[],
  playerId: string,
  courtId: number,
  slotIndex: SlotIndex,
  allowOverwrite = false,
): AssignmentResult {
  const decision = evaluateAssignment(
    players,
    courts,
    playerId,
    courtId,
    slotIndex,
    allowOverwrite,
  );

  if (decision.status !== 'ready') return { ...decision, courts };

  const nextCourts = courts.map((court) => {
    const withoutPlayer = court.players.map((id) =>
      id === playerId ? null : id,
    ) as Court['players'];

    if (court.id !== courtId) return { ...court, players: withoutPlayer };

    const nextPlayers = [...withoutPlayer] as Court['players'];
    nextPlayers[slotIndex] = playerId;
    return { ...court, players: nextPlayers };
  });

  return { status: 'ready', courts: nextCourts };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateTournamentState(
  playersInput: unknown,
  courtsInput: unknown,
): ValidationResult {
  if (!Array.isArray(playersInput)) {
    return { ok: false, error: 'Die Spielerliste fehlt oder ist ungültig.' };
  }
  if (!Array.isArray(courtsInput)) {
    return { ok: false, error: 'Die Feldliste fehlt oder ist ungültig.' };
  }

  const players: Player[] = [];
  const playerIds = new Set<string>();
  for (const item of playersInput) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      !isAgeGroup(item.ageGroup) ||
      !isCategory(item.category)
    ) {
      return { ok: false, error: 'Mindestens ein Spieler ist unvollständig oder ungültig.' };
    }
    if (playerIds.has(item.id)) {
      return { ok: false, error: `Die Spieler-ID ${item.id} kommt mehrfach vor.` };
    }
    playerIds.add(item.id);
    players.push({
      id: item.id,
      name: item.name,
      ageGroup: item.ageGroup,
      category: item.category,
    });
  }

  if (courtsInput.length !== COURT_IDS.length) {
    return { ok: false, error: 'Eine Sicherung muss genau neun Felder enthalten.' };
  }

  const courts: Court[] = [];
  const courtIds = new Set<number>();
  const assignedPlayers = new Set<string>();

  for (const item of courtsInput) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'number' ||
      !Number.isInteger(item.id) ||
      !COURT_IDS.includes(item.id) ||
      !Array.isArray(item.players) ||
      item.players.length !== 2
    ) {
      return { ok: false, error: 'Mindestens ein Feld besitzt eine ungültige Struktur.' };
    }
    if (courtIds.has(item.id)) {
      return { ok: false, error: `Feld ${item.id} kommt mehrfach vor.` };
    }
    courtIds.add(item.id);

    const slots: [string | null, string | null] = [null, null];
    for (const index of [0, 1] as const) {
      const value = item.players[index];
      if (value !== null && typeof value !== 'string') {
        return { ok: false, error: `Feld ${item.id} enthält einen ungültigen Spielerplatz.` };
      }
      if (typeof value === 'string') {
        if (!playerIds.has(value)) {
          return { ok: false, error: `Feld ${item.id} verweist auf einen unbekannten Spieler.` };
        }
        if (index === 1 && slots[0] === value) {
          return { ok: false, error: `Auf Feld ${item.id} würde ein Spieler gegen sich selbst antreten.` };
        }
        if (assignedPlayers.has(value)) {
          return { ok: false, error: 'Ein Spieler ist gleichzeitig mehrfach Feldern zugewiesen.' };
        }
        assignedPlayers.add(value);
        slots[index] = value;
      }
    }

    if (slots[0] && slots[0] === slots[1]) {
      return { ok: false, error: `Auf Feld ${item.id} würde ein Spieler gegen sich selbst antreten.` };
    }

    if (slots[0] && slots[1]) {
      const first = players.find((player) => player.id === slots[0]);
      const second = players.find((player) => player.id === slots[1]);
      if (!first || !second || divisionOf(first) !== divisionOf(second)) {
        return { ok: false, error: `Feld ${item.id} enthält Spieler aus unterschiedlichen Divisionen.` };
      }
    }

    courts.push({ id: item.id, players: slots });
  }

  if (COURT_IDS.some((id) => !courtIds.has(id))) {
    return { ok: false, error: 'Die Feldnummern 1 bis 9 müssen jeweils genau einmal vorhanden sein.' };
  }

  courts.sort((a, b) => a.id - b.id);
  return { ok: true, value: { players, courts } };
}

export function createBackup(
  players: Player[],
  courts: Court[],
  settings?: RallyCueSettings,
  pronunciationDictionary: PronunciationEntry[] = [],
  exportedAt = new Date().toISOString(),
): RallyCueBackup {
  const state = validateTournamentState(players, courts);
  if (!state.ok) throw new Error(state.error);

  const voiceId = settings ? migrateVoiceId(settings.voiceId) : null;
  if (settings && (!voiceId || !isSpeedId(settings.speedId))) {
    throw new Error('Die Ansage-Einstellungen sind ungültig.');
  }
  const validatedPronunciations = validatePronunciationDictionary(pronunciationDictionary);
  if (!validatedPronunciations.ok) throw new Error(validatedPronunciations.error);

  return {
    format: 'rallycue-backup',
    version: 1,
    exportedAt,
    players: state.value.players,
    courts: state.value.courts,
    ...(settings ? { settings: { voiceId: voiceId!, speedId: settings.speedId } } : {}),
    pronunciationDictionary: validatedPronunciations.value,
  };
}

export function parseBackup(input: unknown): BackupValidationResult {
  let parsed = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      return { ok: false, error: 'Die Datei enthält kein gültiges JSON.' };
    }
  }

  if (!isRecord(parsed) || parsed.format !== 'rallycue-backup' || parsed.version !== 1) {
    return { ok: false, error: 'Die Datei ist keine unterstützte RallyCue-Sicherung.' };
  }
  if (typeof parsed.exportedAt !== 'string' || !parsed.exportedAt.trim()) {
    return { ok: false, error: 'Der Exportzeitpunkt der Sicherung fehlt.' };
  }

  const state = validateTournamentState(parsed.players, parsed.courts);
  if (!state.ok) return state;

  let settings: RallyCueSettings | undefined;
  if (parsed.settings !== undefined) {
    const voiceId = isRecord(parsed.settings)
      ? migrateVoiceId(parsed.settings.voiceId)
      : null;
    if (
      !isRecord(parsed.settings) ||
      !voiceId ||
      !isSpeedId(parsed.settings.speedId)
    ) {
      return { ok: false, error: 'Die Ansage-Einstellungen der Sicherung sind ungültig.' };
    }
    settings = {
      voiceId,
      speedId: parsed.settings.speedId,
    };
  }

  const pronunciationDictionary = parsed.pronunciationDictionary === undefined
    ? { ok: true as const, value: [] as PronunciationEntry[] }
    : validatePronunciationDictionary(parsed.pronunciationDictionary);
  if (!pronunciationDictionary.ok) return pronunciationDictionary;

  return {
    ok: true,
    value: {
      format: 'rallycue-backup',
      version: 1,
      exportedAt: parsed.exportedAt,
      players: state.value.players,
      courts: state.value.courts,
      ...(settings ? { settings } : {}),
      pronunciationDictionary: pronunciationDictionary.value,
    },
  };
}
