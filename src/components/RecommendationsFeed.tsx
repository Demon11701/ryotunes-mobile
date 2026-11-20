import React, { useMemo } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { LibraryPage, LibraryTab, OnlineProviderFilter, Playlist, Track } from '../audio/types';
import { Icon } from '../icons/Icon';
import { PROVIDER_COLORS } from '../theme/skins';
import { useTheme } from '../theme/ThemeContext';
import { Artwork } from './Artwork';
import { MediaCard } from './MediaCard';
import { OfflineButton } from './OfflineButton';
import { ProviderBadge } from './ProviderBadge';
import { TrackRow } from './TrackRow';

interface RecommendationsFeedProps {
  providerFilter?: OnlineProviderFilter;
  onNavigate: (page: LibraryPage, param?: string, tab?: LibraryTab) => void;
}

function providerAccent(provider?: string): string {
  if (provider === 'spotify') return PROVIDER_COLORS.spotify;
  if (provider === 'youtube') return PROVIDER_COLORS.youtube;
  if (provider === 'soundcloud') return PROVIDER_COLORS.soundcloud;
  if (provider === 'tidal') return PROVIDER_COLORS.tidal;
  return 'var(--accent)';
}

function providerLabel(provider?: string): string {
  if (provider === 'spotify') return 'SPOTIFY';
  if (provider === 'youtube') return 'YT MUSIC';
  if (provider === 'soundcloud') return 'SOUNDCLOUD';
  if (provider === 'tidal') return 'TIDAL';
  return 'CLOUD';
}

export const RecommendationsFeed: React.FC<RecommendationsFeedProps> = ({
  providerFilter = 'all',
  onNavigate,
}) => {
  const {
    tracks,
    playlists,
    accounts,
    currentTrack,
    playTrack,
    homeRecommendations,
    loadingRecommendations,
    refreshRecommendations,
  } = useAudio();
  const { decor } = useTheme();

  const trackMap = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const connectedCount = useMemo(
    () => Object.values(accounts).filter((a) => a.connected).length,
    [accounts]
  );

  const cloudPlaylists = useMemo(() => {
    const base = playlists.filter(
      (p) =>
        Boolean(p.provider) ||
        p.id.startsWith('PL:spotify:') ||
        p.id.startsWith('PL:ytmusic:') ||
        p.id.startsWith('PL:soundcloud:') ||
        p.id.startsWith('PL:tidal:')
    );
    if (providerFilter === 'all' || providerFilter === 'offline') return base;
    return base.filter((p) => {
      if (p.provider === providerFilter) return true;
      if (providerFilter === 'youtube' && p.id.startsWith('PL:ytmusic:')) return true;
      return p.id.startsWith(`PL:${providerFilter}:`);
    });
  }, [playlists, providerFilter]);

  const visibleSections = useMemo(() => {
    if (providerFilter === 'offline') return [];
    return homeRecommendations.filter((sec) => {
      if (sec.kind === 'playlists' && cloudPlaylists.length > 0 && sec.id === 'spotify_playlists') {
        // Avoid duplicating Spotify playlists when they already appear in the Connected Playlists carousel
        return false;
      }
      if (providerFilter === 'all') return true;
      return sec.provider === providerFilter;
    });
  }, [homeRecommendations, providerFilter, cloudPlaylists.length]);

  const SectionHead: React.FC<{
    title: string;
    subtitle?: string;
    accent?: string;
    mark?: string;
  }> = ({ title, subtitle, accent = 'var(--accent)', mark = '音' }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            backgroundColor: accent,
            flexShrink: 0,
          }}
        />
        <span className="font-mono-tech" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink)', letterSpacing: 1 }}>
          // {title}
        </span>
        <div style={{ flex: 1, height: 1, backgroundColor: 'var(--line-soft)' }} />
        {decor === 'rich' && <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{mark}</span>}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', paddingLeft: 15 }}>{subtitle}</div>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Refresh Header Strip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="font-ndot" style={{ fontSize: 11, color: 'var(--accent)', letterSpacing: 1.3 }}>
            ● LIVE FEED // RECOMENDACIONES
          </span>
        </div>
        <button
          type="button"
          disabled={loadingRecommendations}
          onClick={() => void refreshRecommendations(true)}
          className="font-mono-tech ryo-pressable"
          style={{
            height: 28,
            padding: '0 11px',
            borderRadius: 999,
            backgroundColor: 'var(--paper-lift)',
            border: '1px solid var(--line)',
            color: 'var(--ink)',
            fontSize: 10,
            fontWeight: 700,
            opacity: loadingRecommendations ? 0.6 : 1,
            cursor: loadingRecommendations ? 'wait' : 'pointer',
          }}
        >
          {loadingRecommendations ? 'ACTUALIZANDO…' : '↻ ACTUALIZAR'}
        </button>
      </div>

      {/* Connected Playlists Carousel OR Connect Accounts Banner */}
      {cloudPlaylists.length > 0 ? (
        <div>
          <SectionHead
            title="TUS PLAYLISTS CONECTADAS"
            subtitle={`${cloudPlaylists.length} playlist${cloudPlaylists.length === 1 ? '' : 's'} sincronizadas · toca para abrir o guardar offline`}
            accent="var(--accent)"
            mark="鍵"
          />
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
            {cloudPlaylists.slice(0, 20).map((pl) => {
              const plTracks = pl.trackIds
                .map((id) => trackMap.get(id))
                .filter((t): t is Track => Boolean(t));
              const arts = plTracks.map((t) => t.artwork).filter((u): u is string => Boolean(u));
              return (
                <div key={pl.id} style={{ position: 'relative', flexShrink: 0 }}>
                  <MediaCard
                    title={pl.title}
                    subtitle={pl.subtitle || `${pl.trackIds.length} pistas`}
                    artwork={pl.artwork || arts[0]}
                    collage={!pl.artwork && arts.length >= 4 ? arts.slice(0, 4) : undefined}
                    placeholderIcon="playlist"
                    width={142}
                    onOpen={() => onNavigate('playlist', pl.id)}
                    onPlay={plTracks[0] ? () => playTrack(plTracks[0], plTracks) : undefined}
                  />
                  <span
                    className="font-mono-tech"
                    style={{
                      position: 'absolute',
                      top: 6,
                      left: 6,
                      padding: '2px 6px',
                      borderRadius: 999,
                      backgroundColor: 'rgba(11, 9, 16, 0.82)',
                      border: `1px solid ${providerAccent(pl.provider)}`,
                      color: providerAccent(pl.provider),
                      fontSize: 8.5,
                      fontWeight: 700,
                      pointerEvents: 'none',
                    }}
                  >
                    {providerLabel(pl.provider)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: 14,
            borderRadius: 'var(--radius-card)',
            backgroundColor: 'var(--paper-lift)',
            border: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <div className="font-mono-tech" style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: 1.2 }}>
              CLOUD SYNC // PLAYLISTS · 鍵
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginTop: 3 }}>
              {connectedCount > 0
                ? 'Sincroniza tus cuentas conectadas para ver tus playlists aquí.'
                : 'Conecta Spotify o YT Music para ver tus playlists y recomendaciones personales.'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('settings', 'accounts')}
            className="font-mono-tech ryo-pressable"
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 999,
              backgroundColor: 'var(--bone)',
              color: 'var(--ink-on-bone)',
              border: 'none',
              fontSize: 10.5,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon name="user" size={13} color="var(--ink-on-bone)" />
            <span>{connectedCount > 0 ? 'IR A CUENTAS' : 'CONECTAR CUENTAS'}</span>
          </button>
        </div>
      )}

      {/* Loading skeleton when fetching first time */}
      {loadingRecommendations && visibleSections.length === 0 && (
        <div
          className="font-mono-tech"
          style={{
            padding: 18,
            borderRadius: 'var(--radius-card)',
            backgroundColor: 'var(--paper-lift)',
            border: '1px solid var(--line-soft)',
            textAlign: 'center',
            fontSize: 11,
            color: 'var(--accent)',
            letterSpacing: 1.2,
          }}
        >
          CARGANDO RECOMENDACIONES EN VIVO (YT MUSIC · SPOTIFY · SOUNDCLOUD)…
        </div>
      )}

      {/* Dynamic Live Recommendation Sections */}
      {visibleSections.map((sec) => {
        const accent = providerAccent(sec.provider);
        if (sec.kind === 'playlists') {
          const plItems = sec.items as Playlist[];
          return (
            <div key={sec.id}>
              <SectionHead title={sec.title} subtitle={sec.subtitle} accent={accent} mark="選" />
              <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
                {plItems.map((pl) => (
                  <MediaCard
                    key={pl.id}
                    title={pl.title}
                    subtitle={pl.subtitle || 'Playlist'}
                    artwork={pl.artwork}
                    placeholderIcon="playlist"
                    width={142}
                    onOpen={() => onNavigate('playlist', pl.id)}
                  />
                ))}
              </div>
            </div>
          );
        }

        const trackItems = sec.items as Track[];
        const isQuickPicks = sec.id === 'ytm_quick_picks';

        return (
          <div key={sec.id}>
            <SectionHead
              title={sec.title}
              subtitle={sec.subtitle}
              accent={accent}
              mark={sec.provider === 'spotify' ? '緑' : sec.provider === 'soundcloud' ? '雲' : '探'}
            />

            {isQuickPicks ? (
              <div
                style={{
                  borderRadius: 'var(--radius-card)',
                  backgroundColor: 'var(--paper-lift)',
                  border: '1px solid var(--line-soft)',
                  padding: '4px 6px',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {trackItems.slice(0, 10).map((t, i) => (
                  <TrackRow
                    key={t.id}
                    track={t}
                    index={i}
                    active={currentTrack?.id === t.id}
                    onPlay={() => playTrack(t, trackItems)}
                  />
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 11, overflowX: 'auto', paddingBottom: 6 }}>
                {trackItems.map((t) => {
                  const isActive = currentTrack?.id === t.id;
                  return (
                    <div
                      key={t.id}
                      onClick={() => playTrack(t, trackItems)}
                      className="ryo-pressable"
                      style={{
                        width: 146,
                        flexShrink: 0,
                        padding: 8,
                        borderRadius: 'var(--radius-card)',
                        backgroundColor: 'var(--paper-lift)',
                        border: `1px solid ${isActive ? 'var(--accent)' : 'var(--line-soft)'}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 7,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ position: 'relative' }}>
                        <Artwork src={t.artwork} size={128} />
                        <div style={{ position: 'absolute', top: 5, left: 5 }}>
                          <ProviderBadge track={t} />
                        </div>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: isActive ? 'var(--accent)' : 'var(--ink)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {t.title}
                        </div>
                        <div
                          style={{
                            fontSize: 11.5,
                            color: 'var(--ink-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginTop: 1,
                          }}
                        >
                          {t.artist}
                        </div>
                      </div>
                      <div
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="font-mono-tech" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
                          {isActive ? '● PLAYING' : 'TAP ▶'}
                        </span>
                        <OfflineButton track={t} compact />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
