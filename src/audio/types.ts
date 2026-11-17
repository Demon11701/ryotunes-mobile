export type RepeatMode = 'off' | 'all' | 'one';

export type ProviderId = 'youtube' | 'spotify' | 'soundcloud' | 'tidal';
export type OnlineProviderFilter = 'all' | ProviderId | 'offline';
export type AudioQuality = 'LOW' | 'AUTO' | 'HIGH';

export type BentoThemeMode = 'nothing' | 'inherit';
export type SeekbarStyle = 'hairline' | 'waveform' | 'scale';
export type VisualizerStyle = 'dot-matrix' | 'spectrum-wave' | 'spectrum-bars';
export type AccentPolicyOverride = 'skin' | 'artwork' | 'provider' | 'sun';
export type ThemeModePref = 'system' | 'dark' | 'light';
export type DecorPref = 'skin' | 'rich' | 'calm';

export interface LyricWord {
  text: string;
  startMs: number;
}

export interface LyricLine {
  timeMs?: number;
  text: string;
  romanized?: string;
  words?: LyricWord[];
}

export interface LyricsDoc {
  synced: boolean;
  instrumental?: boolean;
  source?: string;
  lines: LyricLine[];
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  src: string; // blob URL, file URI, content:// URI, or online stream URL
  mimeType?: string;
  artwork?: string;
  artworkPath?: string; // native cached thumbnail path for ExoPlayer & AppWidget
  format?: string;
  source?: 'local' | 'demo' | 'offline' | ProviderId;
  provider?: ProviderId;
  remoteId?: string; // yt videoId, sc track numeric id, etc.
  waveform?: number[]; // 240 amplitude samples (0..100) matching Waveform.qml
  offline?: boolean;
  offlineSizeBytes?: number;
  offlinePath?: string;
  lyrics?: LyricsDoc;
  addedAt?: number;
}

export interface Playlist {
  id: string;
  title: string;
  subtitle?: string;
  trackIds: string[];
  artwork?: string;
  smart?: boolean;
  createdAt: number;
}

export interface AlbumGroup {
  id: string;
  title: string;
  artist: string;
  artwork?: string;
  tracks: Track[];
}

export interface ArtistGroup {
  id: string;
  name: string;
  artwork?: string;
  tracks: Track[];
}

export interface AudioFxState {
  speed: number; // 0.25 .. 2.0
  semitones: number; // -12 .. +12
  reverb: number; // 0 .. 1
  bass: number; // -6 .. +12 dB
  width: number; // 0 .. 1
}

export type AppViewMode = 'bento' | 'library' | 'visualizer' | 'nowPlaying';
export type LibraryPage = 'home' | 'search' | 'library' | 'playlist' | 'album' | 'artist' | 'settings';
export type LibraryTab = 'songs' | 'albums' | 'artists' | 'playlists' | 'offline' | 'local' | 'insights';
