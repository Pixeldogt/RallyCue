'use client';

import {
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Image from 'next/image';
import {
  applyPronunciationDictionary,
  MAX_PRONUNCIATION_REPLACEMENT_LENGTH,
  MAX_PRONUNCIATION_SOURCE_LENGTH,
  mergePronunciationDictionaries,
  validatePronunciationDictionary,
  type PronunciationEntry,
} from '@/lib/pronunciation-dictionary';
import {
  AGE_GROUPS,
  CATEGORIES,
  DEFAULT_SPEED_ID,
  DEFAULT_VOICE_ID,
  EMPTY_AGE_GROUP,
  FIXED_VOICE,
  SPEED_OPTIONS,
  assignPlayerToCourt,
  clearCourt,
  createBackup,
  createEmptyCourts,
  divisionOf,
  evaluateAssignment,
  isPlayerDraftValid,
  isSpeedId,
  parseBackup,
  speedRate,
  validateTournamentState,
  type AgeGroup,
  type Category,
  type Court,
  type Player,
  type SlotIndex,
  type SpeedId,
  type VoiceId,
} from '@/lib/rallycue-core';

type LocalTtsSession = {
  predict: (text: string) => Promise<Blob>;
};

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type PendingOverwrite = {
  playerId: string;
  courtId: number;
  slotIndex: SlotIndex;
  existingPlayerId: string;
};

type SelectedTarget = {
  courtId: number;
  slotIndex: SlotIndex;
};

type VoicePreparationOptions = {
  allowDownload: boolean;
  silent: boolean;
  background: boolean;
};

const PLAYER_STORAGE_KEY = 'rallycue.players.v1';
const COURT_STORAGE_KEY = 'rallycue.courts.v1';
const LEGACY_PLAYER_STORAGE_KEY = 'courtcall.players.v1';
const LEGACY_COURT_STORAGE_KEY = 'courtcall.courts.v1';
const VOICE_STORAGE_KEY = 'rallycue.voice.v1';
const SPEED_STORAGE_KEY = 'rallycue.speed.v1';
const PRONUNCIATION_STORAGE_KEY = 'rallycue.pronunciation.v1';
const PLAYER_DRAG_TYPE = 'text/rallycue-player';
const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const PWA_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PWA === 'true';
const LOCAL_WASM_PATHS = {
  onnxWasm: `${APP_BASE_PATH}/onnx/`,
  piperData: `${APP_BASE_PATH}/piper/piper_phonemize.data`,
  piperWasm: `${APP_BASE_PATH}/piper/piper_phonemize.wasm`,
};
const TEST_ANNOUNCEMENT =
  'Testansage. Es spielen auf Feld vier Max Mustermann gegen Bernd Beispiel.';
const VOICE_RETRY_DELAYS_MS = [50, 100, 200, 400, 800];

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function sortPlayers(players: Player[]) {
  return [...players].sort((a, b) =>
    a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }),
  );
}

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [courts, setCourts] = useState<Court[]>(() => createEmptyCourts());
  const [hydrated, setHydrated] = useState(false);
  const [canPersist, setCanPersist] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('Alle');
  const [categoryFilter, setCategoryFilter] = useState('Alle');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget | null>(null);
  const [draggedPlayerId, setDraggedPlayerId] = useState<string | null>(null);
  const [isPlayerDialogOpen, setPlayerDialogOpen] = useState(false);
  const [isAnnouncementDialogOpen, setAnnouncementDialogOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [formName, setFormName] = useState('');
  const [formAgeGroup, setFormAgeGroup] = useState<AgeGroup | ''>(EMPTY_AGE_GROUP);
  const [formCategory, setFormCategory] = useState<Category>('Jungen Einzel');
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingOverwrite, setPendingOverwrite] = useState<PendingOverwrite | null>(null);
  const [pendingClearCourtId, setPendingClearCourtId] = useState<number | null>(null);
  const [customPronunciations, setCustomPronunciations] = useState<PronunciationEntry[]>([]);
  const [isPronunciationDialogOpen, setPronunciationDialogOpen] = useState(false);
  const [isPronunciationEditorOpen, setPronunciationEditorOpen] = useState(false);
  const [editingPronunciationIndex, setEditingPronunciationIndex] = useState<number | null>(null);
  const [pronunciationSource, setPronunciationSource] = useState('');
  const [pronunciationReplacement, setPronunciationReplacement] = useState('');
  const [pronunciationError, setPronunciationError] = useState<string | null>(null);
  const [selectedSpeedId, setSelectedSpeedId] = useState<SpeedId>(DEFAULT_SPEED_ID);
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Stimme prüfen …');
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const ttsSessionRef = useRef<LocalTtsSession | null>(null);
  const sessionVoiceRef = useRef<VoiceId | null>(null);
  const voicePreparationRef = useRef<Promise<boolean> | null>(null);

  const playerById = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );

  const assignmentByPlayer = useMemo(() => {
    const assignments = new Map<string, number>();
    courts.forEach((court) => {
      court.players.forEach((playerId) => {
        if (playerId) assignments.set(playerId, court.id);
      });
    });
    return assignments;
  }, [courts]);

  const visiblePlayers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('de');
    return sortPlayers(
      players.filter((player) => {
        const matchesFilter = filter === 'Alle' || player.ageGroup === filter;
        const matchesCategory =
          categoryFilter === 'Alle' || player.category.startsWith(categoryFilter);
        const matchesSearch =
          !term ||
          player.name.toLocaleLowerCase('de').includes(term) ||
          divisionOf(player).toLocaleLowerCase('de').includes(term);
        return matchesFilter && matchesCategory && matchesSearch;
      }),
    );
  }, [categoryFilter, filter, players, search]);

  const playerGroups = useMemo(() => {
    const groups = new Map<string, Player[]>();
    visiblePlayers.forEach((player) => {
      const key = `${player.ageGroup}|${player.category}`;
      const current = groups.get(key) ?? [];
      current.push(player);
      groups.set(key, current);
    });
    return AGE_GROUPS.flatMap((ageGroup) =>
      CATEGORIES.map((category) => ({
        key: `${ageGroup}|${category}`,
        ageGroup,
        category,
        players: groups.get(`${ageGroup}|${category}`) ?? [],
      })).filter((group) => group.players.length > 0),
    );
  }, [visiblePlayers]);

  const interactionPlayerId = draggedPlayerId ?? selectedPlayerId;
  const mergedPronunciationDictionary = useMemo(
    () => mergePronunciationDictionaries(customPronunciations),
    [customPronunciations],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedSpeedId = localStorage.getItem(SPEED_STORAGE_KEY);
        if (isSpeedId(storedSpeedId)) setSelectedSpeedId(storedSpeedId);

        const savedPlayersRaw =
          localStorage.getItem(PLAYER_STORAGE_KEY) ??
          localStorage.getItem(LEGACY_PLAYER_STORAGE_KEY);
        const savedCourtsRaw =
          localStorage.getItem(COURT_STORAGE_KEY) ??
          localStorage.getItem(LEGACY_COURT_STORAGE_KEY);
        const savedPronunciationsRaw = localStorage.getItem(PRONUNCIATION_STORAGE_KEY);

        const savedPlayers = savedPlayersRaw ? JSON.parse(savedPlayersRaw) : [];
        const savedCourts = savedCourtsRaw
          ? JSON.parse(savedCourtsRaw)
          : createEmptyCourts();
        const validated = validateTournamentState(savedPlayers, savedCourts);
        if (!validated.ok) throw new Error(validated.error);
        const validatedPronunciations = validatePronunciationDictionary(
          savedPronunciationsRaw ? JSON.parse(savedPronunciationsRaw) : [],
        );
        if (!validatedPronunciations.ok) throw new Error(validatedPronunciations.error);

        setPlayers(validated.value.players);
        setCourts(validated.value.courts);
        setCustomPronunciations(validatedPronunciations.value);
        setCanPersist(true);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unbekannter Fehler';
        setCanPersist(false);
        setStorageWarning(
          `Gespeicherte Turnierdaten sind beschädigt und wurden nicht überschrieben. ${detail}`,
        );
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated || !canPersist) return;
    try {
      localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(players));
      localStorage.setItem(COURT_STORAGE_KEY, JSON.stringify(courts));
      localStorage.setItem(
        PRONUNCIATION_STORAGE_KEY,
        JSON.stringify(customPronunciations),
      );
    } catch {
      window.setTimeout(() => {
        setCanPersist(false);
        setStorageWarning(
          'Turnierdaten konnten nicht lokal gespeichert werden. Bitte eine Sicherung erstellen.',
        );
      }, 0);
    }
  }, [canPersist, courts, customPronunciations, hydrated, players]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(VOICE_STORAGE_KEY, DEFAULT_VOICE_ID);
      localStorage.setItem(SPEED_STORAGE_KEY, selectedSpeedId);
    } catch {
      // Tournament data remains usable even if these optional settings cannot be saved.
    }
  }, [hydrated, selectedSpeedId]);

  useEffect(() => {
    if (!PWA_ENABLED) return;

    const standaloneTimer = window.setTimeout(() => {
      const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
      setIsStandalone(
        window.matchMedia('(display-mode: standalone)').matches ||
          standaloneNavigator.standalone === true,
      );
    }, 0);

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .register(`${APP_BASE_PATH}/sw.js`)
        .catch((error) => console.error('Service Worker konnte nicht registriert werden.', error));
    }

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.clearTimeout(standaloneTimer);
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlayerDialogOpen(false);
        setAnnouncementDialogOpen(false);
        setSelectedPlayerId(null);
        setSelectedTarget(null);
        setPendingClearCourtId(null);
        setPronunciationDialogOpen(false);
        setPronunciationEditorOpen(false);
        setEditingPronunciationIndex(null);
        setPronunciationError(null);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4200);
  }

  function resetPronunciationEditor() {
    setPronunciationEditorOpen(false);
    setEditingPronunciationIndex(null);
    setPronunciationSource('');
    setPronunciationReplacement('');
    setPronunciationError(null);
  }

  function openPronunciationDictionary() {
    setAnnouncementDialogOpen(false);
    resetPronunciationEditor();
    setPronunciationDialogOpen(true);
  }

  function closePronunciationDictionary() {
    setPronunciationDialogOpen(false);
    resetPronunciationEditor();
  }

  function startPronunciationEntry(index: number | null) {
    const entry = index === null ? null : customPronunciations[index];
    setEditingPronunciationIndex(index);
    setPronunciationSource(entry?.source ?? '');
    setPronunciationReplacement(entry?.replacement ?? '');
    setPronunciationError(null);
    setPronunciationEditorOpen(true);
  }

  function savePronunciationEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = { source: pronunciationSource, replacement: pronunciationReplacement };
    const nextEntries = [...customPronunciations];
    if (editingPronunciationIndex === null) nextEntries.push(candidate);
    else nextEntries[editingPronunciationIndex] = candidate;

    const validated = validatePronunciationDictionary(nextEntries);
    if (!validated.ok) {
      setPronunciationError(validated.error);
      return;
    }

    setCustomPronunciations(validated.value);
    resetPronunciationEditor();
    showNotice('Aussprache wurde gespeichert.');
  }

  function deletePronunciationEntry(index: number) {
    setCustomPronunciations((current) => current.filter((_, itemIndex) => itemIndex !== index));
    if (editingPronunciationIndex === index) resetPronunciationEditor();
    showNotice('Aussprache wurde gelöscht.');
  }

  function openNewPlayerDialog() {
    setEditingPlayer(null);
    setFormName('');
    setFormAgeGroup(EMPTY_AGE_GROUP);
    setFormCategory('Jungen Einzel');
    setPlayerDialogOpen(true);
  }

  function openEditPlayerDialog(player: Player) {
    setEditingPlayer(player);
    setFormName(player.name);
    setFormAgeGroup(player.ageGroup);
    setFormCategory(player.category);
    setPlayerDialogOpen(true);
  }

  function savePlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = formName.trim().replace(/\s+/g, ' ');
    if (!isPlayerDraftValid(name, formAgeGroup, formCategory)) {
      showNotice('Bitte Name, Altersklasse und Disziplin vollständig auswählen.');
      return;
    }
    const ageGroup = formAgeGroup as AgeGroup;

    if (editingPlayer) {
      setPlayers((current) =>
        current.map((player) =>
          player.id === editingPlayer.id
            ? { ...player, name, ageGroup, category: formCategory }
            : player,
        ),
      );
      showNotice(`${name} wurde aktualisiert.`);
    } else {
      const player: Player = {
        id: crypto.randomUUID(),
        name,
        ageGroup,
        category: formCategory,
      };
      setPlayers((current) => sortPlayers([...current, player]));
      showNotice(`${name} wurde angelegt.`);
    }
    setPlayerDialogOpen(false);
  }

  function deletePlayer() {
    if (!editingPlayer) return;
    if (!window.confirm(`${editingPlayer.name} wirklich löschen?`)) return;
    setPlayers((current) => current.filter((player) => player.id !== editingPlayer.id));
    setCourts((current) =>
      current.map((court) => ({
        ...court,
        players: court.players.map((id) =>
          id === editingPlayer.id ? null : id,
        ) as Court['players'],
      })),
    );
    setSelectedPlayerId((current) => (current === editingPlayer.id ? null : current));
    setPlayerDialogOpen(false);
    showNotice(`${editingPlayer.name} wurde gelöscht.`);
  }

  function clearAssignmentSelection() {
    setSelectedPlayerId(null);
    setSelectedTarget(null);
  }

  function assignPlayer(
    playerId: string,
    courtId: number,
    slotIndex: SlotIndex,
    allowOverwrite = false,
  ) {
    const result = assignPlayerToCourt(
      players,
      courts,
      playerId,
      courtId,
      slotIndex,
      allowOverwrite,
    );

    if (result.status === 'rejected') {
      showNotice(result.message);
      return result.status;
    }
    if (result.status === 'overwrite-required') {
      setPendingOverwrite({
        playerId,
        courtId,
        slotIndex,
        existingPlayerId: result.existingPlayerId,
      });
      return result.status;
    }
    if (result.status === 'ready') setCourts(result.courts);

    clearAssignmentSelection();
    setPendingOverwrite(null);
    return result.status;
  }

  function commitAssignment(playerId: string, courtId: number, slotIndex: SlotIndex) {
    assignPlayer(playerId, courtId, slotIndex, true);
  }

  function handlePlayerSelection(playerId: string) {
    if (selectedTarget) {
      assignPlayer(playerId, selectedTarget.courtId, selectedTarget.slotIndex);
      return;
    }
    setSelectedTarget(null);
    setSelectedPlayerId((current) => (current === playerId ? null : playerId));
  }

  function handleSlotClick(courtId: number, slotIndex: SlotIndex, occupied: boolean) {
    if (selectedPlayerId) {
      assignPlayer(selectedPlayerId, courtId, slotIndex);
      return;
    }
    if (occupied) return;
    setSelectedPlayerId(null);
    setSelectedTarget({ courtId, slotIndex });
  }

  function handleDrop(event: ReactDragEvent, courtId: number, slotIndex: SlotIndex) {
    event.preventDefault();
    const playerId = event.dataTransfer.getData(PLAYER_DRAG_TYPE);
    if (playerId) assignPlayer(playerId, courtId, slotIndex);
    setDraggedPlayerId(null);
  }

  function removeFromCourt(courtId: number, slotIndex: SlotIndex) {
    setCourts((current) =>
      current.map((court) => {
        if (court.id !== courtId) return court;
        const nextPlayers = [...court.players] as Court['players'];
        nextPlayers[slotIndex] = null;
        return { ...court, players: nextPlayers };
      }),
    );
    setSelectedTarget((current) =>
      current?.courtId === courtId && current.slotIndex === slotIndex ? null : current,
    );
  }

  function confirmClearCourt() {
    if (pendingClearCourtId === null) return;
    const courtId = pendingClearCourtId;
    setCourts((current) => clearCourt(current, courtId));
    setSelectedTarget((current) => (current?.courtId === courtId ? null : current));
    setPendingOverwrite((current) => (current?.courtId === courtId ? null : current));
    setPendingClearCourtId(null);
    showNotice(`Feld ${courtId} wurde geleert.`);
  }

  function stopCurrentAudio() {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }

  function handleSpeedChange(speedId: SpeedId) {
    stopCurrentAudio();
    setVoiceBusy(false);
    setSelectedSpeedId(speedId);
  }

  async function waitForStoredVoice(
    tts: typeof import('@mintplex-labs/piper-tts-web'),
  ) {
    for (let attempt = 0; ; attempt += 1) {
      if ((await tts.stored()).includes(DEFAULT_VOICE_ID)) return;
      const delay = VOICE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        throw new Error('Thorsten ist nach dem Download nicht im OPFS verfügbar.');
      }
      await wait(delay);
    }
  }

  async function createVoiceSession(
    tts: typeof import('@mintplex-labs/piper-tts-web'),
    retryAfterDownload: boolean,
  ) {
    const retryDelays = retryAfterDownload ? VOICE_RETRY_DELAYS_MS : [];
    for (let attempt = 0; ; attempt += 1) {
      try {
        tts.TtsSession._instance = null;
        return await tts.TtsSession.create({
          voiceId: DEFAULT_VOICE_ID,
          wasmPaths: LOCAL_WASM_PATHS,
        });
      } catch (error) {
        console.error(`Piper-Initialisierung fehlgeschlagen (Versuch ${attempt + 1}).`, error);
        const delay = retryDelays[attempt];
        if (delay === undefined) throw error;
        await wait(delay);
      }
    }
  }

  async function prepareVoice(options: VoicePreparationOptions) {
    if (ttsSessionRef.current && sessionVoiceRef.current === DEFAULT_VOICE_ID) return true;
    if (voicePreparationRef.current) return voicePreparationRef.current;

    const preparation = (async () => {
      setVoiceBusy(true);
      setVoiceStatus(options.background ? 'Stimme wird vorbereitet …' : 'Stimme wird geladen …');
      let phase: 'check' | 'download' | 'verify' | 'initialize' = 'check';
      let modelStored = false;
      try {
        const tts = await import('@mintplex-labs/piper-tts-web');
        const storedVoices = await tts.stored();
        modelStored = storedVoices.includes(DEFAULT_VOICE_ID);
        if (!modelStored && !options.allowDownload) {
          setVoiceReady(false);
          setVoiceStatus('Download erforderlich');
          return false;
        }

        const downloadedNow = !modelStored;
        if (downloadedNow) {
          phase = 'download';
          await tts.download(DEFAULT_VOICE_ID, (progress) => {
            const percent = progress.total
              ? Math.round((progress.loaded / progress.total) * 100)
              : 0;
            setVoiceStatus(percent ? `Stimme laden · ${percent} %` : 'Stimme wird geladen …');
          });
          phase = 'verify';
          setVoiceStatus('Stimme wird gespeichert …');
          await waitForStoredVoice(tts);
          modelStored = true;
        }
        phase = 'initialize';
        setVoiceStatus(options.background ? 'Stimme wird vorbereitet …' : 'Stimme wird initialisiert …');
        ttsSessionRef.current = await createVoiceSession(tts, downloadedNow);
        sessionVoiceRef.current = DEFAULT_VOICE_ID;
        setVoiceReady(true);
        setVoiceStatus('Stimme bereit');
        return true;
      } catch (error) {
        console.error(`Thorsten konnte in Phase "${phase}" nicht vorbereitet werden.`, error);
        ttsSessionRef.current = null;
        sessionVoiceRef.current = null;
        setVoiceReady(false);
        setVoiceStatus(modelStored ? 'Stimme lokal verfügbar' : 'Stimme nicht verfügbar');
        if (!options.silent) {
          showNotice(
            phase === 'download'
              ? 'Die Stimme konnte nicht heruntergeladen werden. Netzwerkverbindung prüfen und erneut versuchen.'
              : 'Die Stimme konnte nicht initialisiert werden. Bitte erneut versuchen.',
          );
        }
        return false;
      } finally {
        setVoiceBusy(false);
      }
    })();

    voicePreparationRef.current = preparation;
    try {
      return await preparation;
    } finally {
      if (voicePreparationRef.current === preparation) voicePreparationRef.current = null;
    }
  }

  useEffect(() => {
    if (!hydrated) return;
    void prepareVoice({ allowDownload: false, silent: true, background: true });
    // Background warm-up is intentionally tied only to the one-time hydration transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  async function ensureVoiceReady() {
    return prepareVoice({ allowDownload: true, silent: false, background: false });
  }

  function finishAudio(audio: HTMLAudioElement, audioUrl: string) {
    if (audioRef.current === audio) audioRef.current = null;
    if (audioUrlRef.current === audioUrl) audioUrlRef.current = null;
    URL.revokeObjectURL(audioUrl);
    setVoiceStatus('Stimme bereit');
    setVoiceBusy(false);
  }

  async function speakText(text: string, progressLabel: string) {
    if (voiceBusy) return;
    if (!ttsSessionRef.current || sessionVoiceRef.current !== DEFAULT_VOICE_ID) {
      const prepared = await ensureVoiceReady();
      if (!prepared) return;
    }

    setVoiceBusy(true);
    setVoiceStatus(progressLabel);
    try {
      const session = ttsSessionRef.current;
      if (!session || sessionVoiceRef.current !== DEFAULT_VOICE_ID) {
        throw new Error('Piper session is not ready for Thorsten.');
      }
      const spokenText = applyPronunciationDictionary(
        text,
        mergedPronunciationDictionary,
      );
      const audioBlob = await session.predict(spokenText);
      stopCurrentAudio();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.playbackRate = speedRate(selectedSpeedId);
      audioRef.current = audio;
      audioUrlRef.current = audioUrl;
      audio.onended = () => finishAudio(audio, audioUrl);
      audio.onerror = () => {
        finishAudio(audio, audioUrl);
        showNotice('Die Ansage konnte nicht abgespielt werden.');
      };
      await audio.play();
    } catch (error) {
      console.error(error);
      stopCurrentAudio();
      setVoiceStatus('Stimme bereit');
      setVoiceBusy(false);
      showNotice('Die Ansage konnte nicht erzeugt werden.');
    }
  }

  async function installApp() {
    if (!installPrompt) {
      showNotice('Im Browsermenü „App installieren“ oder „Zum Dock hinzufügen“ auswählen.');
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') setInstallPrompt(null);
  }

  async function announceCourt(court: Court) {
    const first = court.players[0] ? playerById.get(court.players[0]) : null;
    const second = court.players[1] ? playerById.get(court.players[1]) : null;
    if (!first || !second || voiceBusy) return;

    const text = `Es spielen auf Feld ${court.id}, ${divisionOf(first)}, ${first.name} gegen ${second.name}. Ich wiederhole: ${first.name} gegen ${second.name}, auf Feld ${court.id}.`;
    await speakText(text, `Ansage für Feld ${court.id} …`);
  }

  function exportTournamentData() {
    try {
      const backup = createBackup(players, courts, {
        voiceId: DEFAULT_VOICE_ID,
        speedId: selectedSpeedId,
      }, customPronunciations);
      const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rallycue-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      showNotice('Turnierdaten wurden als JSON gesichert.');
    } catch (error) {
      console.error(error);
      showNotice('Die Turnierdaten konnten nicht gesichert werden.');
    }
  }

  async function importTournamentData(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const result = parseBackup(await file.text());
      if (!result.ok) {
        showNotice(result.error);
        return;
      }

      const hasCurrentData =
        players.length > 0 ||
        courts.some((court) => court.players.some(Boolean)) ||
        customPronunciations.length > 0;
      if (
        hasCurrentData &&
        !window.confirm(
          'Die Sicherung ersetzt alle aktuellen Spieler und Feldbelegungen. Wirklich fortfahren?',
        )
      ) {
        return;
      }

      stopCurrentAudio();
      ttsSessionRef.current = null;
      sessionVoiceRef.current = null;
      setPlayers(result.value.players);
      setCourts(result.value.courts);
      setCustomPronunciations(result.value.pronunciationDictionary ?? []);
      if (result.value.settings) {
        setSelectedSpeedId(result.value.settings.speedId);
      }
      setVoiceReady(false);
      setVoiceStatus('Stimme wird geprüft …');
      setStorageWarning(null);
      setCanPersist(true);
      clearAssignmentSelection();
      showNotice('Die RallyCue-Sicherung wurde geladen.');
    } catch (error) {
      console.error(error);
      showNotice('Die Sicherungsdatei konnte nicht gelesen werden.');
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <Image src={`${APP_BASE_PATH}/rallycue-logo.png`} alt="" width={64} height={64} priority />
        </div>
        <div className="brand-copy">
          <h1>RallyCue</h1>
          <p>Schülerturnier · 9 Felder</p>
        </div>
        <div className="topbar-actions">
          {PWA_ENABLED && !isStandalone && (
            <button className="install-button" onClick={() => void installApp()} type="button">
              App installieren
            </button>
          )}
          <button
            className={`voice-status ${voiceReady ? 'ready' : ''}`}
            onClick={() => setAnnouncementDialogOpen(true)}
            type="button"
          >
            <span aria-hidden="true" />
            {voiceStatus}
            <strong>Ansage</strong>
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="player-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Teilnehmende</p>
              <h2>Spieler <span>{players.length}</span></h2>
            </div>
            <button className="add-button" onClick={openNewPlayerDialog} type="button" aria-label="Spieler hinzufügen">+</button>
          </div>

          <label className="search-field">
            <span aria-hidden="true" className="search-icon" />
            <input
              type="search"
              placeholder="Spieler suchen …"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <div className="filter-row" aria-label="Altersklasse filtern">
            {['Alle', ...AGE_GROUPS.filter((ageGroup) => players.some((player) => player.ageGroup === ageGroup))].map((ageGroup) => (
              <button
                className={`filter-chip ${filter === ageGroup ? 'active' : ''}`}
                key={ageGroup}
                onClick={() => setFilter(ageGroup)}
                type="button"
              >
                {ageGroup}
              </button>
            ))}
          </div>

          <div className="category-filter" aria-label="Jungen oder Mädchen filtern">
            {['Alle', 'Jungen', 'Mädchen'].map((category) => (
              <button
                className={categoryFilter === category ? 'active' : ''}
                key={category}
                onClick={() => setCategoryFilter(category)}
                type="button"
              >
                {category}
              </button>
            ))}
          </div>

          <div className="player-groups">
            {playerGroups.map(({ key, ageGroup, category, players: groupPlayers }) => (
              <section className="player-group" key={key}>
                <div className="group-title">
                  <span>{ageGroup} · {category}</span>
                  <span>{groupPlayers.length} {groupPlayers.length === 1 ? 'Spieler' : 'Spieler'}</span>
                </div>
                {groupPlayers.map((player) => {
                  const assignedCourt = assignmentByPlayer.get(player.id);
                  const selected = selectedPlayerId === player.id;
                  const targetDecision = selectedTarget
                    ? evaluateAssignment(
                        players,
                        courts,
                        player.id,
                        selectedTarget.courtId,
                        selectedTarget.slotIndex,
                      )
                    : null;
                  const targetInvalid = targetDecision?.status === 'rejected';
                  return (
                    <div
                      className={`player-row ${selected ? 'selected' : ''} ${assignedCourt ? 'assigned' : ''} ${selectedTarget ? (targetInvalid ? 'target-invalid' : 'target-valid') : ''}`}
                      draggable
                      key={player.id}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(PLAYER_DRAG_TYPE, player.id);
                        event.dataTransfer.effectAllowed = 'move';
                        setDraggedPlayerId(player.id);
                      }}
                      onDragEnd={() => setDraggedPlayerId(null)}
                    >
                      <div
                        className="player-select"
                        onClick={() => handlePlayerSelection(player.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handlePlayerSelection(player.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        title={targetInvalid && targetDecision.status === 'rejected' ? targetDecision.message : undefined}
                      >
                        <span className={`avatar avatar-${player.ageGroup === 'U13' ? 'mint' : 'lavender'}`}>{initials(player.name)}</span>
                        <span className="player-copy">
                          <span className="player-name">{player.name}</span>
                          <span className="player-division">{player.category}{assignedCourt ? ` · Feld ${assignedCourt}` : ''}</span>
                        </span>
                      </div>
                      <button className="edit-player" onClick={() => openEditPlayerDialog(player)} type="button" aria-label={`${player.name} bearbeiten`}>•••</button>
                    </div>
                  );
                })}
              </section>
            ))}
            {!playerGroups.length && (
              <div className="empty-roster">
                <span>＋</span>
                <strong>Keine Spieler gefunden</strong>
                <p>Suche ändern oder einen neuen Spieler anlegen.</p>
              </div>
            )}
          </div>
        </aside>

        <section className="court-area">
          <div className="court-heading">
            <div>
              <p className="eyebrow">Spielfläche</p>
              <h2>Feldübersicht</h2>
            </div>
            <p>Spieler ziehen oder anklicken und einem Platz zuweisen</p>
          </div>

          <div className="tournament-tools">
            <div>
              <strong>Turnierdaten</strong>
              <span>Lokale Sicherung für diesen Browser</span>
            </div>
            <div className="tournament-tool-actions">
              <button onClick={exportTournamentData} type="button">Turnierdaten sichern</button>
              <button onClick={() => backupInputRef.current?.click()} type="button">Sicherung laden</button>
              <input
                ref={backupInputRef}
                accept="application/json,.json"
                className="visually-hidden"
                onChange={(event) => void importTournamentData(event)}
                type="file"
              />
            </div>
          </div>

          {storageWarning && (
            <div className="storage-warning" role="alert">
              <strong>Lokale Speicherung pausiert</strong>
              <span>{storageWarning}</span>
            </div>
          )}

          <div className={`court-selection-bar ${selectedPlayerId || selectedTarget ? 'active' : ''}`} aria-live="polite">
            {selectedPlayerId ? (
              <>
                <span className="selection-player-avatar">{initials(playerById.get(selectedPlayerId)?.name ?? '')}</span>
                <span className="selection-copy">
                  <strong>{playerById.get(selectedPlayerId)?.name}</strong>
                  Jetzt einen Platz auf einem Feld auswählen
                </span>
                <button onClick={clearAssignmentSelection} type="button">Auswahl aufheben</button>
              </>
            ) : selectedTarget ? (
              <>
                <span className="selection-player-avatar">{selectedTarget.courtId}</span>
                <span className="selection-copy">
                  <strong>Feld {selectedTarget.courtId} · Spieler {selectedTarget.slotIndex + 1}</strong>
                  Jetzt links einen passenden Spieler auswählen
                </span>
                <button onClick={clearAssignmentSelection} type="button">Auswahl aufheben</button>
              </>
            ) : (
              <span className="selection-placeholder">Tipp: Spieler oder leeren Feldplatz zuerst auswählen – Drag-and-drop funktioniert weiterhin.</span>
            )}
          </div>

          <div className="court-grid">
            {courts.map((court) => {
              const first = court.players[0] ? playerById.get(court.players[0]) : null;
              const second = court.players[1] ? playerById.get(court.players[1]) : null;
              const ready = Boolean(first && second && divisionOf(first) === divisionOf(second));
              const group = first ? divisionOf(first) : second ? divisionOf(second) : null;
              return (
                <article className={`court-card ${ready ? 'ready' : ''}`} key={court.id}>
                  <div className="court-card-head">
                    <div>
                      <span className="court-number">{court.id}</span>
                      <h3>Feld {court.id}</h3>
                    </div>
                    <div className="court-card-actions">
                      {group && <span className="group-badge">{group}</span>}
                      {court.players.some(Boolean) && (
                        <button
                          className="clear-court-button"
                          onClick={() => setPendingClearCourtId(court.id)}
                          type="button"
                        >
                          Feld leeren
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="slots">
                    {[first, second].map((player, index) => {
                      const slotIndex = index as SlotIndex;
                      const assignmentDecision = interactionPlayerId
                        ? evaluateAssignment(
                            players,
                            courts,
                            interactionPlayerId,
                            court.id,
                            slotIndex,
                          )
                        : null;
                      const invalidTarget = assignmentDecision?.status === 'rejected';
                      const selectableTarget = Boolean(
                        interactionPlayerId && assignmentDecision?.status !== 'rejected',
                      );
                      const targetSelected =
                        selectedTarget?.courtId === court.id &&
                        selectedTarget.slotIndex === slotIndex;
                      return (
                        <div key={slotIndex}>
                          <button
                            className={`player-slot ${player ? 'filled' : 'empty'} ${selectableTarget ? 'selectable' : ''} ${invalidTarget ? 'invalid-target' : ''} ${targetSelected ? 'target-selected' : ''}`}
                            onClick={() => handleSlotClick(court.id, slotIndex, Boolean(player))}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = invalidTarget ? 'none' : 'move';
                            }}
                            onDrop={(event) => handleDrop(event, court.id, slotIndex)}
                            type="button"
                          >
                            {player ? (
                              <>
                                <span className="slot-avatar">{initials(player.name)}</span>
                                <span className="slot-name">{player.name}</span>
                              </>
                            ) : (
                              <span>Spieler {slotIndex + 1} zuweisen</span>
                            )}
                          </button>
                          {player && (
                            <button
                              className="remove-player"
                              onClick={() => removeFromCourt(court.id, slotIndex)}
                              type="button"
                              aria-label={`${player.name} von Feld ${court.id} entfernen`}
                            >×</button>
                          )}
                          {slotIndex === 0 && <span className="versus">gegen</span>}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    className="announce-button"
                    disabled={!ready || voiceBusy}
                    onClick={() => void announceCourt(court)}
                    type="button"
                  >
                    <span aria-hidden="true" className="speaker-glyph">◖))</span>
                    {ready ? 'Begegnung aufrufen' : 'Zwei passende Spieler zuweisen'}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {isPlayerDialogOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPlayerDialogOpen(false);
        }}>
          <section className="player-dialog" role="dialog" aria-modal="true" aria-labelledby="player-dialog-title">
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">Spielerverwaltung</p>
                <h2 id="player-dialog-title">{editingPlayer ? 'Spieler bearbeiten' : 'Spieler anlegen'}</h2>
              </div>
              <button onClick={() => setPlayerDialogOpen(false)} type="button" aria-label="Dialog schließen">×</button>
            </div>
            <form onSubmit={savePlayer}>
              <label className="form-field">
                <span>Vor- und Nachname</span>
                <input autoFocus required value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="z. B. Max Mustermann" />
              </label>
              <div className="form-grid">
                <label className="form-field">
                  <span>Altersklasse</span>
                  <select required value={formAgeGroup} onChange={(event) => setFormAgeGroup(event.target.value as AgeGroup | '')}>
                    <option disabled value="">Altersklasse wählen …</option>
                    {AGE_GROUPS.map((ageGroup) => <option key={ageGroup}>{ageGroup}</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>Disziplin</span>
                  <select value={formCategory} onChange={(event) => setFormCategory(event.target.value as Category)}>
                    {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </label>
              </div>
              <div className="dialog-actions">
                {editingPlayer && <button className="delete-button" onClick={deletePlayer} type="button">Spieler löschen</button>}
                <button className="cancel-button" onClick={() => setPlayerDialogOpen(false)} type="button">Abbrechen</button>
                <button
                  className="save-button"
                  disabled={!isPlayerDraftValid(formName, formAgeGroup, formCategory)}
                  type="submit"
                >
                  {editingPlayer ? 'Speichern' : 'Spieler anlegen'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {isAnnouncementDialogOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAnnouncementDialogOpen(false);
        }}>
          <section className="player-dialog announcement-dialog" role="dialog" aria-modal="true" aria-labelledby="announcement-dialog-title">
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">Lokale Sprachausgabe</p>
                <h2 id="announcement-dialog-title">Ansage-Einstellungen</h2>
              </div>
              <button onClick={() => setAnnouncementDialogOpen(false)} type="button" aria-label="Dialog schließen">×</button>
            </div>

            <div className="fixed-voice">
              <span>Stimme</span>
              <strong>{FIXED_VOICE.label}</strong>
            </div>

            <fieldset className="settings-group" disabled={voiceBusy}>
              <legend>Geschwindigkeit</legend>
              <div className="speed-options">
                {SPEED_OPTIONS.map((speed) => (
                  <button
                    className={selectedSpeedId === speed.id ? 'active' : ''}
                    key={speed.id}
                    onClick={() => handleSpeedChange(speed.id)}
                    type="button"
                  >
                    <strong>{speed.label}</strong>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className={`settings-voice-state ${voiceReady ? 'ready' : ''}`}>
              <span aria-hidden="true" />
              <div>
                <strong>{FIXED_VOICE.label}</strong>
                <small>{voiceStatus}. Nur diese Stimme wird bei Bedarf heruntergeladen.</small>
              </div>
            </div>

            <button
              className="dictionary-open-button"
              onClick={openPronunciationDictionary}
              type="button"
            >
              <span>
                <strong>Aussprachewörterbuch</strong>
                <small>Namen zentral für alle Ansagen korrigieren</small>
              </span>
              <span aria-hidden="true">{customPronunciations.length} eigene ›</span>
            </button>

            <div className="dialog-actions announcement-actions">
              <button className="cancel-button" onClick={() => setAnnouncementDialogOpen(false)} type="button">Schließen</button>
              <button
                className="prepare-button"
                disabled={voiceBusy}
                onClick={() => void ensureVoiceReady()}
                type="button"
              >
                Stimme vorbereiten
              </button>
              <button
                className="save-button"
                disabled={voiceBusy}
                onClick={() => void speakText(TEST_ANNOUNCEMENT, 'Testansage …')}
                type="button"
              >
                Testansage abspielen
              </button>
            </div>
          </section>
        </div>
      )}

      {isPronunciationDialogOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closePronunciationDictionary();
        }}>
          <section className="player-dialog pronunciation-dialog" role="dialog" aria-modal="true" aria-labelledby="pronunciation-dialog-title">
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">Lokale Sprachausgabe</p>
                <h2 id="pronunciation-dialog-title">Aussprachewörterbuch</h2>
              </div>
              <button onClick={closePronunciationDictionary} type="button" aria-label="Dialog schließen">×</button>
            </div>

            <p className="dictionary-intro">
              Eigene Einträge gelten zusätzlich zu den mitgelieferten Aussprachen und haben Vorrang.
            </p>

            <div className="dictionary-list">
              {customPronunciations.length === 0 ? (
                <div className="dictionary-empty">
                  <strong>Noch keine eigenen Aussprachen</strong>
                  <span>Mitgelieferte Korrekturen sind bereits aktiv.</span>
                </div>
              ) : customPronunciations.map((entry, index) => (
                <article className="dictionary-entry" key={`${entry.source}-${index}`}>
                  <div className="dictionary-copy">
                    <span>{entry.source}</span>
                    <span aria-hidden="true">→</span>
                    <strong>{entry.replacement}</strong>
                  </div>
                  <div className="dictionary-entry-actions">
                    <button
                      disabled={voiceBusy}
                      onClick={() => void speakText(`Es spielt ${entry.replacement}.`, 'Aussprache testen …')}
                      type="button"
                    >
                      Testen
                    </button>
                    <button onClick={() => startPronunciationEntry(index)} type="button">Bearbeiten</button>
                    <button className="dictionary-delete-button" onClick={() => deletePronunciationEntry(index)} type="button">Löschen</button>
                  </div>
                </article>
              ))}
            </div>

            {isPronunciationEditorOpen ? (
              <form className="dictionary-editor" onSubmit={savePronunciationEntry}>
                <div className="dictionary-editor-heading">
                  <strong>{editingPronunciationIndex === null ? 'Aussprache hinzufügen' : 'Aussprache bearbeiten'}</strong>
                  <button onClick={resetPronunciationEditor} type="button" aria-label="Editor schließen">×</button>
                </div>
                <div className="dictionary-form-grid">
                  <label className="form-field">
                    <span>Original</span>
                    <input
                      autoFocus
                      maxLength={MAX_PRONUNCIATION_SOURCE_LENGTH}
                      onChange={(event) => {
                        setPronunciationSource(event.target.value);
                        setPronunciationError(null);
                      }}
                      placeholder="z. B. Chen Xuan"
                      required
                      value={pronunciationSource}
                    />
                  </label>
                  <label className="form-field">
                    <span>Aussprache</span>
                    <input
                      maxLength={MAX_PRONUNCIATION_REPLACEMENT_LENGTH}
                      onChange={(event) => {
                        setPronunciationReplacement(event.target.value);
                        setPronunciationError(null);
                      }}
                      placeholder="z. B. Tschenn Schüän"
                      required
                      value={pronunciationReplacement}
                    />
                  </label>
                </div>
                {pronunciationError && <p className="dictionary-error" role="alert">{pronunciationError}</p>}
                <div className="dictionary-editor-actions">
                  <button className="cancel-button" onClick={resetPronunciationEditor} type="button">Abbrechen</button>
                  <button className="save-button" type="submit">Speichern</button>
                </div>
              </form>
            ) : (
              <button className="dictionary-add-button" onClick={() => startPronunciationEntry(null)} type="button">
                + Aussprache hinzufügen
              </button>
            )}

            <div className="dialog-actions dictionary-dialog-actions">
              <button className="cancel-button" onClick={closePronunciationDictionary} type="button">Schließen</button>
            </div>
          </section>
        </div>
      )}

      {pendingOverwrite && (() => {
        const incomingPlayer = playerById.get(pendingOverwrite.playerId);
        const existingPlayer = playerById.get(pendingOverwrite.existingPlayerId);
        const court = courts.find((item) => item.id === pendingOverwrite.courtId);
        const completeMatch = Boolean(court?.players[0] && court?.players[1]);
        return (
          <div className="dialog-backdrop" role="presentation">
            <section className="player-dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="overwrite-dialog-title">
              <span className="warning-mark" aria-hidden="true">!</span>
              <p className="eyebrow">Sicherheitsabfrage</p>
              <h2 id="overwrite-dialog-title">{completeMatch ? 'Bestehende Begegnung ändern?' : 'Belegten Platz überschreiben?'}</h2>
              <p className="confirm-copy">
                Auf Feld {pendingOverwrite.courtId} ist dieser Platz bereits belegt. Prüfe den Wechsel bitte kurz, bevor er übernommen wird.
              </p>
              <div className="overwrite-summary">
                <div>
                  <span>Bisher</span>
                  <strong>{existingPlayer?.name}</strong>
                </div>
                <span className="overwrite-arrow" aria-hidden="true">→</span>
                <div>
                  <span>Neu</span>
                  <strong>{incomingPlayer?.name}</strong>
                </div>
              </div>
              <div className="dialog-actions confirm-actions">
                <button className="cancel-button" onClick={() => setPendingOverwrite(null)} type="button">Abbrechen</button>
                <button
                  className="overwrite-button"
                  onClick={() => commitAssignment(pendingOverwrite.playerId, pendingOverwrite.courtId, pendingOverwrite.slotIndex)}
                  type="button"
                >
                  Trotzdem ersetzen
                </button>
              </div>
            </section>
          </div>
        );
      })()}

      {pendingClearCourtId !== null && (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="player-dialog confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-court-dialog-title"
          >
            <span className="warning-mark clear-warning-mark" aria-hidden="true">!</span>
            <p className="eyebrow">Sicherheitsabfrage</p>
            <h2 id="clear-court-dialog-title">Feld {pendingClearCourtId} leeren?</h2>
            <p className="confirm-copy">
              Alle Spieler werden von diesem Feld entfernt. Die Spieler bleiben in der Teilnehmerliste.
            </p>
            <div className="dialog-actions confirm-actions">
              <button className="cancel-button" onClick={() => setPendingClearCourtId(null)} type="button">
                Abbrechen
              </button>
              <button className="clear-confirm-button" onClick={confirmClearCourt} type="button">
                Feld leeren
              </button>
            </div>
          </section>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
