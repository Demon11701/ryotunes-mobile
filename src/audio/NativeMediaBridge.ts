import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import {
  AccountProviderId,
  AccountsMap,
  AppVersionInfo,
  AudioFxState,
  AudioQuality,
  GithubUpdateInfo,
  Playlist,
  ProviderId,
  RepeatMode,
  Track,
} from './types';

export interface PermissionsStatus {
  audioGranted: boolean;
  notificationsGranted: boolean;
  visualizerGranted: boolean;
}

export interface NativeScanResult {
  tracks: Array<{
    id: string;
    title: string;
    artist: string;
    album: string;
    duration: number;
    src: string;
    artworkPath?: string;
    format?: string;
    source?: 'local';
  }>;
  count: number;
}

export interface NativeOnlineSearchResult {
  items: Array<{
    id: string;
    provider: ProviderId;
    remoteId?: string;
    title: string;
    artist: string;
    album: string;
    duration: number;
    artwork?: string;
    format?: string;
  }>;
}

export interface NativeResolvedStream {
  streamUrl: string;
  mimeType?: string;
  duration?: number;
  waveform?: number[];
}

export interface NativeOfflineTrackItem {
  id: string;
  originalId?: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  src: string;
  contentUri?: string;
  localPath?: string;
  mimeType?: string;
  artworkPath?: string;
  format?: string;
  provider?: ProviderId;
  sizeBytes?: number;
  waveform?: number[];
}

export interface NativeDownloadProgressEvent {
  trackId: string;
  progress: number;
  status: 'queued' | 'downloading' | 'completed' | 'failed';
  error?: string;
}

export interface NativePlaybackStateEvent {
  trackId: string | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  queueIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  stopAfterCurrent: boolean;
  ended?: boolean;
}

export interface NativeSpectrumEvent {
  bands: number[];
}

export interface NativeAccountConnectResult {
  connected: boolean;
  provider: AccountProviderId;
  accountName: string;
}

export interface NativeSyncedTrackItem {
  id: string;
  provider: ProviderId;
  remoteId?: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artwork?: string;
  format?: string;
}

export interface NativeAccountSyncResult {
  provider: AccountProviderId;
  accountName: string;
  playlists: Playlist[];
  tracks: NativeSyncedTrackItem[];
  likedIds: string[];
}

export interface NativeImportPlaylistResult {
  playlist: Playlist;
  tracks: NativeSyncedTrackItem[];
}

export interface NativeRemotePlaylistTracksResult {
  playlistId: string;
  tracks: NativeSyncedTrackItem[];
  trackIds: string[];
}

export interface NativeHomeRecommendationSectionRaw {
  id: string;
  title: string;
  subtitle: string;
  provider: ProviderId;
  kind: 'tracks' | 'playlists';
  items: Array<NativeSyncedTrackItem | Playlist>;
}

export interface NativeHomeRecommendationsResult {
  fetchedAt: number;
  sections: NativeHomeRecommendationSectionRaw[];
}

export interface NativeUpdateProgressEvent {
  progress: number;
  version?: string;
}

export interface NativeDownloadUpdateResult {
  started: boolean;
  needsPermission?: boolean;
}

export interface RyotunesNativeMediaPluginInterface {
  checkPermissionsStatus(): Promise<PermissionsStatus>;
  requestAudioPermissions(): Promise<PermissionsStatus>;
  requestVisualizerPermission(): Promise<PermissionsStatus>;
  scanLocalMusic(): Promise<NativeScanResult>;
  searchOnline(options: { query: string; provider: string }): Promise<NativeOnlineSearchResult>;
  resolveStream(options: {
    id: string;
    provider: string;
    title: string;
    artist: string;
    quality: AudioQuality;
  }): Promise<NativeResolvedStream>;
  downloadOffline(options: {
    track: {
      id: string;
      title: string;
      artist: string;
      album: string;
      duration: number;
      artwork?: string;
      provider?: string;
      format?: string;
      waveform?: number[];
    };
    quality: AudioQuality;
  }): Promise<{ track: NativeOfflineTrackItem }>;
  listOfflineTracks(): Promise<{ tracks: NativeOfflineTrackItem[] }>;
  removeOfflineTrack(options: { id: string }): Promise<void>;
  clearStreamCache(): Promise<void>;
  fetchLyrics(options: {
    title: string;
    artist: string;
    album?: string;
    durationSec?: number;
  }): Promise<{ syncedLyrics?: string; plainLyrics?: string; source?: string }>;
  connectAccount(options: { provider: AccountProviderId }): Promise<NativeAccountConnectResult>;
  disconnectAccount(options: { provider: AccountProviderId }): Promise<{ connected: boolean; provider: AccountProviderId }>;
  getConnectedAccounts(): Promise<AccountsMap>;
  syncAccountPlaylists(options: { provider: AccountProviderId }): Promise<NativeAccountSyncResult>;
  importPlaylistByUrl(options: { url: string }): Promise<NativeImportPlaylistResult>;
  fetchRemotePlaylistTracks(options: {
    playlistId: string;
    provider?: string;
  }): Promise<NativeRemotePlaylistTracksResult>;
  fetchHomeRecommendations(): Promise<NativeHomeRecommendationsResult>;
  getAppVersionInfo(): Promise<AppVersionInfo>;
  checkGithubUpdate(): Promise<GithubUpdateInfo>;
  downloadAndInstallUpdate(options: {
    apkUrl: string;
    version?: string;
  }): Promise<NativeDownloadUpdateResult>;
  setQueue(options: { tracks: unknown[]; startIndex: number; autoPlay: boolean; startPosition?: number }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  togglePlay(): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  seek(options: { position: number }): Promise<void>;
  setShuffle(options: { enabled: boolean }): Promise<void>;
  setRepeat(options: { mode: RepeatMode }): Promise<void>;
  setStopAfterCurrent(options: { enabled: boolean }): Promise<void>;
  setAudioFx(fx: AudioFxState): Promise<void>;
  getSystemVolume(): Promise<{ volume: number; muted: boolean }>;
  setSystemVolume(options: { volume: number; muted: boolean }): Promise<void>;
  getPlaybackState(): Promise<Partial<NativePlaybackStateEvent>>;
  addListener(
    eventName: 'playbackState',
    listenerFunc: (event: NativePlaybackStateEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'spectrum',
    listenerFunc: (event: NativeSpectrumEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'playbackError',
    listenerFunc: (event: { message: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (event: NativeDownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'updateProgress',
    listenerFunc: (event: NativeUpdateProgressEvent) => void
  ): Promise<PluginListenerHandle>;
}

export const RyotunesNativeMedia =
  registerPlugin<RyotunesNativeMediaPluginInterface>('RyotunesNativeMedia');

export const isAndroidNative = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export function convertNativeArtwork(artworkPath?: string): string | undefined {
  if (!artworkPath) return undefined;
  return Capacitor.convertFileSrc(artworkPath);
}

export function mapNativeScanTracks(raw: NativeScanResult): Track[] {
  return raw.tracks.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    src: t.src,
    artwork: convertNativeArtwork(t.artworkPath),
    artworkPath: t.artworkPath,
    format: t.format || 'AUDIO',
    source: 'local',
    addedAt: Date.now(),
  }));
}

export function mapNativeOfflineTrack(t: NativeOfflineTrackItem): Track {
  const playbackUri = t.contentUri || t.src;
  return {
    id: t.id,
    originalId: t.originalId || t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    src: playbackUri,
    mimeType: t.mimeType,
    artwork: convertNativeArtwork(t.artworkPath),
    artworkPath: t.artworkPath,
    format: t.format || 'OFFLINE',
    source: t.provider || 'offline',
    provider: t.provider,
    offline: true,
    offlineSizeBytes: t.sizeBytes,
    offlinePath: t.localPath || playbackUri,
    waveform: t.waveform,
    addedAt: Date.now(),
  };
}
