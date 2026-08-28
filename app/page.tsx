'use client';

import {
  type DragEvent as ReactDragEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Image from 'next/image';

type Player = {
  id: string;
  name: string;
  ageGroup: string;
  category: string;
};

type Court = {
  id: number;
  players: [string | null, string | null];
};

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
  slotIndex: 0 | 1;
  existingPlayerId: string;
};

const PLAYER_STORAGE_KEY = 'rallycue.players.v1';
const COURT_STORAGE_KEY = 'rallycue.courts.v1';
const LEGACY_PLAYER_STORAGE_KEY = 'courtcall.players.v1';
const LEGACY_COURT_STORAGE_KEY = 'courtcall.courts.v1';
const PLAYER_DRAG_TYPE = 'text/rallycue-player';
const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const PWA_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PWA === 'true';
const VOICE_ID = 'de_DE-thorsten-medium';
const LOCAL_WASM_PATHS = {
  onnxWasm: `${APP_BASE_PATH}/onnx/`,
  piperData: `${APP_BASE_PATH}/piper/piper_phonemize.data`,
  piperWasm: `${APP_BASE_PATH}/piper/piper_phonemize.wasm`,
};
const AGE_GROUPS = ['U11', 'U13', 'U15', 'U17', 'U19'];
const CATEGORIES = ['Jungen Einzel', 'Mädchen Einzel'];

const SAMPLE_PLAYERS: Player[] = [
  { id: 'bernd', name: 'Bernd Beispiel', ageGroup: 'U13', category: 'Jungen Einzel' },
  { id: 'lina', name: 'Lina Baumann', ageGroup: 'U13', category: 'Mädchen Einzel' },
  { id: 'max', name: 'Max Mustermann', ageGroup: 'U13', category: 'Jungen Einzel' },
  { id: 'emil', name: 'Emil Fischer', ageGroup: 'U15', category: 'Jungen Einzel' },
  { id: 'mara', name: 'Mara Hofmann', ageGroup: 'U15', category: 'Mädchen Einzel' },
  { id: 'nora', name: 'Nora Klein', ageGroup: 'U15', category: 'Mädchen Einzel' },
  { id: 'paul', name: 'Paul Wagner', ageGroup: 'U15', category: 'Jungen Einzel' },
];

const EMPTY_COURTS: Court[] = Array.from({ length: 9 }, (_, index) => ({
  id: index + 1,
  players: [null, null],
}));

const SAMPLE_COURTS: Court[] = EMPTY_COURTS.map((court) => {
  if (court.id === 1) return { ...court, players: ['max', 'bernd'] };
  if (court.id === 2) return { ...court, players: ['mara', null] };
  return court;
});

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function divisionOf(player: Player) {
  return `${player.category} ${player.ageGroup}`;
}

function sortPlayers(players: Player[]) {
  return [...players].sort((a, b) =>
    a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }),
  );
}

export default function Home() {
  const [players, setPlayers] = useState<Player[]>(SAMPLE_PLAYERS);
  const [courts, setCourts] = useState<Court[]>(SAMPLE_COURTS);
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('Alle');
  const [categoryFilter, setCategoryFilter] = useState('Alle');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [isPlayerDialogOpen, setPlayerDialogOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [formName, setFormName] = useState('');
  const [formAgeGroup, setFormAgeGroup] = useState('U13');
  const [formCategory, setFormCategory] = useState('Jungen Einzel');
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingOverwrite, setPendingOverwrite] = useState<PendingOverwrite | null>(null);
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Lokale Stimme');
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsSessionRef = useRef<LocalTtsSession | null>(null);

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedPlayers =
          localStorage.getItem(PLAYER_STORAGE_KEY) ??
          localStorage.getItem(LEGACY_PLAYER_STORAGE_KEY);
        const savedCourts =
          localStorage.getItem(COURT_STORAGE_KEY) ??
          localStorage.getItem(LEGACY_COURT_STORAGE_KEY);
        if (savedPlayers) setPlayers(JSON.parse(savedPlayers) as Player[]);
        if (savedCourts) setCourts(JSON.parse(savedCourts) as Court[]);
      } catch {
        setNotice('Gespeicherte Daten konnten nicht gelesen werden.');
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(players));
  }, [hydrated, players]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(COURT_STORAGE_KEY, JSON.stringify(courts));
  }, [courts, hydrated]);

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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setPlayerDialogOpen(false);
        setSelectedPlayerId(null);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkVoice() {
      try {
        const tts = await import('@mintplex-labs/piper-tts-web');
        const storedVoices = await tts.stored();
        if (!cancelled && storedVoices.includes(VOICE_ID)) {
          setVoiceReady(true);
          setVoiceStatus('Stimme bereit');
        }
      } catch {
        // The voice package is loaded on demand after the first user action.
      }
    }
    void checkVoice();
    return () => {
      cancelled = true;
    };
  }, []);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4200);
  }

  function openNewPlayerDialog() {
    setEditingPlayer(null);
    setFormName('');
    setFormAgeGroup('U13');
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
    if (!name) return;

    if (editingPlayer) {
      setPlayers((current) =>
        current.map((player) =>
          player.id === editingPlayer.id
            ? { ...player, name, ageGroup: formAgeGroup, category: formCategory }
            : player,
        ),
      );
      showNotice(`${name} wurde aktualisiert.`);
    } else {
      const player: Player = {
        id: crypto.randomUUID(),
        name,
        ageGroup: formAgeGroup,
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

  function assignPlayer(playerId: string, courtId: number, slotIndex: 0 | 1) {
    const player = playerById.get(playerId);
    const targetCourt = courts.find((court) => court.id === courtId);
    if (!player || !targetCourt) return;

    const opponentId = targetCourt.players[slotIndex === 0 ? 1 : 0];
    const opponent = opponentId ? playerById.get(opponentId) : null;
    if (opponent && divisionOf(opponent) !== divisionOf(player)) {
      showNotice(`${player.ageGroup} passt nicht zu ${divisionOf(opponent)}.`);
      return;
    }

    const existingPlayerId = targetCourt.players[slotIndex];
    if (existingPlayerId && existingPlayerId !== playerId) {
      setPendingOverwrite({ playerId, courtId, slotIndex, existingPlayerId });
      return;
    }

    commitAssignment(playerId, courtId, slotIndex);
  }

  function commitAssignment(playerId: string, courtId: number, slotIndex: 0 | 1) {

    setCourts((current) =>
      current.map((court) => {
        const withoutPlayer = court.players.map((id) =>
          id === playerId ? null : id,
        ) as Court['players'];
        if (court.id !== courtId) return { ...court, players: withoutPlayer };
        const nextPlayers = [...withoutPlayer] as Court['players'];
        nextPlayers[slotIndex] = playerId;
        return { ...court, players: nextPlayers };
      }),
    );
    setSelectedPlayerId(null);
    setPendingOverwrite(null);
  }

  function handleSlotClick(courtId: number, slotIndex: 0 | 1) {
    if (!selectedPlayerId) {
      showNotice('Zuerst links einen Spieler auswählen.');
      return;
    }
    assignPlayer(selectedPlayerId, courtId, slotIndex);
  }

  function handleDrop(event: ReactDragEvent, courtId: number, slotIndex: 0 | 1) {
    event.preventDefault();
    const playerId = event.dataTransfer.getData(PLAYER_DRAG_TYPE);
    if (playerId) assignPlayer(playerId, courtId, slotIndex);
  }

  function removeFromCourt(courtId: number, slotIndex: 0 | 1) {
    setCourts((current) =>
      current.map((court) => {
        if (court.id !== courtId) return court;
        const nextPlayers = [...court.players] as Court['players'];
        nextPlayers[slotIndex] = null;
        return { ...court, players: nextPlayers };
      }),
    );
  }

  async function prepareVoice() {
    if (voiceBusy) return false;
    setVoiceBusy(true);
    setVoiceStatus('Stimme wird geladen …');
    try {
      const tts = await import('@mintplex-labs/piper-tts-web');
      const storedVoices = await tts.stored();
      if (!storedVoices.includes(VOICE_ID)) {
        await tts.download(VOICE_ID, (progress) => {
          const percent = progress.total
            ? Math.round((progress.loaded / progress.total) * 100)
            : 0;
          setVoiceStatus(percent ? `Stimme laden · ${percent} %` : 'Stimme wird geladen …');
        });
      }
      setVoiceStatus('Stimme wird initialisiert …');
      ttsSessionRef.current = await tts.TtsSession.create({
        voiceId: VOICE_ID,
        wasmPaths: LOCAL_WASM_PATHS,
      });
      setVoiceReady(true);
      setVoiceStatus('Stimme bereit');
      return true;
    } catch (error) {
      console.error(error);
      setVoiceStatus('Stimme nicht verfügbar');
      showNotice('Die lokale Stimme konnte nicht geladen werden. Internetverbindung prüfen und erneut versuchen.');
      return false;
    } finally {
      setVoiceBusy(false);
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

    if (!voiceReady || !ttsSessionRef.current) {
      const prepared = await prepareVoice();
      if (!prepared) return;
    }

    const text = `Es spielen auf Feld ${court.id}, ${divisionOf(first)}, ${first.name} gegen ${second.name}. Ich wiederhole: ${first.name} gegen ${second.name}, auf Feld ${court.id}.`;
    setVoiceBusy(true);
    setVoiceStatus(`Ansage für Feld ${court.id} …`);
    try {
      const session = ttsSessionRef.current;
      if (!session) throw new Error('Piper session is not ready.');
      const audioBlob = await session.predict(text);
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        setVoiceStatus('Stimme bereit');
        setVoiceBusy(false);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        setVoiceStatus('Stimme bereit');
        setVoiceBusy(false);
        showNotice('Die Ansage konnte nicht abgespielt werden.');
      };
      await audio.play();
    } catch (error) {
      console.error(error);
      setVoiceStatus('Stimme bereit');
      setVoiceBusy(false);
      showNotice('Die Ansage konnte nicht erzeugt werden.');
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <Image src={`${APP_BASE_PATH}/courtcall-logo.png`} alt="" width={64} height={64} priority />
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
            disabled={voiceBusy}
            onClick={() => void prepareVoice()}
            type="button"
          >
            <span aria-hidden="true" />
            {voiceStatus}
            {!voiceReady && !voiceBusy && <strong>Vorbereiten</strong>}
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
              ref={searchRef}
              type="search"
              placeholder="Spieler suchen …"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd>⌘ K</kbd>
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
                  return (
                    <div
                      className={`player-row ${selected ? 'selected' : ''} ${assignedCourt ? 'assigned' : ''}`}
                      draggable
                      key={player.id}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(PLAYER_DRAG_TYPE, player.id);
                        event.dataTransfer.effectAllowed = 'move';
                        setSelectedPlayerId(player.id);
                      }}
                    >
                      <div
                        className="player-select"
                        onClick={() => setSelectedPlayerId((current) => current === player.id ? null : player.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedPlayerId((current) => current === player.id ? null : player.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
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

          <div className={`court-selection-bar ${selectedPlayerId ? 'active' : ''}`} aria-live="polite">
            {selectedPlayerId ? (
              <>
                <span className="selection-player-avatar">{initials(playerById.get(selectedPlayerId)?.name ?? '')}</span>
                <span className="selection-copy">
                  <strong>{playerById.get(selectedPlayerId)?.name}</strong>
                  Jetzt einen Platz auf einem Feld auswählen
                </span>
                <button onClick={() => setSelectedPlayerId(null)} type="button">Auswahl aufheben</button>
              </>
            ) : (
              <span className="selection-placeholder">Tipp: Eine Spielerkarte anklicken oder direkt auf ein Feld ziehen.</span>
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
                    {group && <span className="group-badge">{group}</span>}
                  </div>
                  <div className="slots">
                    {[first, second].map((player, index) => {
                      const slotIndex = index as 0 | 1;
                      return (
                        <div key={slotIndex}>
                          <button
                            className={`player-slot ${player ? 'filled' : 'empty'} ${selectedPlayerId ? 'selectable' : ''}`}
                            onClick={() => handleSlotClick(court.id, slotIndex)}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
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
                  <select value={formAgeGroup} onChange={(event) => setFormAgeGroup(event.target.value)}>
                    {AGE_GROUPS.map((ageGroup) => <option key={ageGroup}>{ageGroup}</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>Disziplin</span>
                  <select value={formCategory} onChange={(event) => setFormCategory(event.target.value)}>
                    {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </label>
              </div>
              <div className="dialog-actions">
                {editingPlayer && <button className="delete-button" onClick={deletePlayer} type="button">Spieler löschen</button>}
                <button className="cancel-button" onClick={() => setPlayerDialogOpen(false)} type="button">Abbrechen</button>
                <button className="save-button" type="submit">{editingPlayer ? 'Speichern' : 'Spieler anlegen'}</button>
              </div>
            </form>
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

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
