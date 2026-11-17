import {
  isAndroidNative,
  mapNativeOfflineTrack,
  RyotunesNativeMedia,
} from './NativeMediaBridge';
import {
  clearOfflineDb,
  getAllOfflineTracks,
  removeOfflineRecord,
  saveOfflineRecord,
} from './offlineDb';
import { AudioQuality, LyricLine, LyricsDoc, OnlineProviderFilter, ProviderId, Track } from './types';

export function buildDeterministicWaveform(seedKey: string, count = 240): number[] {
  let h = 2166136261;
  for (let i = 0; i < seedKey.length; i++) {
    h ^= seedKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const phase = i / count;
    const envelope = Math.sin(Math.PI * Math.pow(phase, 0.72));
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const rand = ((h >>> 0) % 1000) / 1000;
    const harmonic = 0.45 + 0.35 * Math.sin(i * 0.27) + 0.2 * Math.cos(i * 0.63);
    const val = Math.round(14 + 84 * envelope * (0.55 * harmonic + 0.45 * rand));
    out.push(Math.max(8, Math.min(100, val)));
  }
  return out;
}

export async function searchOnlineTracks(
  query: string,
  provider: OnlineProviderFilter
): Promise<Track[]> {
  const q = query.trim();
  if (!q || provider === 'offline') return [];

  if (isAndroidNative()) {
    const res = await RyotunesNativeMedia.searchOnline({ query: q, provider });
    return (res.items || []).map((item) => ({
      id: item.id,
      remoteId: item.remoteId || item.id,
      provider: item.provider,
      source: item.provider,
      title: item.title,
      artist: item.artist,
      album: item.album,
      duration: item.duration,
      artwork: item.artwork,
      src: '',
      format: item.format || item.provider.toUpperCase(),
      waveform: buildDeterministicWaveform(item.id),
    }));
  }

  const res = await fetch(
    `/api/provider/search?q=${encodeURIComponent(q)}&provider=${encodeURIComponent(provider)}`
  );
  if (!res.ok) {
    throw new Error(`Search failed (${res.status})`);
  }
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      provider: ProviderId;
      remoteId: string;
      title: string;
      artist: string;
      album: string;
      duration: number;
      artwork?: string;
      format?: string;
    }>;
    error?: string;
  };
  if (data.error) throw new Error(data.error);
  return (data.items || []).map((item) => ({
    id: item.id,
    remoteId: item.remoteId,
    provider: item.provider,
    source: item.provider,
    title: item.title,
    artist: item.artist,
    album: item.album,
    duration: item.duration,
    artwork: item.artwork,
    src: '',
    format: item.format || item.provider.toUpperCase(),
    waveform: buildDeterministicWaveform(item.id),
  }));
}

export async function resolvePlayableTrack(
  track: Track,
  quality: AudioQuality
): Promise<Track> {
  if (track.offline && track.src) return track;
  if (track.source === 'local' || track.source === 'demo') return track;
  if (track.src && (track.src.startsWith('blob:') || track.src.startsWith('content:') || track.src.startsWith('file://'))) {
    return track;
  }

  if (isAndroidNative()) {
    const resolved = await RyotunesNativeMedia.resolveStream({
      id: track.id,
      provider: track.provider || track.source || 'youtube',
      title: track.title,
      artist: track.artist,
      quality,
    });
    return {
      ...track,
      src: resolved.streamUrl,
      mimeType: resolved.mimeType,
      duration: resolved.duration || track.duration,
      waveform: resolved.waveform?.length ? resolved.waveform : track.waveform,
    };
  }

  const res = await fetch(
    `/api/provider/stream?id=${encodeURIComponent(track.id)}&provider=${encodeURIComponent(
      track.provider || track.source || 'youtube'
    )}&title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(
      track.artist
    )}&quality=${encodeURIComponent(quality)}`
  );
  const data = (await res.json()) as {
    proxyUrl?: string;
    streamUrl?: string;
    mimeType?: string;
    duration?: number;
    waveform?: number[];
    error?: string;
  };
  if (!res.ok || data.error || !(data.proxyUrl || data.streamUrl)) {
    throw new Error(data.error || 'Could not resolve audio stream');
  }
  return {
    ...track,
    src: data.proxyUrl || data.streamUrl || '',
    mimeType: data.mimeType,
    duration: data.duration || track.duration,
    waveform: data.waveform?.length ? data.waveform : track.waveform || buildDeterministicWaveform(track.id),
  };
}

export async function loadOfflineLibrary(): Promise<Track[]> {
  if (isAndroidNative()) {
    const res = await RyotunesNativeMedia.listOfflineTracks();
    return (res.tracks || []).map(mapNativeOfflineTrack);
  }
  return getAllOfflineTracks();
}

export async function downloadTrackOffline(
  track: Track,
  quality: AudioQuality,
  onProgress?: (pct: number) => void
): Promise<Track> {
  if (isAndroidNative()) {
    onProgress?.(10);
    const res = await RyotunesNativeMedia.downloadOffline({
      track: {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        artwork: track.artwork,
        provider: track.provider || (track.source as string),
        format: track.format,
        waveform: track.waveform,
      },
      quality,
    });
    onProgress?.(100);
    return mapNativeOfflineTrack(res.track);
  }

  onProgress?.(10);
  const resolved = await resolvePlayableTrack(track, quality);
  onProgress?.(25);

  const audioRes = await fetch(resolved.src);
  if (!audioRes.ok) throw new Error(`Download failed (${audioRes.status})`);

  const total = Number(audioRes.headers.get('content-length') || 0);
  let audioBlob: Blob;
  if (audioRes.body && total > 0) {
    const reader = audioRes.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.(Math.min(92, Math.round(25 + (loaded / total) * 65)));
      }
    }
    const merged = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    audioBlob = new Blob([merged.buffer], {
      type: audioRes.headers.get('content-type') || 'audio/mp4',
    });
  } else {
    audioBlob = await audioRes.blob();
    onProgress?.(88);
  }

  let artworkBlob: Blob | undefined;
  if (resolved.artwork) {
    try {
      const artRes = await fetch(resolved.artwork);
      if (artRes.ok) artworkBlob = await artRes.blob();
    } catch {
      // Optional artwork cache
    }
  }

  const savedTrack: Track = {
    ...resolved,
    offline: true,
    offlineSizeBytes: audioBlob.size,
    addedAt: Date.now(),
  };

  await saveOfflineRecord({
    id: savedTrack.id,
    track: savedTrack,
    audioBlob,
    artworkBlob,
    sizeBytes: audioBlob.size,
    savedAt: Date.now(),
  });
  onProgress?.(100);

  return {
    ...savedTrack,
    src: URL.createObjectURL(audioBlob),
    artwork: artworkBlob ? URL.createObjectURL(artworkBlob) : savedTrack.artwork,
  };
}

export async function removeOfflineTrack(trackId: string): Promise<void> {
  if (isAndroidNative()) {
    await RyotunesNativeMedia.removeOfflineTrack({ id: trackId });
    return;
  }
  await removeOfflineRecord(trackId);
}

export async function clearOfflineAndCaches(): Promise<void> {
  if (isAndroidNative()) {
    await RyotunesNativeMedia.clearStreamCache();
    return;
  }
  await clearOfflineDb();
}

export function parseLrcText(rawLrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const timeTagRe = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  for (const rawLine of rawLrc.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const matches = Array.from(trimmed.matchAll(timeTagRe));
    if (matches.length === 0) continue;
    const text = trimmed.replace(timeTagRe, '').trim();
    if (!text) continue;
    for (const m of matches) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracStr = m[3] || '0';
      const ms = fracStr.length === 3 ? parseInt(fracStr, 10) : parseInt(fracStr.padEnd(2, '0'), 10) * 10;
      lines.push({
        timeMs: min * 60000 + sec * 1000 + ms,
        text,
      });
    }
  }
  lines.sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0));
  return lines;
}

export function parsePlainLyricsText(rawPlain: string): LyricLine[] {
  return rawPlain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text) => ({ text }));
}

export async function fetchTrackLyrics(track: Track): Promise<LyricsDoc | null> {
  if (!track.title || track.source === 'demo') return track.lyrics ?? null;

  try {
    let syncedLyrics = '';
    let plainLyrics = '';
    let source = 'lrclib';

    if (isAndroidNative()) {
      const res = await RyotunesNativeMedia.fetchLyrics({
        title: track.title,
        artist: track.artist || '',
        album: track.album || '',
        durationSec: track.duration || 0,
      });
      syncedLyrics = res.syncedLyrics || '';
      plainLyrics = res.plainLyrics || '';
      source = res.source || 'lrclib';
    } else {
      const cleanTitle = track.title
        .replace(/\s*[([](?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer)|lyrics?|audio|explicit|hd|4k|remastered(?:\s*\d{4})?|feat\.?[^)\]]*|ft\.?[^)\]]*)[)\]]/gi, '')
        .replace(/\s+-\s+(?:official\s*(?:video|audio)|topic).*/gi, '')
        .trim();
      const cleanArtist = (track.artist || '').replace(/\s*-\s*Topic$/i, '').split(/[,&;]/)[0]?.trim() || '';
      if (!cleanTitle) return null;

      const qs = new URLSearchParams({ track_name: cleanTitle });
      if (cleanArtist && cleanArtist.toLowerCase() !== 'unknown artist') qs.set('artist_name', cleanArtist);
      if (track.duration > 1) qs.set('duration', String(Math.round(track.duration)));

      let res = await fetch(`https://lrclib.net/api/get?${qs.toString()}`);
      if (res.ok) {
        const obj = (await res.json()) as { syncedLyrics?: string; plainLyrics?: string };
        syncedLyrics = obj.syncedLyrics || '';
        plainLyrics = obj.plainLyrics || '';
      }
      if (!syncedLyrics && !plainLyrics) {
        const searchQs = new URLSearchParams({ q: cleanArtist ? `${cleanArtist} ${cleanTitle}` : cleanTitle });
        res = await fetch(`https://lrclib.net/api/search?${searchQs.toString()}`);
        if (res.ok) {
          const arr = (await res.json()) as Array<{ syncedLyrics?: string; plainLyrics?: string }>;
          const pick = arr.find((x) => x.syncedLyrics) || arr.find((x) => x.plainLyrics);
          if (pick) {
            syncedLyrics = pick.syncedLyrics || '';
            plainLyrics = pick.plainLyrics || '';
          }
        }
      }
    }

    if (syncedLyrics.trim()) {
      const lines = parseLrcText(syncedLyrics);
      if (lines.length > 0) {
        return { synced: true, source, lines };
      }
    }
    if (plainLyrics.trim()) {
      const lines = parsePlainLyricsText(plainLyrics);
      if (lines.length > 0) {
        return { synced: false, source, lines };
      }
    }
  } catch {
    // Graceful no-op if network unavailable or LRCLIB returns empty
  }
  return null;
}
