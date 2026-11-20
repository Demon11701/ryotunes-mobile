import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { searchOnlineTracks } from '../audio/providerService';
import { LibraryPage, LibraryTab, OnlineProviderFilter, Track } from '../audio/types';
import { Artwork } from '../components/Artwork';
import { OfflineButton } from '../components/OfflineButton';
import { ProviderBadge } from '../components/ProviderBadge';
import { RecommendationsFeed } from '../components/RecommendationsFeed';
import { TrackRow } from '../components/TrackRow';
import { Icon } from '../icons/Icon';
import { PROVIDER_COLORS } from '../theme/skins';
import { useTheme } from '../theme/ThemeContext';

interface SearchPageProps {
  initialQuery?: string;
  onNavigate?: (page: LibraryPage, param?: string, tab?: LibraryTab) => void;
}

const PROVIDERS: { key: OnlineProviderFilter; label: string; icon: string; color: string }[] = [
  { key: 'all', label: 'All', icon: 'search', color: 'var(--accent)' },
  { key: 'youtube', label: 'YouTube', icon: 'youtube-music', color: PROVIDER_COLORS.youtube },
  { key: 'spotify', label: 'Spotify', icon: 'spotify', color: PROVIDER_COLORS.spotify },
  { key: 'soundcloud', label: 'SoundCloud', icon: 'soundcloud', color: PROVIDER_COLORS.soundcloud },
  { key: 'tidal', label: 'TIDAL', icon: 'tidal', color: PROVIDER_COLORS.tidal },
  { key: 'offline', label: 'Offline / Local', icon: 'folder', color: 'var(--ink)' },
];

export const SearchPage: React.FC<SearchPageProps> = ({ initialQuery = '', onNavigate }) => {
  const { tracks, currentTrack, playTrack, showToast } = useAudio();
  const { decor } = useTheme();
  const [query, setQuery] = useState(initialQuery);
  const [provider, setProvider] = useState<OnlineProviderFilter>('all');
  const [onlineResults, setOnlineResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const localMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base =
      provider === 'offline' ? tracks.filter((t) => t.offline || t.source === 'local') : tracks;
    if (!q) return base;
    return base.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
    );
  }, [tracks, query, provider]);

  const runSearch = useCallback(
    async (qText: string, prov: OnlineProviderFilter) => {
      const cleaned = qText.trim();
      if (!cleaned || prov === 'offline') {
        setOnlineResults([]);
        setErrorMsg('');
        setSearching(false);
        return;
      }
      setSearching(true);
      setErrorMsg('');
      try {
        const res = await searchOnlineTracks(cleaned, prov);
        setOnlineResults(res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network unavailable';
        setErrorMsg(`Online search unavailable (${msg}). Showing cached/local tracks.`);
        setOnlineResults([]);
        showToast('Online search failed — check connection', 'info');
      } finally {
        setSearching(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (initialQuery.trim()) {
      runSearch(initialQuery, provider);
    }
  }, [initialQuery, runSearch]); // run on initial route

  const displayedResults = useMemo(() => {
    if (provider === 'offline' || !query.trim()) return localMatches;
    const offlineFirst = localMatches.filter((t) => t.offline || t.source === 'local');
    const seen = new Set(offlineFirst.map((t) => t.id));
    const merged = [...offlineFirst];
    for (const item of onlineResults) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
    return merged.length > 0 ? merged : localMatches;
  }, [provider, query, localMatches, onlineResults]);

  const topHit = query.trim() && displayedResults.length > 0 ? displayedResults[0] : null;

  return (
    <div className="page-reenter" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 24 }}>
      <div>
        <div className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>
          // MUSIC / DISCOVERY {decor === 'rich' ? '· 探' : ''}
        </div>
        <h1 className="font-display-ryo" style={{ margin: '4px 0 0', fontSize: 32, color: 'var(--ink)' }}>
          Search Providers
        </h1>
      </div>

      {/* Search Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query, provider);
        }}
        style={{
          height: 44,
          borderRadius: 'var(--radius)',
          backgroundColor: 'var(--paper-lift)',
          border: '1px solid var(--line-strong)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 8px 0 12px',
        }}
      >
        <Icon name="search" size={16} color="var(--ink-muted)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search YouTube Music, Spotify, SoundCloud, TIDAL…"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--ink)',
            fontSize: 14,
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setOnlineResults([]);
              setErrorMsg('');
            }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
          >
            <Icon name="close" size={15} color="var(--ink-muted)" />
          </button>
        )}
        <button
          type="submit"
          className="ryo-pressable"
          style={{
            height: 30,
            padding: '0 12px',
            borderRadius: 'calc(var(--radius) - 1px)',
            backgroundColor: 'var(--bone)',
            color: 'var(--ink-on-bone)',
            border: 'none',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Go
        </button>
      </form>

      {/* Provider Switcher Strip (matching TitleBar.qml) */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {PROVIDERS.map((p) => {
          const active = provider === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setProvider(p.key);
                if (query.trim()) runSearch(query, p.key);
              }}
              className="ryo-pressable"
              style={{
                height: 32,
                padding: '0 12px',
                borderRadius: 999,
                border: `1px solid ${active ? p.color : 'var(--line)'}`,
                backgroundColor: active ? 'var(--paper-lift)' : 'transparent',
                color: active ? p.color : 'var(--ink-muted)',
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Icon name={p.icon} size={13} color={active ? p.color : 'var(--ink-muted)'} />
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>

      {searching && (
        <div
          className="font-mono-tech"
          style={{
            padding: 14,
            borderRadius: 'var(--radius)',
            backgroundColor: 'var(--paper-lift)',
            border: '1px solid var(--line-soft)',
            fontSize: 11,
            color: 'var(--accent)',
          }}
        >
          RESOLVING STREAMS ACROSS {provider.toUpperCase()}…
        </div>
      )}

      {errorMsg && (
        <div style={{ fontSize: 12.5, color: 'var(--alert)', padding: '6px 10px', borderRadius: 'var(--radius)', backgroundColor: 'var(--paper-lift)' }}>
          {errorMsg}
        </div>
      )}

      {/* Top Result Hero */}
      {topHit && !searching && (
        <div
          onClick={() => playTrack(topHit, displayedResults)}
          className="ryo-pressable"
          style={{
            padding: 12,
            borderRadius: 'var(--radius-card)',
            backgroundColor: 'var(--paper-lift)',
            border: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer',
          }}
        >
          <Artwork src={topHit.artwork} size={68} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="font-mono-tech" style={{ fontSize: 9, color: 'var(--ink-faint)', letterSpacing: 1.2 }}>
                TOP RESULT
              </span>
              <ProviderBadge track={topHit} />
            </div>
            <div
              className="font-display-ryo"
              style={{ fontSize: 18, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {topHit.title}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {topHit.artist} · {topHit.album}
            </div>
          </div>
          <OfflineButton track={topHit} />
        </div>
      )}

      {/* Live Recommendations & Connected Playlists when search bar is empty */}
      {!query.trim() && provider !== 'offline' && (
        <RecommendationsFeed
          providerFilter={provider}
          onNavigate={(page, param, tab) => onNavigate?.(page, param, tab)}
        />
      )}

      {/* Search Results / Offline Filter */}
      {(query.trim().length > 0 || provider === 'offline') && (
        <>
          <div className="font-mono-tech" style={{ fontSize: 10.5, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>
            {displayedResults.length} RESULT{displayedResults.length === 1 ? '' : 'S'}
          </div>

          <div>
            {displayedResults.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                index={i}
                active={currentTrack?.id === t.id}
                onPlay={() => playTrack(t, displayedResults)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
