import React, { useEffect, useRef } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { Artwork } from '../components/Artwork';
import { TrackRow } from '../components/TrackRow';
import { Icon } from '../icons/Icon';

interface DetailPageProps {
  kind: 'playlist' | 'album' | 'artist';
  id: string;
  onBack: () => void;
}

function isRemotePlaylistId(id: string): boolean {
  return (
    id.startsWith('PL:spotify:') ||
    id.startsWith('PL:ytmusic:') ||
    id.startsWith('PL:soundcloud:') ||
    id.startsWith('PL:tidal:')
  );
}

/**
 * Unified PageHero detail view for PlaylistPage, AlbumPage, and ArtistPage.
 */
export const DetailPage: React.FC<DetailPageProps> = ({ kind, id, onBack }) => {
  const {
    tracks,
    playlists,
    albums,
    artists,
    currentTrack,
    playTrack,
    removeTrackFromPlaylist,
    downloadTracksBatch,
    loadingPlaylistId,
    loadPlaylistTracks,
  } = useAudio();
  const trackMap = new Map(tracks.map((t) => [t.id, t]));
  const attemptedHydrateRef = useRef<Set<string>>(new Set());

  let eyebrow = kind.toUpperCase();
  let title = '';
  let meta = '';
  let artwork: string | undefined;
  let list = tracks;

  if (kind === 'playlist') {
    const pl = playlists.find((p) => p.id === id);
    title = pl?.title || 'Playlist';
    list = (pl?.trackIds || []).map((tid) => trackMap.get(tid)).filter((t): t is NonNullable<typeof t> => Boolean(t));
    artwork = pl?.artwork || list.find((t) => t.artwork)?.artwork;
    if (pl?.provider) eyebrow = `PLAYLIST // ${pl.provider.toUpperCase()}`;
    meta = list.length > 0 ? `${list.length} pistas · ${pl?.subtitle || 'Playlist'}` : pl?.subtitle || 'Playlist';
  } else if (kind === 'album') {
    const alb = albums.find((a) => a.id === id);
    title = alb?.title || 'Album';
    list = alb?.tracks || [];
    artwork = alb?.artwork;
    meta = `${alb?.artist || ''} · ${list.length} tracks`;
  } else {
    const art = artists.find((a) => a.id === id);
    title = art?.name || 'Artist';
    list = art?.tracks || [];
    artwork = art?.artwork;
    meta = `${list.length} tracks on device`;
  }

  const remotePl = kind === 'playlist' && isRemotePlaylistId(id);
  const isLoadingTracks = loadingPlaylistId === id;

  useEffect(() => {
    if (!remotePl) return;
    if (list.length > 0 || isLoadingTracks) return;
    if (attemptedHydrateRef.current.has(id)) return;
    attemptedHydrateRef.current.add(id);
    void loadPlaylistTracks(id);
  }, [remotePl, id, list.length, isLoadingTracks, loadPlaylistTracks]);

  return (
    <div className="page-reenter" style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 24 }}>
      <button
        type="button"
        onClick={onBack}
        className="ryo-pressable"
        style={{
          alignSelf: 'flex-start',
          height: 32,
          padding: '0 12px',
          borderRadius: 999,
          backgroundColor: 'var(--paper-lift)',
          border: '1px solid var(--line)',
          color: 'var(--ink-dim)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12.5,
          cursor: 'pointer',
        }}
      >
        <Icon name="arrow-left" size={14} color="var(--ink-dim)" />
        <span>Back</span>
      </button>

      {/* PageHero.qml */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Artwork
          src={artwork}
          size={128}
          round={kind === 'artist'}
          placeholderIcon={kind === 'artist' ? 'user' : 'music'}
        />
        <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>
            {eyebrow}
          </div>
          <h1 className="font-display-ryo" style={{ margin: 0, fontSize: 28, lineHeight: 1.08, color: 'var(--ink)' }}>
            {title}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{meta}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button
              type="button"
              disabled={list.length === 0}
              onClick={() => list[0] && playTrack(list[0], list)}
              className="ryo-pressable"
              style={{
                height: 36,
                padding: '0 18px',
                borderRadius: 999,
                backgroundColor: 'var(--bone)',
                color: 'var(--ink-on-bone)',
                border: 'none',
                fontSize: 13.5,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <Icon name="play" size={14} color="var(--ink-on-bone)" />
              <span>Play</span>
            </button>
            <button
              type="button"
              disabled={list.length === 0}
              onClick={() => downloadTracksBatch(list, title)}
              className="ryo-pressable"
              style={{
                height: 36,
                padding: '0 14px',
                borderRadius: 999,
                backgroundColor: 'var(--paper-lift)',
                color: 'var(--ink)',
                border: '1px solid var(--line)',
                fontSize: 12.5,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <Icon name="download" size={14} color="var(--accent)" />
              <span>↓ OFFLINE ALL</span>
            </button>
            {remotePl && (
              <button
                type="button"
                disabled={isLoadingTracks}
                onClick={() => void loadPlaylistTracks(id)}
                className="font-mono-tech ryo-pressable"
                style={{
                  height: 36,
                  padding: '0 12px',
                  borderRadius: 999,
                  backgroundColor: 'var(--paper-lift)',
                  color: 'var(--ink-muted)',
                  border: '1px solid var(--line)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: isLoadingTracks ? 'wait' : 'pointer',
                  opacity: isLoadingTracks ? 0.6 : 1,
                }}
              >
                {isLoadingTracks ? 'CARGANDO…' : '↻ SYNC'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ height: 1, backgroundColor: 'var(--line-soft)' }} />

      <div>
        {isLoadingTracks && list.length === 0 ? (
          <div className="font-mono-tech" style={{ padding: 28, textAlign: 'center', color: 'var(--accent)', fontSize: 12 }}>
            CARGANDO PISTAS DE LA PLAYLIST…
          </div>
        ) : list.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13.5 }}>
            No tracks here yet.
          </div>
        ) : (
          list.map((t, i) => (
            <TrackRow
              key={t.id}
              track={t}
              index={i}
              active={currentTrack?.id === t.id}
              onPlay={() => playTrack(t, list)}
              actionIcon={kind === 'playlist' ? 'trash' : undefined}
              onAction={kind === 'playlist' ? () => removeTrackFromPlaylist(id, t.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
};
