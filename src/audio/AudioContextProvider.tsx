import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { getDemoTracks } from './demoTracks';
import { parseAudioFile } from './id3Reader';
import {
  isAndroidNative,
  mapNativeScanTracks,
  RyotunesNativeMedia,
} from './NativeMediaBridge';
import {
  clearOfflineAndCaches,
  downloadTrackOffline,
  fetchTrackLyrics,
  loadOfflineLibrary,
  removeOfflineTrack,
  resolvePlayableTrack,
} from './providerService';
import {
  AlbumGroup,
  ArtistGroup,
  AudioFxState,
  AudioQuality,
  LyricsDoc,
  Playlist,
  RepeatMode,
  Track,
} from './types';
import { sampleArtworkAccent } from '../theme/artAccent';
import { useTheme } from '../theme/ThemeContext';

interface ToastMessage {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

interface AudioContextValue {
  tracks: Track[];
  offlineTracks: Track[];
  localCount: number;
  scanningDevice: boolean;
  isNativeAndroid: boolean;
  resolvingTrackId: string | null;
  lyricsLoading: boolean;
  downloadProgress: Record<string, number>;
  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number; // 0..100
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  stopAfterCurrent: boolean;
  audioQuality: AudioQuality;
  autoplay: boolean;
  preventDuplicates: boolean;
  likedIds: string[];
  playlists: Playlist[];
  recentIds: string[];
  albums: AlbumGroup[];
  artists: ArtistGroup[];
  audioFx: AudioFxState;
  spectrumPoints: number[];
  osdVisible: boolean;
  toast: ToastMessage | null;

  playTrack: (track: Track, customQueue?: Track[]) => void;
  playQueueIndex: (index: number) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (secs: number) => void;
  setVolume: (vol: number, showOsd?: boolean) => void;
  toggleMute: () => void;
  triggerOsd: () => void;
  dismissOsd: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleStopAfterCurrent: () => void;
  setAudioQuality: (q: AudioQuality) => void;
  setAutoplay: (on: boolean) => void;
  setPreventDuplicates: (on: boolean) => void;
  toggleLike: (trackId: string) => void;
  createPlaylist: (title: string, initialTrackId?: string) => string;
  addTrackToPlaylist: (playlistId: string, trackId: string) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  moveQueueItem: (from: number, to: number) => void;
  removeFromQueue: (index: number) => void;
  clearUpcomingQueue: () => void;
  setAudioFx: (fx: AudioFxState) => void;
  importLocalFiles: (files: FileList | File[]) => Promise<void>;
  syncDeviceLibrary: (interactive?: boolean) => Promise<void>;
  downloadTrack: (track: Track) => Promise<void>;
  downloadTracksBatch: (tracksToSave: Track[], label?: string) => Promise<void>;
  removeOffline: (trackId: string) => Promise<void>;
  clearOfflineAndCache: () => Promise<void>;
  showToast: (text: string, kind?: 'info' | 'success' | 'error') => void;
}

const AudioPlayerContext = createContext<AudioContextValue | null>(null);

const DEFAULT_FX: AudioFxState = {
  speed: 1,
  semitones: 0,
  reverb: 0,
  bass: 0,
  width: 0,
};

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function createImpulseResponse(ctx: AudioContext, duration = 1.6, decay = 2.6): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * duration);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const channelData = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

export const AudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setArtAccent, setActiveProvider, paperDark } = useTheme();
  const demoTracks = useMemo(() => getDemoTracks(), []);
  const nativeAndroid = useMemo(() => isAndroidNative(), []);

  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [offlineTracks, setOfflineTracks] = useState<Track[]>([]);
  const [onlineTracks, setOnlineTracks] = useState<Track[]>(() =>
    readStoredJson<Track[]>('ryotunes_online_history', []).map((t) => ({ ...t, src: '' }))
  );
  const [scanningDevice, setScanningDevice] = useState<boolean>(false);
  const [resolvingTrackId, setResolvingTrackId] = useState<string | null>(null);
  const [lyricsMap, setLyricsMap] = useState<Record<string, LyricsDoc>>({});
  const [lyricsLoadingId, setLyricsLoadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  const tracks = useMemo(() => {
    const map = new Map<string, Track>();
    for (const t of [...demoTracks, ...onlineTracks, ...localTracks, ...offlineTracks]) {
      const cachedLyrics = lyricsMap[t.id];
      map.set(t.id, cachedLyrics && !t.lyrics ? { ...t, lyrics: cachedLyrics } : t);
    }
    return Array.from(map.values());
  }, [offlineTracks, localTracks, onlineTracks, demoTracks, lyricsMap]);

  const [audioQuality, setAudioQuality] = useState<AudioQuality>(() => {
    const q = localStorage.getItem('ryotunes_quality');
    return q === 'LOW' || q === 'AUTO' || q === 'HIGH' ? q : 'HIGH';
  });
  const [autoplay, setAutoplay] = useState<boolean>(
    () => localStorage.getItem('ryotunes_autoplay') !== 'false'
  );
  const [preventDuplicates, setPreventDuplicates] = useState<boolean>(
    () => localStorage.getItem('ryotunes_prevent_duplicates') === 'true'
  );

  const [queueIds, setQueueIds] = useState<string[]>(() => {
    const saved = readStoredJson<string[] | null>('ryotunes_queue_ids', null);
    if (Array.isArray(saved) && saved.length > 0) return saved;
    return demoTracks.map((t) => t.id);
  });

  const [queueIndex, setQueueIndex] = useState<number>(() => {
    const lastId = localStorage.getItem('ryotunes_last_track_id');
    const savedIds = readStoredJson<string[] | null>('ryotunes_queue_ids', null);
    if (lastId && Array.isArray(savedIds)) {
      const idx = savedIds.indexOf(lastId);
      if (idx >= 0) return idx;
    }
    const savedIdx = Number(localStorage.getItem('ryotunes_queue_index'));
    return Number.isFinite(savedIdx) && savedIdx >= 0 ? savedIdx : 0;
  });

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [position, setPosition] = useState<number>(() => {
    const saved = Number(localStorage.getItem('ryotunes_last_position'));
    return Number.isFinite(saved) && saved >= 0 ? saved : 0;
  });
  const [duration, setDuration] = useState<number>(demoTracks[0]?.duration ?? 32);
  const [volume, setVolumeState] = useState<number>(() => {
    const saved = Number(localStorage.getItem('ryotunes_volume'));
    return Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : 75;
  });
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem('ryotunes_muted') === 'true');
  const [shuffle, setShuffle] = useState<boolean>(() => localStorage.getItem('ryotunes_shuffle') === 'true');
  const [repeat, setRepeat] = useState<RepeatMode>(() => {
    const saved = localStorage.getItem('ryotunes_repeat');
    return saved === 'all' || saved === 'one' ? saved : 'off';
  });
  const [stopAfterCurrent, setStopAfterCurrent] = useState<boolean>(false);
  const [likedIds, setLikedIds] = useState<string[]>(() => readStoredJson<string[]>('ryotunes_likes', []));
  const [playlists, setPlaylists] = useState<Playlist[]>(() => {
    const saved = readStoredJson<Playlist[] | null>('ryotunes_playlists', null);
    if (Array.isArray(saved) && saved.length > 0) return saved;
    return [
      {
        id: 'PL:on-repeat',
        title: 'On Repeat',
        subtitle: 'Most played telemetry',
        trackIds: demoTracks.map((t) => t.id),
        smart: true,
        createdAt: Date.now(),
      },
      {
        id: 'PL:night-drive',
        title: 'Purple Midnight',
        subtitle: 'Device playlist',
        trackIds: [demoTracks[0].id, demoTracks[2].id],
        createdAt: Date.now(),
      },
    ];
  });
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    const saved = readStoredJson<string[] | null>('ryotunes_recents', null);
    if (Array.isArray(saved) && saved.length > 0) return saved;
    return demoTracks.map((t) => t.id);
  });
  const [audioFx, setAudioFxState] = useState<AudioFxState>(() =>
    readStoredJson<AudioFxState>('ryotunes_audio_fx', DEFAULT_FX)
  );
  const [spectrumPoints, setSpectrumPoints] = useState<number[]>(() => new Array(40).fill(0));
  const [osdVisible, setOsdVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const webCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bassFilterRef = useRef<BiquadFilterNode | null>(null);
  const dryGainRef = useRef<GainNode | null>(null);
  const wetGainRef = useRef<GainNode | null>(null);
  const widthLlRef = useRef<GainNode | null>(null);
  const widthLrRef = useRef<GainNode | null>(null);
  const widthRlRef = useRef<GainNode | null>(null);
  const widthRrRef = useRef<GainNode | null>(null);
  const osdTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const prevSpectrumRef = useRef<number[]>(new Array(40).fill(0));
  const lastPosSaveRef = useRef<number>(0);
  const initialWebSeekDoneRef = useRef<boolean>(false);
  const webErrorStreakRef = useRef<number>(0);
  const lastTrackSrcRef = useRef<string>('');
  const queueRef = useRef<Track[]>([]);
  const safeQueueIndexRef = useRef<number>(0);
  const resolvingTrackIdRef = useRef<string | null>(null);
  const isPlayingRef = useRef<boolean>(false);
  const autoplayRef = useRef<boolean>(true);
  const hasUserActionRef = useRef<boolean>(false);
  const playbackModeRef = useRef<'native' | 'web'>('web');
  const nextRef = useRef<() => void>(() => {});
  const playGenRef = useRef<number>(0);
  const prefetchCacheRef = useRef<Map<string, Track>>(new Map());
  const prefetchInFlightRef = useRef<Set<string>>(new Set());
  const expectedTrackIdRef = useRef<string | null>(null);
  const expectedTrackUntilRef = useRef<number>(0);
  const expectedPlayToggleRef = useRef<{ target: boolean; until: number } | null>(null);
  const lyricsAttemptedRef = useRef<Set<string>>(new Set());

  const trackMap = useMemo(() => {
    const map = new Map<string, Track>();
    tracks.forEach((t) => map.set(t.id, t));
    return map;
  }, [tracks]);

  const queue = useMemo(() => {
    const mapped = queueIds.map((id) => trackMap.get(id)).filter((t): t is Track => Boolean(t));
    return mapped.length > 0 ? mapped : demoTracks;
  }, [queueIds, trackMap, demoTracks]);

  const safeQueueIndex = queue.length > 0 ? Math.min(queueIndex, queue.length - 1) : 0;
  const currentTrack = queue[safeQueueIndex] ?? queue[0] ?? tracks[0] ?? null;
  const usingNativePlayer =
    nativeAndroid && Boolean(currentTrack?.src && !currentTrack.src.startsWith('blob:'));

  queueRef.current = queue;
  safeQueueIndexRef.current = safeQueueIndex;
  resolvingTrackIdRef.current = resolvingTrackId;
  isPlayingRef.current = isPlaying;
  autoplayRef.current = autoplay;

  useEffect(() => {
    const track = currentTrack;
    if (!track || track.lyrics || track.source === 'demo') return;
    if (lyricsAttemptedRef.current.has(track.id)) return;
    lyricsAttemptedRef.current.add(track.id);

    let cancelled = false;
    setLyricsLoadingId(track.id);
    fetchTrackLyrics(track)
      .then((doc) => {
        if (cancelled) return;
        if (doc && doc.lines.length > 0) {
          setLyricsMap((prev) => ({ ...prev, [track.id]: doc }));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLyricsLoadingId((cur) => (cur === track.id ? null : cur));
        }
      });

    return () => {
      cancelled = true;
      lyricsAttemptedRef.current.delete(track.id);
    };
  }, [currentTrack?.id]);

  const albums = useMemo<AlbumGroup[]>(() => {
    const map = new Map<string, AlbumGroup>();
    tracks.forEach((t) => {
      const key = `${t.album}::${t.artist}`;
      const existing = map.get(key);
      if (existing) {
        existing.tracks.push(t);
        if (!existing.artwork && t.artwork) existing.artwork = t.artwork;
      } else {
        map.set(key, {
          id: `ALB:${encodeURIComponent(t.album)}`,
          title: t.album,
          artist: t.artist,
          artwork: t.artwork,
          tracks: [t],
        });
      }
    });
    return Array.from(map.values());
  }, [tracks]);

  const artists = useMemo<ArtistGroup[]>(() => {
    const map = new Map<string, ArtistGroup>();
    tracks.forEach((t) => {
      const existing = map.get(t.artist);
      if (existing) {
        existing.tracks.push(t);
        if (!existing.artwork && t.artwork) existing.artwork = t.artwork;
      } else {
        map.set(t.artist, {
          id: `ART:${encodeURIComponent(t.artist)}`,
          name: t.artist,
          artwork: t.artwork,
          tracks: [t],
        });
      }
    });
    return Array.from(map.values());
  }, [tracks]);

  const showToast = useCallback((text: string, kind: 'info' | 'success' | 'error' = 'info') => {
    setToast({ id: Date.now(), text, kind });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const triggerOsd = useCallback(() => {
    setOsdVisible(true);
    if (osdTimerRef.current) window.clearTimeout(osdTimerRef.current);
    osdTimerRef.current = window.setTimeout(() => setOsdVisible(false), 2600);
  }, []);

  const dismissOsd = useCallback(() => {
    if (osdTimerRef.current) window.clearTimeout(osdTimerRef.current);
    setOsdVisible(false);
  }, []);

  // Persist queue/flags whenever they change
  useEffect(() => {
    localStorage.setItem('ryotunes_queue_ids', JSON.stringify(queueIds));
  }, [queueIds]);

  useEffect(() => {
    localStorage.setItem('ryotunes_queue_index', String(safeQueueIndex));
    if (currentTrack?.id) {
      localStorage.setItem('ryotunes_last_track_id', currentTrack.id);
    }
  }, [safeQueueIndex, currentTrack?.id]);

  useEffect(() => {
    localStorage.setItem('ryotunes_shuffle', String(shuffle));
  }, [shuffle]);

  useEffect(() => {
    localStorage.setItem('ryotunes_repeat', repeat);
  }, [repeat]);

  useEffect(() => {
    localStorage.setItem('ryotunes_muted', String(muted));
  }, [muted]);

  useEffect(() => {
    localStorage.setItem('ryotunes_audio_fx', JSON.stringify(audioFx));
  }, [audioFx]);

  useEffect(() => {
    localStorage.setItem('ryotunes_quality', audioQuality);
  }, [audioQuality]);

  useEffect(() => {
    localStorage.setItem('ryotunes_autoplay', String(autoplay));
  }, [autoplay]);

  useEffect(() => {
    localStorage.setItem('ryotunes_prevent_duplicates', String(preventDuplicates));
  }, [preventDuplicates]);

  useEffect(() => {
    const compact = onlineTracks.slice(0, 24).map((t) => ({ ...t, src: '' }));
    localStorage.setItem('ryotunes_online_history', JSON.stringify(compact));
  }, [onlineTracks]);

  // Hydrate persistent offline library on startup (IndexedDB on Web / filesDir on Android)
  useEffect(() => {
    loadOfflineLibrary()
      .then((items) => {
        if (items.length > 0) setOfflineTracks(items);
      })
      .catch(() => {});
  }, []);

  // Save playback position throttled + on page hide
  useEffect(() => {
    const now = Date.now();
    if (!isPlaying || now - lastPosSaveRef.current > 1500) {
      localStorage.setItem('ryotunes_last_position', String(position));
      lastPosSaveRef.current = now;
    }
  }, [position, isPlaying]);

  useEffect(() => {
    const flushPosition = () => {
      localStorage.setItem('ryotunes_last_position', String(position));
    };
    window.addEventListener('pagehide', flushPosition);
    document.addEventListener('visibilitychange', flushPosition);
    return () => {
      window.removeEventListener('pagehide', flushPosition);
      document.removeEventListener('visibilitychange', flushPosition);
    };
  }, [position]);

  // ── Android Native MediaStore Scan & Listeners ────────────────────────────
  const syncDeviceLibrary = useCallback(
    async (interactive = true) => {
      if (!nativeAndroid) {
        showToast('Use LOAD AUDIO in browser; MediaStore runs natively on Android', 'info');
        return;
      }
      setScanningDevice(true);
      try {
        const perm = interactive
          ? await RyotunesNativeMedia.requestAudioPermissions()
          : await RyotunesNativeMedia.checkPermissionsStatus();

        if (!perm.audioGranted) {
          if (interactive) showToast('Audio storage permission is required to scan local music', 'error');
          setScanningDevice(false);
          return;
        }

        const scan = await RyotunesNativeMedia.scanLocalMusic();
        const mapped = mapNativeScanTracks(scan);
        setLocalTracks(mapped);

        if (
          mapped.length > 0 &&
          !hasUserActionRef.current &&
          !isPlayingRef.current &&
          !resolvingTrackIdRef.current
        ) {
          const savedLastId = localStorage.getItem('ryotunes_last_track_id');
          const savedPos = Number(localStorage.getItem('ryotunes_last_position')) || 0;
          const mappedMap = new Map(mapped.map((t) => [t.id, t]));
          const savedQueueIds = readStoredJson<string[]>('ryotunes_queue_ids', []);
          const restoredQueue = savedQueueIds
            .map((id) => mappedMap.get(id))
            .filter((t): t is Track => Boolean(t));

          const activeQueue = restoredQueue.length > 0 ? restoredQueue : mapped;
          const activeIdx = savedLastId
            ? Math.max(0, activeQueue.findIndex((t) => t.id === savedLastId))
            : 0;

          const nativeSnap = await RyotunesNativeMedia.getPlaybackState().catch(() => null);
          if (!nativeSnap?.isPlaying && !hasUserActionRef.current && !isPlayingRef.current) {
            playbackModeRef.current = 'native';
            setQueueIds(activeQueue.map((t) => t.id));
            setQueueIndex(activeIdx);
            await RyotunesNativeMedia.setQueue({
              tracks: activeQueue,
              startIndex: activeIdx,
              autoPlay: false,
              startPosition: savedPos,
            });
            await RyotunesNativeMedia.setShuffle({ enabled: localStorage.getItem('ryotunes_shuffle') === 'true' });
            const rep = localStorage.getItem('ryotunes_repeat');
            if (rep === 'all' || rep === 'one' || rep === 'off') {
              await RyotunesNativeMedia.setRepeat({ mode: rep });
            }
            const fx = readStoredJson<AudioFxState>('ryotunes_audio_fx', DEFAULT_FX);
            await RyotunesNativeMedia.setAudioFx(fx);
          }

          showToast(`Synced ${mapped.length} local tracks from device`, 'success');
        } else if (mapped.length > 0) {
          showToast(`Synced ${mapped.length} local tracks from device`, 'success');
        } else if (interactive) {
          showToast('No local audio files (.mp3/.flac/.wav/.ogg/.m4a) found on device', 'info');
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Device scan failed', 'error');
      } finally {
        setScanningDevice(false);
      }
    },
    [nativeAndroid, showToast]
  );

  useEffect(() => {
    if (!nativeAndroid) return;
    let active = true;
    const handles: PluginListenerHandle[] = [];

    (async () => {
      const h1 = await RyotunesNativeMedia.addListener('playbackState', (ev) => {
        if (!active) return;
        if (playbackModeRef.current === 'web' || resolvingTrackIdRef.current) return;
        if (
          expectedTrackIdRef.current &&
          ev.trackId &&
          ev.trackId !== expectedTrackIdRef.current &&
          Date.now() < expectedTrackUntilRef.current
        ) {
          return;
        }
        if (ev.trackId && ev.trackId === expectedTrackIdRef.current) {
          expectedTrackIdRef.current = null;
        }

        const pendingToggle = expectedPlayToggleRef.current;
        if (pendingToggle) {
          if (ev.isPlaying === pendingToggle.target || Date.now() >= pendingToggle.until) {
            expectedPlayToggleRef.current = null;
            setIsPlaying(ev.isPlaying);
          }
        } else {
          setIsPlaying(ev.isPlaying);
        }
        setPosition(ev.position);
        if (ev.duration > 0) setDuration(ev.duration);

        const curQueue = queueRef.current;
        if (ev.trackId) {
          const matchedIdx = curQueue.findIndex((t) => t.id === ev.trackId);
          if (matchedIdx >= 0) {
            setQueueIndex(matchedIdx);
          }
        }

        setShuffle(ev.shuffle);
        setRepeat(ev.repeat);
        setStopAfterCurrent(ev.stopAfterCurrent);

        if (ev.ended && autoplayRef.current && curQueue.length > 1) {
          nextRef.current();
        }
      });
      const h2 = await RyotunesNativeMedia.addListener('spectrum', (ev) => {
        if (!active) return;
        if (Array.isArray(ev.bands) && ev.bands.length === 40) {
          setSpectrumPoints(ev.bands);
        }
      });
      const h3 = await RyotunesNativeMedia.addListener('playbackError', (ev) => {
        if (!active) return;
        showToast(ev.message || 'Audio playback error', 'error');
      });
      const h4 = await RyotunesNativeMedia.addListener('downloadProgress', (ev) => {
        if (!active) return;
        setDownloadProgress((prev) => ({ ...prev, [ev.trackId]: ev.progress }));
        if (ev.status === 'failed' && ev.error) {
          showToast(ev.error, 'error');
        }
      });
      handles.push(h1, h2, h3, h4);

      try {
        const sysVol = await RyotunesNativeMedia.getSystemVolume();
        if (active) {
          setVolumeState(sysVol.volume);
          setMuted(sysVol.muted);
        }
      } catch {}

      await syncDeviceLibrary(true);
    })();

    return () => {
      active = false;
      handles.forEach((h) => h.remove().catch(() => {}));
    };
  }, [nativeAndroid, showToast, syncDeviceLibrary]);

  // ── WebAudio Graph (Bass + Convolver Reverb + Mid/Side Stereo Width) ──────
  const ensureWebAudioGraph = useCallback(() => {
    const audio = audioElRef.current;
    if (!audio) return;
    if (!webCtxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;

      const bass = ctx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 110;
      bass.gain.value = audioFx.bass;

      const convolver = ctx.createConvolver();
      convolver.buffer = createImpulseResponse(ctx);
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      dry.gain.value = 1 - audioFx.reverb * 0.4;
      wet.gain.value = audioFx.reverb * 0.65;

      // Stereo Width 2x2 Mid/Side Matrix
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);
      const norm = 1 / (1 + 0.25 * audioFx.width);
      const direct = (1 + 0.75 * audioFx.width) * norm;
      const cross = -0.75 * audioFx.width * norm;
      const ll = ctx.createGain();
      const lr = ctx.createGain();
      const rl = ctx.createGain();
      const rr = ctx.createGain();
      ll.gain.value = direct;
      rr.gain.value = direct;
      lr.gain.value = cross;
      rl.gain.value = cross;

      const sumBus = ctx.createGain();
      source.connect(bass);
      bass.connect(dry);
      bass.connect(convolver);
      convolver.connect(wet);
      dry.connect(sumBus);
      wet.connect(sumBus);

      sumBus.connect(splitter);
      splitter.connect(ll, 0);
      splitter.connect(lr, 0);
      splitter.connect(rl, 1);
      splitter.connect(rr, 1);
      ll.connect(merger, 0, 0);
      rl.connect(merger, 0, 0);
      rr.connect(merger, 0, 1);
      lr.connect(merger, 0, 1);
      merger.connect(analyser);
      analyser.connect(ctx.destination);

      webCtxRef.current = ctx;
      analyserRef.current = analyser;
      bassFilterRef.current = bass;
      dryGainRef.current = dry;
      wetGainRef.current = wet;
      widthLlRef.current = ll;
      widthLrRef.current = lr;
      widthRlRef.current = rl;
      widthRrRef.current = rr;
    }
    if (webCtxRef.current.state === 'suspended') {
      webCtxRef.current.resume().catch(() => {});
    }
  }, [audioFx.bass, audioFx.reverb, audioFx.width]);

  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audioElRef.current = audio;

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  useEffect(() => {
    if (!currentTrack) return;

    const prov = currentTrack.provider || currentTrack.source || 'local';
    setActiveProvider(prov);

    // If track is online & un-resolved while attempting playback, resolve stream automatically
    if (!currentTrack.src && isPlaying && resolvingTrackId !== currentTrack.id) {
      resolvingTrackIdRef.current = currentTrack.id;
      setResolvingTrackId(currentTrack.id);
      resolvePlayableTrack(currentTrack, audioQuality)
        .then((resolved) => {
          setOnlineTracks((prev) => {
            const idx = prev.findIndex((t) => t.id === resolved.id);
            if (idx >= 0) {
              const nextList = [...prev];
              nextList[idx] = resolved;
              return nextList;
            }
            return [resolved, ...prev].slice(0, 32);
          });
          resolvingTrackIdRef.current = null;
          setResolvingTrackId(null);
          if (nativeAndroid && resolved.src) {
            playbackModeRef.current = 'native';
            audioElRef.current?.pause();
            RyotunesNativeMedia.setQueue({ tracks: [resolved], startIndex: 0, autoPlay: true }).catch(() => {});
          }
        })
        .catch((err) => {
          resolvingTrackIdRef.current = null;
          setResolvingTrackId(null);
          setIsPlaying(false);
          showToast(err instanceof Error ? err.message : `Stream error for "${currentTrack.title}"`, 'error');
        });
      return;
    }

    if (!usingNativePlayer && currentTrack.src) {
      const audio = audioElRef.current;
      if (audio && lastTrackSrcRef.current !== currentTrack.src) {
        const isFirstColdRestore = !initialWebSeekDoneRef.current && lastTrackSrcRef.current === '';
        initialWebSeekDoneRef.current = true;
        lastTrackSrcRef.current = currentTrack.src;

        try {
          audio.src = currentTrack.src;
          const restorePos = isFirstColdRestore
            ? Math.min(currentTrack.duration || 0, Number(localStorage.getItem('ryotunes_last_position')) || 0)
            : 0;
          audio.currentTime = restorePos;
          setPosition(restorePos);
          setDuration(currentTrack.duration || 0);
          if (isPlaying) {
            ensureWebAudioGraph();
            audio.play().catch(() => setIsPlaying(false));
          }
        } catch {
          showToast(`Failed loading "${currentTrack.title}"`, 'error');
        }
      }
    } else if (usingNativePlayer) {
      audioElRef.current?.pause();
    }

    setRecentIds((prev) => {
      const next = [currentTrack.id, ...prev.filter((id) => id !== currentTrack.id)].slice(0, 12);
      localStorage.setItem('ryotunes_recents', JSON.stringify(next));
      return next;
    });

    sampleArtworkAccent(currentTrack.artwork, paperDark).then((c) => {
      setArtAccent(c);
    });
  }, [
    currentTrack,
    usingNativePlayer,
    nativeAndroid,
    isPlaying,
    resolvingTrackId,
    audioQuality,
    ensureWebAudioGraph,
    paperDark,
    setArtAccent,
    setActiveProvider,
    showToast,
  ]);

  useEffect(() => {
    const audio = audioElRef.current;
    if (audio) {
      audio.volume = muted ? 0 : Math.max(0, Math.min(1, volume / 100));
    }
    localStorage.setItem('ryotunes_volume', String(volume));
  }, [volume, muted]);

  useEffect(() => {
    if (usingNativePlayer) {
      RyotunesNativeMedia.setAudioFx(audioFx).catch(() => {});
      return;
    }
    const audio = audioElRef.current;
    if (audio) {
      const pitchFactor = Math.pow(2, audioFx.semitones / 12);
      audio.playbackRate = Math.max(0.25, Math.min(2.5, audioFx.speed * pitchFactor));
      (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = audioFx.semitones === 0;
    }
    if (bassFilterRef.current) bassFilterRef.current.gain.value = audioFx.bass;
    if (dryGainRef.current) dryGainRef.current.gain.value = 1 - audioFx.reverb * 0.4;
    if (wetGainRef.current) wetGainRef.current.gain.value = audioFx.reverb * 0.65;
    if (widthLlRef.current && widthRrRef.current && widthLrRef.current && widthRlRef.current) {
      const norm = 1 / (1 + 0.25 * audioFx.width);
      const direct = (1 + 0.75 * audioFx.width) * norm;
      const cross = -0.75 * audioFx.width * norm;
      widthLlRef.current.gain.value = direct;
      widthRrRef.current.gain.value = direct;
      widthLrRef.current.gain.value = cross;
      widthRlRef.current.gain.value = cross;
    }
  }, [audioFx, usingNativePlayer]);

  const startWebTrackSync = useCallback(
    (track: Track) => {
      playbackModeRef.current = 'web';
      if (nativeAndroid) {
        RyotunesNativeMedia.pause().catch(() => {});
      }
      ensureWebAudioGraph();
      const audio = audioElRef.current;
      if (!audio || !track.src) return;
      if (lastTrackSrcRef.current !== track.src || audio.src !== track.src) {
        lastTrackSrcRef.current = track.src;
        audio.src = track.src;
        audio.currentTime = 0;
        setPosition(0);
        setDuration(track.duration || 0);
      }
      audio
        .play()
        .then(() => {
          webErrorStreakRef.current = 0;
          setIsPlaying(true);
        })
        .catch(() => showToast('Tap again to unlock audio playback', 'info'));
    },
    [nativeAndroid, ensureWebAudioGraph, showToast]
  );

  const prefetchNextInList = useCallback(
    (activeTrackId: string, list: Track[]) => {
      const idx = list.findIndex((t) => t.id === activeTrackId);
      if (idx < 0 || idx + 1 >= list.length) return;
      const nextItem = list[idx + 1];
      if (
        !nextItem ||
        nextItem.src ||
        nextItem.offline ||
        nextItem.source === 'local' ||
        nextItem.source === 'demo' ||
        prefetchCacheRef.current.has(nextItem.id) ||
        prefetchInFlightRef.current.has(nextItem.id)
      ) {
        return;
      }
      prefetchInFlightRef.current.add(nextItem.id);
      resolvePlayableTrack(nextItem, audioQuality)
        .then((resolvedNext) => {
          if (resolvedNext.src) {
            if (prefetchCacheRef.current.size > 24) {
              const firstKey = prefetchCacheRef.current.keys().next().value;
              if (firstKey) prefetchCacheRef.current.delete(firstKey);
            }
            prefetchCacheRef.current.set(nextItem.id, resolvedNext);
          }
        })
        .catch(() => {
          // Silent background prefetch failure; foreground click will report errors if any
        })
        .finally(() => {
          prefetchInFlightRef.current.delete(nextItem.id);
        });
    },
    [audioQuality]
  );

  const activateTrackInQueue = useCallback(
    (rawTrack: Track, list: Track[]) => {
      const myGen = ++playGenRef.current;
      const prefetched = !rawTrack.src ? prefetchCacheRef.current.get(rawTrack.id) : undefined;
      const effectiveTrack = prefetched?.src ? prefetched : rawTrack;

      hasUserActionRef.current = true;
      webErrorStreakRef.current = 0;
      expectedTrackIdRef.current = effectiveTrack.id;
      expectedTrackUntilRef.current = Date.now() + 1800;
      setPosition(0);
      setDuration(effectiveTrack.duration || 0);

      if (!effectiveTrack.src) {
        audioElRef.current?.pause();
        if (nativeAndroid) {
          playbackModeRef.current = 'native';
          RyotunesNativeMedia.pause().catch(() => {});
        } else {
          playbackModeRef.current = 'web';
          ensureWebAudioGraph();
        }
        setIsPlaying(true);
        resolvingTrackIdRef.current = effectiveTrack.id;
        setResolvingTrackId(effectiveTrack.id);
        resolvePlayableTrack(effectiveTrack, audioQuality)
          .then((resolved) => {
            if (myGen !== playGenRef.current) return;
            if (resolved.src) {
              prefetchCacheRef.current.set(resolved.id, resolved);
            }
            setOnlineTracks((prev) => {
              const i = prev.findIndex((x) => x.id === resolved.id);
              if (i >= 0) {
                const copy = [...prev];
                copy[i] = resolved;
                return copy;
              }
              return [resolved, ...prev].slice(0, 40);
            });
            resolvingTrackIdRef.current = null;
            setResolvingTrackId(null);
            if (nativeAndroid && resolved.src && !resolved.src.startsWith('blob:')) {
              playbackModeRef.current = 'native';
              RyotunesNativeMedia.setQueue({ tracks: [resolved], startIndex: 0, autoPlay: true }).catch(() => {});
            } else if (!nativeAndroid) {
              startWebTrackSync(resolved);
            }
            prefetchNextInList(resolved.id, list);
          })
          .catch((err) => {
            if (myGen !== playGenRef.current) return;
            resolvingTrackIdRef.current = null;
            setResolvingTrackId(null);
            setIsPlaying(false);
            showToast(err instanceof Error ? err.message : `Could not play "${effectiveTrack.title}"`, 'error');
          });
        return;
      }

      resolvingTrackIdRef.current = null;
      setResolvingTrackId(null);

      if (nativeAndroid && !effectiveTrack.src.startsWith('blob:')) {
        playbackModeRef.current = 'native';
        audioElRef.current?.pause();
        const nativeList = list
          .map((t) => (!t.src ? prefetchCacheRef.current.get(t.id) || t : t))
          .filter((t) => t.src && !t.src.startsWith('blob:'));
        const nativeIdx = Math.max(0, nativeList.findIndex((t) => t.id === effectiveTrack.id));
        RyotunesNativeMedia.setQueue({
          tracks: nativeList.length > 0 ? nativeList : [effectiveTrack],
          startIndex: nativeIdx,
          autoPlay: true,
        }).catch(() => {});
        setIsPlaying(true);
        prefetchNextInList(effectiveTrack.id, list);
        return;
      }

      startWebTrackSync(effectiveTrack);
      prefetchNextInList(effectiveTrack.id, list);
    },
    [nativeAndroid, audioQuality, ensureWebAudioGraph, startWebTrackSync, prefetchNextInList, showToast]
  );

  const playQueueIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= queue.length) return;
      const target = queue[index];
      const offlineHit = offlineTracks.find((o) => o.id === target.id);
      const cachedHit = !offlineHit && !target.src ? prefetchCacheRef.current.get(target.id) : undefined;
      const effectiveTrack = offlineHit || cachedHit || target;
      setQueueIndex(index);
      activateTrackInQueue(effectiveTrack, queue);
    },
    [queue, offlineTracks, activateTrackInQueue]
  );

  const next = useCallback(() => {
    hasUserActionRef.current = true;
    const allNative =
      usingNativePlayer &&
      queue.length > 0 &&
      queue.every((t) => Boolean(t.src) && !t.src.startsWith('blob:'));
    if (allNative) {
      RyotunesNativeMedia.next().catch(() => {});
      return;
    }
    if (queue.length === 0) return;
    if (shuffle && queue.length > 1) {
      let pick = safeQueueIndex;
      while (pick === safeQueueIndex) pick = Math.floor(Math.random() * queue.length);
      playQueueIndex(pick);
      return;
    }
    if (safeQueueIndex + 1 < queue.length) {
      playQueueIndex(safeQueueIndex + 1);
    } else if (repeat === 'all') {
      playQueueIndex(0);
    } else {
      setIsPlaying(false);
    }
  }, [usingNativePlayer, queue, safeQueueIndex, shuffle, repeat, playQueueIndex]);

  nextRef.current = next;

  const prev = useCallback(() => {
    hasUserActionRef.current = true;
    const allNative =
      usingNativePlayer &&
      queue.length > 0 &&
      queue.every((t) => Boolean(t.src) && !t.src.startsWith('blob:'));
    if (allNative) {
      RyotunesNativeMedia.prev().catch(() => {});
      return;
    }
    const audio = audioElRef.current;
    if (playbackModeRef.current === 'web' && audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setPosition(0);
      return;
    }
    if (queue.length === 0) return;
    const prevIdx = safeQueueIndex > 0 ? safeQueueIndex - 1 : repeat === 'all' ? queue.length - 1 : 0;
    playQueueIndex(prevIdx);
  }, [usingNativePlayer, queue, safeQueueIndex, repeat, playQueueIndex]);

  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || usingNativePlayer) return;

    const onTime = () => setPosition(audio.currentTime || 0);
    const onMeta = () => {
      webErrorStreakRef.current = 0;
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const onEnded = () => {
      if (stopAfterCurrent) {
        setStopAfterCurrent(false);
        setIsPlaying(false);
        return;
      }
      if (repeat === 'one') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }
      next();
    };
    const onError = () => {
      if (!audio.src || audio.src === window.location.href) return;
      webErrorStreakRef.current += 1;
      showToast(`Skipped unreadable track: ${currentTrack?.title || 'Unknown'}`, 'error');
      if (webErrorStreakRef.current < queue.length) {
        next();
      } else {
        webErrorStreakRef.current = 0;
        setIsPlaying(false);
      }
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [next, repeat, stopAfterCurrent, usingNativePlayer, showToast, currentTrack?.title, queue.length]);

  useEffect(() => {
    if (usingNativePlayer) return;
    let raf = 0;
    const freqData = new Uint8Array(128);

    const tick = () => {
      const analyser = analyserRef.current;
      const prevPts = prevSpectrumRef.current;
      if (isPlaying && analyser) {
        analyser.getByteFrequencyData(freqData);
        const bins = 40;
        const nextPts = new Array<number>(bins);
        for (let i = 0; i < bins; i++) {
          const idx = Math.min(90, 1 + Math.floor((i / bins) * 72));
          const raw = (freqData[idx] / 255) * 1000;
          const weighted = Math.min(1000, raw * (0.88 + (i / bins) * 0.45));
          nextPts[i] = prevPts[i] * 0.42 + weighted * 0.58;
        }
        prevSpectrumRef.current = nextPts;
        setSpectrumPoints(nextPts);
        raf = requestAnimationFrame(tick);
      } else {
        let anyActive = false;
        const decayed = prevPts.map((v) => {
          const n = v * 0.8;
          if (n > 4) anyActive = true;
          return n > 4 ? n : 0;
        });
        prevSpectrumRef.current = decayed;
        setSpectrumPoints(decayed);
        if (anyActive) raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, usingNativePlayer]);

  const togglePlay = useCallback(() => {
    hasUserActionRef.current = true;
    if (usingNativePlayer) {
      const nextState = !isPlayingRef.current;
      expectedPlayToggleRef.current = { target: nextState, until: Date.now() + 450 };
      setIsPlaying((prev) => !prev);
      playbackModeRef.current = 'native';
      audioElRef.current?.pause();
      RyotunesNativeMedia.togglePlay().catch(() => {});
      return;
    }
    const audio = audioElRef.current;
    if (!currentTrack) return;
    if (!currentTrack.src) {
      activateTrackInQueue(currentTrack, queue);
      return;
    }
    if (isPlaying && audio) {
      setIsPlaying(false);
      audio.pause();
    } else {
      setIsPlaying(true);
      startWebTrackSync(currentTrack);
    }
  }, [usingNativePlayer, currentTrack, isPlaying, queue, activateTrackInQueue, startWebTrackSync]);

  const playTrack = useCallback(
    (track: Track, customQueue?: Track[]) => {
      const offlineHit = offlineTracks.find((o) => o.id === track.id);
      const cachedHit = !offlineHit && !track.src ? prefetchCacheRef.current.get(track.id) : undefined;
      const effectiveTrack = offlineHit || cachedHit || track;
      const baseList = customQueue && customQueue.length > 0 ? customQueue : tracks;
      const hasInList = baseList.some((t) => t.id === effectiveTrack.id);
      const list = hasInList
        ? baseList.map((t) => (t.id === effectiveTrack.id ? effectiveTrack : t))
        : [effectiveTrack, ...baseList];

      // Ensure online/external tracks live inside onlineTracks so queue/trackMap include them
      setOnlineTracks((prev) => {
        const merged = [...prev];
        for (const item of list) {
          if (item.source && item.source !== 'local' && item.source !== 'demo') {
            const existingIdx = merged.findIndex((x) => x.id === item.id);
            if (existingIdx >= 0) merged[existingIdx] = item;
            else merged.unshift(item);
          }
        }
        return merged.slice(0, 40);
      });

      const idx = Math.max(0, list.findIndex((t) => t.id === effectiveTrack.id));
      setQueueIds(list.map((t) => t.id));
      setQueueIndex(idx);
      activateTrackInQueue(effectiveTrack, list);
    },
    [tracks, offlineTracks, activateTrackInQueue]
  );

  const seek = useCallback(
    (secs: number) => {
      const clamped = Math.max(0, secs);
      setPosition(clamped);
      localStorage.setItem('ryotunes_last_position', String(clamped));
      if (usingNativePlayer) {
        RyotunesNativeMedia.seek({ position: clamped }).catch(() => {});
        return;
      }
      const audio = audioElRef.current;
      if (audio && Number.isFinite(clamped)) {
        audio.currentTime = clamped;
      }
    },
    [usingNativePlayer]
  );

  const setVolume = useCallback(
    (vol: number, showOsdFlag = true) => {
      const clamped = Math.max(0, Math.min(100, Math.round(vol)));
      setVolumeState(clamped);
      if (clamped > 0 && muted) setMuted(false);
      if (nativeAndroid) {
        RyotunesNativeMedia.setSystemVolume({ volume: clamped, muted: false }).catch(() => {});
      }
      if (showOsdFlag) triggerOsd();
    },
    [muted, nativeAndroid, triggerOsd]
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const nextMuted = !m;
      if (nativeAndroid) {
        RyotunesNativeMedia.setSystemVolume({ volume, muted: nextMuted }).catch(() => {});
      }
      return nextMuted;
    });
    triggerOsd();
  }, [nativeAndroid, volume, triggerOsd]);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => {
      const nextVal = !s;
      if (usingNativePlayer) RyotunesNativeMedia.setShuffle({ enabled: nextVal }).catch(() => {});
      return nextVal;
    });
  }, [usingNativePlayer]);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => {
      const nextMode: RepeatMode = r === 'off' ? 'all' : r === 'all' ? 'one' : 'off';
      if (usingNativePlayer) RyotunesNativeMedia.setRepeat({ mode: nextMode }).catch(() => {});
      return nextMode;
    });
  }, [usingNativePlayer]);

  const toggleStopAfterCurrent = useCallback(() => {
    setStopAfterCurrent((s) => {
      const nextVal = !s;
      if (usingNativePlayer) RyotunesNativeMedia.setStopAfterCurrent({ enabled: nextVal }).catch(() => {});
      return nextVal;
    });
  }, [usingNativePlayer]);

  const toggleLike = useCallback((trackId: string) => {
    setLikedIds((prev) => {
      const next = prev.includes(trackId) ? prev.filter((id) => id !== trackId) : [...prev, trackId];
      localStorage.setItem('ryotunes_likes', JSON.stringify(next));
      return next;
    });
  }, []);

  const createPlaylist = useCallback(
    (title: string, initialTrackId?: string) => {
      const id = `PL:${Date.now()}`;
      const newPl: Playlist = {
        id,
        title: title.trim() || 'New playlist',
        subtitle: 'Device playlist',
        trackIds: initialTrackId ? [initialTrackId] : [],
        createdAt: Date.now(),
      };
      setPlaylists((prev) => {
        const next = [...prev, newPl];
        localStorage.setItem('ryotunes_playlists', JSON.stringify(next));
        return next;
      });
      showToast(`Created "${newPl.title}"`, 'success');
      return id;
    },
    [showToast]
  );

  const addTrackToPlaylist = useCallback(
    (playlistId: string, trackId: string) => {
      setPlaylists((prev) => {
        const next = prev.map((pl) =>
          pl.id === playlistId && !pl.trackIds.includes(trackId)
            ? { ...pl, trackIds: [...pl.trackIds, trackId] }
            : pl
        );
        localStorage.setItem('ryotunes_playlists', JSON.stringify(next));
        return next;
      });
      showToast('Added to playlist', 'success');
    },
    [showToast]
  );

  const removeTrackFromPlaylist = useCallback((playlistId: string, trackId: string) => {
    setPlaylists((prev) => {
      const next = prev.map((pl) =>
        pl.id === playlistId ? { ...pl, trackIds: pl.trackIds.filter((id) => id !== trackId) } : pl
      );
      localStorage.setItem('ryotunes_playlists', JSON.stringify(next));
      return next;
    });
  }, []);

  const moveQueueItem = useCallback((from: number, to: number) => {
    setQueueIds((prev) => {
      if (from < 0 || to < 0 || from >= prev.length || to >= prev.length || from === to) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setQueueIds((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearUpcomingQueue = useCallback(() => {
    setQueueIds((prev) => prev.slice(0, safeQueueIndex + 1));
    showToast('Cleared upcoming queue', 'info');
  }, [safeQueueIndex, showToast]);

  const setAudioFx = useCallback((fx: AudioFxState) => {
    setAudioFxState(fx);
  }, []);

  const importLocalFiles = useCallback(
    async (files: FileList | File[]) => {
      const audioFiles = Array.from(files).filter(
        (f) =>
          /\.(mp3|flac|wav|ogg|m4a|aac|opus|webm)$/i.test(f.name) || f.type.startsWith('audio/')
      );
      if (audioFiles.length === 0) {
        showToast('No supported audio files (.mp3, .flac, .wav, .ogg, .m4a)', 'error');
        return;
      }
      try {
        const parsed = await Promise.all(audioFiles.map(parseAudioFile));
        setLocalTracks((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const unique = parsed.filter((t) => !existingIds.has(t.id));
          return [...unique, ...prev];
        });
        setQueueIds((prev) => {
          const newIds = parsed.map((t) => t.id).filter((id) => !prev.includes(id));
          return [...newIds, ...prev];
        });
        setQueueIndex(0);
        showToast(`Loaded ${parsed.length} local track${parsed.length === 1 ? '' : 's'}`, 'success');
      } catch {
        showToast('Could not read one or more selected audio files', 'error');
      }
    },
    [showToast]
  );

  const downloadTrack = useCallback(
    async (track: Track) => {
      if (track.offline || track.source === 'local') {
        showToast('Track is already saved locally', 'info');
        return;
      }
      if (downloadProgress[track.id] !== undefined && downloadProgress[track.id] < 100) {
        showToast(`Already downloading "${track.title}"`, 'info');
        return;
      }
      setDownloadProgress((prev) => ({ ...prev, [track.id]: 5 }));
      try {
        const saved = await downloadTrackOffline(track, audioQuality, (pct) => {
          setDownloadProgress((prev) => ({ ...prev, [track.id]: pct }));
        });
        setOfflineTracks((prev) => [saved, ...prev.filter((t) => t.id !== saved.id)]);
        setDownloadProgress((prev) => ({ ...prev, [track.id]: 100 }));
        showToast(`Saved offline: "${saved.title}"`, 'success');
      } catch (err) {
        setDownloadProgress((prev) => {
          const copy = { ...prev };
          delete copy[track.id];
          return copy;
        });
        showToast(err instanceof Error ? err.message : `Failed saving "${track.title}"`, 'error');
      }
    },
    [audioQuality, downloadProgress, showToast]
  );

  const downloadTracksBatch = useCallback(
    async (tracksToSave: Track[], label = 'collection') => {
      const candidates = tracksToSave.filter((t) => !t.offline && t.source !== 'local');
      if (candidates.length === 0) {
        showToast(`All ${label} tracks are already available offline`, 'info');
        return;
      }
      showToast(`Saving ${candidates.length} tracks from ${label}…`, 'info');
      let savedCount = 0;
      for (const item of candidates) {
        try {
          await downloadTrack(item);
          savedCount++;
        } catch {
          // continue batch
        }
      }
      showToast(`Offline ${label}: ${savedCount}/${candidates.length} saved`, savedCount > 0 ? 'success' : 'error');
    },
    [downloadTrack, showToast]
  );

  const removeOffline = useCallback(
    async (trackId: string) => {
      await removeOfflineTrack(trackId);
      setOfflineTracks((prev) => prev.filter((t) => t.id !== trackId));
      setDownloadProgress((prev) => {
        const copy = { ...prev };
        delete copy[trackId];
        return copy;
      });
      showToast('Removed from Offline library', 'info');
    },
    [showToast]
  );

  const clearOfflineAndCache = useCallback(async () => {
    await clearOfflineAndCaches();
    setOfflineTracks([]);
    setDownloadProgress({});
    showToast('Cleared stream caches and offline downloads', 'success');
  }, [showToast]);

  return (
    <AudioPlayerContext.Provider
      value={{
        tracks,
        offlineTracks,
        localCount: localTracks.length,
        scanningDevice,
        isNativeAndroid: nativeAndroid,
        resolvingTrackId,
        lyricsLoading: Boolean(currentTrack && lyricsLoadingId === currentTrack.id),
        downloadProgress,
        currentTrack,
        queue,
        queueIndex: safeQueueIndex,
        isPlaying,
        position,
        duration,
        volume,
        muted,
        shuffle,
        repeat,
        stopAfterCurrent,
        audioQuality,
        autoplay,
        preventDuplicates,
        likedIds,
        playlists,
        recentIds,
        albums,
        artists,
        audioFx,
        spectrumPoints,
        osdVisible,
        toast,
        playTrack,
        playQueueIndex,
        togglePlay,
        next,
        prev,
        seek,
        setVolume,
        toggleMute,
        triggerOsd,
        dismissOsd,
        toggleShuffle,
        cycleRepeat,
        toggleStopAfterCurrent,
        setAudioQuality,
        setAutoplay,
        setPreventDuplicates,
        toggleLike,
        createPlaylist,
        addTrackToPlaylist,
        removeTrackFromPlaylist,
        moveQueueItem,
        removeFromQueue,
        clearUpcomingQueue,
        setAudioFx,
        importLocalFiles,
        syncDeviceLibrary,
        downloadTrack,
        downloadTracksBatch,
        removeOffline,
        clearOfflineAndCache,
        showToast,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
};

export function useAudio(): AudioContextValue {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudio must be used inside AudioProvider');
  return ctx;
}

export function fmtTime(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return '0:00';
  const s = Math.floor(secs);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' + r : r}`;
}
