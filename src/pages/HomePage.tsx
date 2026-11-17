import React, { useMemo, useRef, useState } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { LibraryPage, LibraryTab } from '../audio/types';
import { Artwork } from '../components/Artwork';
import { MediaCard } from '../components/MediaCard';
import { TrackRow } from '../components/TrackRow';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeContext';

interface HomePageProps {
  onNavigate: (page: LibraryPage, param?: string, tab?: LibraryTab) => void;
  onOpenBento: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate, onOpenBento }) => {
  const {
    tracks,
    offlineTracks,
    currentTrack,
    isPlaying,
    recentIds,
    likedIds,
    playlists,
    albums,
    artists,
    playTrack,
    importLocalFiles,
    syncDeviceLibrary,
    isNativeAndroid,
  } = useAudio();
  const { decor } = useTheme();
  const [chip, setChip] = useState<'all' | 'offline' | 'local' | 'liked'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 5) return 'Still up';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 22) return 'Good evening';
    return 'Good night';
  };

  const trackMap = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const recents = useMemo(
    () =>
      recentIds
        .map((id) => trackMap.get(id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .slice(0, 6),
    [recentIds, trackMap]
  );

  const filteredTracks = useMemo(() => {
    let base = tracks;
    if (chip === 'offline') base = base.filter((t) => t.offline);
    if (chip === 'local') base = base.filter((t) => t.source === 'local');
    if (chip === 'liked') base = base.filter((t) => likedIds.includes(t.id));
    return base;
  }, [tracks, chip, likedIds]);

  const SectionHead: React.FC<{ title: string; mark: string }> = ({ title, mark }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <span className="font-mono-tech" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
        // {title}
      </span>
      <div style={{ flex: 1, height: 1, backgroundColor: 'var(--line-soft)' }} />
      {decor === 'rich' && <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>{mark}</span>}
    </div>
  );

  return (
    <div className="page-reenter" style={{ display: 'flex', flexDirection: 'column', gap: 28, paddingBottom: 24 }}>
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

      {/* Hero Eyebrow + Greeting */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 16, height: 1, backgroundColor: 'var(--ink)' }} />
          <span style={{ fontSize: 13, color: 'var(--ink)' }}>力</span>
          <span className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>
            HOME / LISTEN
          </span>
          <span style={{ flex: 1, height: 1, backgroundColor: 'var(--line-soft)' }} />
          <span className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>
            01
          </span>
        </div>

        <h1 className="font-display-ryo" style={{ margin: 0, fontSize: 34, lineHeight: 1.05, color: 'var(--ink)' }}>
          {greeting()}
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-muted)' }}>
          Pick up where you left off, or load local tracks onto your device.
        </p>

        {/* Search Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onNavigate('search', searchQuery);
          }}
          style={{
            marginTop: 6,
            height: 44,
            borderRadius: 'var(--radius)',
            backgroundColor: 'var(--paper-lift)',
            border: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 12px',
          }}
        >
          <Icon name="search" size={16} color="var(--ink-muted)" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tracks, albums, artists…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--ink)',
              fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={onOpenBento}
            className="font-ndot ryo-pressable"
            style={{
              height: 24,
              padding: '0 8px',
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--tint-5)',
              border: '1px solid var(--line)',
              color: 'var(--accent)',
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            BENTO ↗
          </button>
        </form>

        {/* Filter Chips */}
        <div style={{ display: 'flex', gap: 8, marginTop: 6, overflowX: 'auto' }}>
          {(
            [
              { k: 'all', l: 'All' },
              { k: 'offline', l: `Offline (${offlineTracks.length})` },
              { k: 'local', l: 'Local Files' },
              { k: 'liked', l: 'Favorites' },
            ] as const
          ).map((c) => {
            const active = chip === c.k;
            return (
              <button
                key={c.k}
                type="button"
                onClick={() => setChip(c.k)}
                className="ryo-pressable"
                style={{
                  height: 32,
                  padding: '0 16px',
                  borderRadius: 999,
                  border: `1px solid ${active ? 'var(--bone)' : 'var(--line)'}`,
                  backgroundColor: active ? 'var(--bone)' : 'transparent',
                  color: active ? 'var(--ink-on-bone)' : 'var(--ink-muted)',
                  fontSize: 13.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {c.l}
              </button>
            );
          })}
        </div>
      </div>

      {/* // Shortcuts */}
      <div>
        <SectionHead title="Shortcuts" mark="選" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {playlists[0] && (
            <button
              type="button"
              onClick={() => onNavigate('playlist', playlists[0].id)}
              className="ryo-pressable"
              style={{
                padding: 12,
                borderRadius: 'var(--radius)',
                backgroundColor: 'var(--paper-lift)',
                border: '1px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Artwork size={40} placeholderIcon="on-repeat" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{playlists[0].title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{playlists[0].trackIds.length} songs</div>
              </div>
            </button>
          )}

          <button
            type="button"
            onClick={() => onNavigate('library', '', 'offline')}
            className="ryo-pressable"
            style={{
              padding: 12,
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Artwork size={40} placeholderIcon="download" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Offline Saved</div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{offlineTracks.length} cached tracks</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => (isNativeAndroid ? syncDeviceLibrary(true) : fileInputRef.current?.click())}
            className="ryo-pressable"
            style={{
              padding: 12,
              borderRadius: 'var(--radius)',
              backgroundColor: 'transparent',
              border: '1px dashed var(--line-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
              color: 'var(--ink-muted)',
              fontSize: 13.5,
            }}
          >
            <Icon name={isNativeAndroid ? 'on-repeat' : 'add'} size={16} color="var(--accent)" />
            <span>{isNativeAndroid ? 'Sync Local' : 'Load Audio'}</span>
          </button>
        </div>
      </div>

      {/* // Recently played (Jump back in) */}
      {recents.length > 0 && (
        <div>
          <SectionHead title="Recently played" mark="戻" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 6 }}>
            {recents.map((t) => (
              <div
                key={t.id}
                onClick={() => playTrack(t, tracks)}
                className="ryo-pressable"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '6px 8px',
                  borderRadius: 'var(--radius)',
                  backgroundColor: currentTrack?.id === t.id ? 'var(--tint-10)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <Artwork src={t.artwork} size={46} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: currentTrack?.id === t.id ? 'var(--accent)' : 'var(--ink)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--ink-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.artist}
                  </div>
                </div>
                {currentTrack?.id === t.id && isPlaying && <Icon name="graphic_eq" size={16} color="var(--accent)" />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* // Tracks Feed */}
      <div>
        <SectionHead title="Tracks" mark="章" />
        {filteredTracks.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13.5 }}>
            No tracks match this filter yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filteredTracks.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                index={i}
                active={currentTrack?.id === t.id}
                onPlay={() => playTrack(t, filteredTracks)}
              />
            ))}
          </div>
        )}
      </div>

      {/* // Albums Shelf */}
      {albums.length > 0 && (
        <div>
          <SectionHead title="Albums" mark="蔵" />
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 4 }}>
            {albums.map((alb) => (
              <MediaCard
                key={alb.id}
                title={alb.title}
                subtitle={`${alb.artist} · ${alb.tracks.length} tracks`}
                artwork={alb.artwork}
                onOpen={() => onNavigate('album', alb.id)}
                onPlay={() => alb.tracks[0] && playTrack(alb.tracks[0], alb.tracks)}
              />
            ))}
          </div>
        </div>
      )}

      {/* // Familiar Artists */}
      {artists.length > 0 && (
        <div>
          <SectionHead title="Familiar artists" mark="馴" />
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 4 }}>
            {artists.map((art) => (
              <MediaCard
                key={art.id}
                title={art.name}
                subtitle={`${art.tracks.length} tracks`}
                artwork={art.artwork}
                round
                width={126}
                onOpen={() => onNavigate('artist', art.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
