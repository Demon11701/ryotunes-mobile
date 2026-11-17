import React, { useEffect, useRef, useState } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { LibraryPage as PageKind, LibraryTab } from '../audio/types';
import { MediaCard } from '../components/MediaCard';
import { TrackRow } from '../components/TrackRow';
import { Icon } from '../icons/Icon';

interface LibraryPageProps {
  initialTab?: LibraryTab;
  onNavigate: (page: PageKind, param?: string) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const LibraryPage: React.FC<LibraryPageProps> = ({ initialTab = 'songs', onNavigate }) => {
  const {
    tracks,
    offlineTracks,
    localCount,
    scanningDevice,
    isNativeAndroid,
    currentTrack,
    likedIds,
    albums,
    artists,
    playlists,
    playTrack,
    importLocalFiles,
    syncDeviceLibrary,
    createPlaylist,
    removeOffline,
  } = useAudio();

  const [tab, setTab] = useState<LibraryTab>(initialTab);
  const [localFilter, setLocalFilter] = useState('');
  const [newName, setNewName] = useState('');
  const [showNew, setShowNew] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const tabs: { k: LibraryTab; l: string }[] = [
    { k: 'songs', l: 'Songs' },
    { k: 'offline', l: `Offline (${offlineTracks.length})` },
    { k: 'albums', l: 'Albums' },
    { k: 'artists', l: 'Artists' },
    { k: 'playlists', l: 'Playlists' },
    { k: 'local', l: 'Local' },
    { k: 'insights', l: 'Insights' },
  ];

  const localTracks = tracks.filter((t) => {
    const q = localFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q)
    );
  });

  const totalOfflineBytes = offlineTracks.reduce((acc, t) => acc + (t.offlineSizeBytes || 0), 0);
  const trackMap = new Map(tracks.map((t) => [t.id, t]));

  return (
    <div className="page-reenter" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) importLocalFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Title Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 className="font-display-ryo" style={{ margin: 0, fontSize: 32, color: 'var(--ink)' }}>
            Library
          </h1>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>
            {tracks.length} tracks · {offlineTracks.length} offline · {localCount} local files
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowNew((s) => !s)}
          className="ryo-pressable"
          style={{
            height: 36,
            padding: '0 14px',
            borderRadius: 999,
            backgroundColor: 'var(--bone)',
            color: 'var(--ink-on-bone)',
            border: 'none',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
          }}
        >
          <Icon name="playlist" size={15} color="var(--ink-on-bone)" />
          <span>New playlist</span>
        </button>
      </div>

      {showNew && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Playlist name..."
            autoFocus
            style={{
              flex: 1,
              height: 38,
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-strong)',
              color: 'var(--ink)',
              padding: '0 12px',
              fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (newName.trim()) {
                createPlaylist(newName);
                setNewName('');
                setShowNew(false);
              }
            }}
            style={{
              height: 38,
              padding: '0 16px',
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--bone)',
              color: 'var(--ink-on-bone)',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Create
          </button>
        </div>
      )}

      {/* Segmented Tabs */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {tabs.map((t) => {
          const active = tab === t.k;
          return (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k)}
              className="ryo-pressable"
              style={{
                height: 32,
                padding: '0 14px',
                borderRadius: 999,
                border: `1px solid ${active ? 'var(--bone)' : 'var(--line)'}`,
                backgroundColor: active ? 'var(--bone)' : 'transparent',
                color: active ? 'var(--ink-on-bone)' : 'var(--ink-muted)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {t.l}
            </button>
          );
        })}
      </div>

      <div style={{ height: 1, backgroundColor: 'var(--line-soft)' }} />

      {/* Tab Bodies */}
      {tab === 'songs' && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {tracks.map((t, i) => (
            <TrackRow
              key={t.id}
              track={t}
              index={i}
              active={currentTrack?.id === t.id}
              onPlay={() => playTrack(t, tracks)}
            />
          ))}
        </div>
      )}

      {tab === 'offline' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              padding: 12,
              borderRadius: 'var(--radius-card)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <div>
              <div className="font-mono-tech" style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: 1.2 }}>
                OFFLINE / SAVED STORAGE · 保
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>
                {offlineTracks.length} downloaded track{offlineTracks.length === 1 ? '' : 's'} ({formatBytes(totalOfflineBytes)}) — plays without internet.
              </div>
            </div>
            {offlineTracks.length > 0 && (
              <button
                type="button"
                onClick={() => playTrack(offlineTracks[0], offlineTracks)}
                className="ryo-pressable"
                style={{
                  height: 32,
                  padding: '0 14px',
                  borderRadius: 999,
                  backgroundColor: 'var(--bone)',
                  color: 'var(--ink-on-bone)',
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Play Offline
              </button>
            )}
          </div>

          {offlineTracks.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13.5 }}>
              Search YouTube Music, Spotify, SoundCloud, or TIDAL and tap <strong style={{ color: 'var(--accent)' }}>↓ OFFLINE</strong> to save tracks for offline playback.
            </div>
          ) : (
            <div>
              {offlineTracks.map((t, i) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  index={i}
                  active={currentTrack?.id === t.id}
                  onPlay={() => playTrack(t, offlineTracks)}
                  actionIcon="trash"
                  onAction={() => removeOffline(t.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'albums' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(144px, 1fr))', gap: 16 }}>
          {albums.map((alb) => (
            <MediaCard
              key={alb.id}
              title={alb.title}
              subtitle={alb.artist}
              artwork={alb.artwork}
              width={144}
              onOpen={() => onNavigate('album', alb.id)}
              onPlay={() => alb.tracks[0] && playTrack(alb.tracks[0], alb.tracks)}
            />
          ))}
        </div>
      )}

      {tab === 'artists' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 16 }}>
          {artists.map((art) => (
            <MediaCard
              key={art.id}
              title={art.name}
              subtitle={`${art.tracks.length} songs`}
              artwork={art.artwork}
              round
              width={130}
              onOpen={() => onNavigate('artist', art.id)}
            />
          ))}
        </div>
      )}

      {tab === 'playlists' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(144px, 1fr))', gap: 16 }}>
          {playlists.map((pl) => {
            const arts = pl.trackIds
              .map((id) => trackMap.get(id)?.artwork)
              .filter((u): u is string => Boolean(u));
            return (
              <MediaCard
                key={pl.id}
                title={pl.title}
                subtitle={`${pl.trackIds.length} songs`}
                artwork={arts[0]}
                collage={arts.length >= 4 ? arts.slice(0, 4) : undefined}
                placeholderIcon={pl.smart ? 'on-repeat' : 'playlist'}
                width={144}
                onOpen={() => onNavigate('playlist', pl.id)}
              />
            );
          })}
        </div>
      )}

      {tab === 'local' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => (isNativeAndroid ? syncDeviceLibrary(true) : fileInputRef.current?.click())}
              className="ryo-pressable"
              style={{
                height: 36,
                padding: '0 14px',
                borderRadius: 999,
                backgroundColor: 'var(--bone)',
                color: 'var(--ink-on-bone)',
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <Icon name={isNativeAndroid ? 'on-repeat' : 'folder'} size={15} color="var(--ink-on-bone)" />
              <span>{isNativeAndroid ? (scanningDevice ? 'Scanning…' : 'Sync Device') : 'Select Audio Files'}</span>
            </button>

            <div
              style={{
                flex: 1,
                height: 36,
                borderRadius: 'var(--radius)',
                backgroundColor: 'var(--paper-lift)',
                border: '1px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 10px',
              }}
            >
              <Icon name="search" size={14} color="var(--ink-muted)" />
              <input
                value={localFilter}
                onChange={(e) => setLocalFilter(e.target.value)}
                placeholder="Filter local..."
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--ink)',
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          <div>
            {localTracks.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                index={i}
                active={currentTrack?.id === t.id}
                onPlay={() => playTrack(t, localTracks)}
              />
            ))}
          </div>
        </div>
      )}

      {tab === 'insights' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {[
            { label: 'TOTAL TRACKS', value: String(tracks.length) },
            { label: 'OFFLINE SAVED', value: String(offlineTracks.length) },
            { label: 'LOCAL DEVICE', value: String(localCount) },
            { label: 'FAVORITES', value: String(likedIds.length) },
            { label: 'PLAYLISTS', value: String(playlists.length) },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                padding: 16,
                borderRadius: 'var(--radius-card)',
                backgroundColor: 'var(--paper-lift)',
                border: '1px solid var(--line-soft)',
              }}
            >
              <div className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>
                {stat.label}
              </div>
              <div className="font-ndot" style={{ fontSize: 28, color: 'var(--accent)', marginTop: 6 }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
