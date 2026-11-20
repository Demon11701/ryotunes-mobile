import React, { useState } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { LibraryPage, LibraryTab } from '../audio/types';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeContext';
import { Artwork } from './Artwork';
import { RegCanvas } from './RegCanvas';

interface SidebarDrawerProps {
  open: boolean;
  activePage: LibraryPage;
  onSelectPage: (page: LibraryPage, param?: string, tab?: LibraryTab) => void;
  onOpenBento: () => void;
  onClose: () => void;
}

/**
 * Port of /usr/share/ryotunes/client/chrome/Sidebar.qml as a mobile slide-over drawer.
 */
export const SidebarDrawer: React.FC<SidebarDrawerProps> = ({
  open,
  activePage,
  onSelectPage,
  onOpenBento,
  onClose,
}) => {
  const { playlists, tracks, offlineTracks, isPlaying, createPlaylist } = useAudio();
  const { decor } = useTheme();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  if (!open) return null;

  const trackMap = new Map(tracks.map((t) => [t.id, t]));

  const NavRow: React.FC<{
    label: string;
    icon: string;
    kana: string;
    current: boolean;
    onClick: () => void;
  }> = ({ label, icon, kana, current, onClick }) => (
    <button
      type="button"
      onClick={() => {
        onClick();
        onClose();
      }}
      className="ryo-pressable"
      style={{
        position: 'relative',
        width: '100%',
        height: 40,
        borderRadius: 'var(--radius)',
        backgroundColor: current ? 'var(--paper-lift)' : 'transparent',
        border: 'none',
        padding: '0 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
      }}
    >
      {current && (
        <span
          style={{
            position: 'absolute',
            left: 0,
            width: 3,
            height: 22,
            borderRadius: 2,
            backgroundColor: 'var(--accent)',
          }}
        />
      )}
      <Icon name={icon} size={18} color={current ? 'var(--ink)' : 'var(--ink-muted)'} />
      <span
        style={{
          flex: 1,
          textAlign: 'left',
          fontSize: 15,
          fontWeight: current ? 500 : 400,
          color: current ? 'var(--ink)' : 'var(--ink-dim)',
        }}
      >
        {label}
      </span>
      {decor === 'rich' && (
        <span style={{ fontSize: 13, color: current ? 'var(--ink-muted)' : 'var(--ink-faint)' }}>{kana}</span>
      )}
    </button>
  );

  const SectionLabel: React.FC<{ num: string; label: string; seal: string }> = ({ num, label, seal }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 10px 4px' }}>
      <span className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>
        {num}
      </span>
      <span className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-muted)', letterSpacing: 1.4 }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, backgroundColor: 'var(--line-soft)' }} />
      {decor === 'rich' && <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{seal}</span>}
    </div>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 75,
        backgroundColor: 'rgba(5, 4, 8, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: 272,
          height: '100%',
          backgroundColor: 'var(--paper)',
          borderRight: '1px solid var(--line)',
          paddingTop: 'calc(var(--safe-top) + 10px)',
          paddingBottom: 'calc(var(--safe-bottom) + 12px)',
          paddingLeft: 10,
          paddingRight: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          overflow: 'hidden',
        }}
      >
        <RegCanvas opacity={0.7} />

        {/* Brand Card */}
        <div
          style={{
            position: 'relative',
            height: 56,
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--line-soft)',
            padding: '0 8px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 4,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--radius)',
              backgroundColor: '#000000',
              border: '1px solid var(--line-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <img
              src="./icons/cthz.png"
              alt="CTHz"
              style={{ width: 34, height: 34, objectFit: 'contain', display: 'block' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="font-ndot" style={{ fontSize: 15, color: 'var(--ink)', letterSpacing: 1.6 }}>
              CTHz
            </div>
            <div className="font-mono-tech" style={{ fontSize: 9.5, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>
              CTHz // HI-FI AUDIO
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius)',
              background: 'transparent',
              border: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name="rail-collapse" size={16} color="var(--ink-muted)" />
          </button>
        </div>

        {/* Nav Scroll Body */}
        <div style={{ position: 'relative', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <NavRow
            label="Bento Player"
            icon="cd"
            kana="核"
            current={false}
            onClick={onOpenBento}
          />

          <SectionLabel num="01" label="DISCOVER" seal="聴" />
          <NavRow label="Home" icon="home" kana="聴" current={activePage === 'home'} onClick={() => onSelectPage('home')} />
          <NavRow label="Search" icon="search" kana="探" current={activePage === 'search'} onClick={() => onSelectPage('search')} />

          <SectionLabel num="02" label="COLLECTION" seal="蔵" />
          <NavRow
            label="Library"
            icon="library"
            kana="蔵"
            current={activePage === 'library'}
            onClick={() => onSelectPage('library', '', 'songs')}
          />
          <NavRow
            label={`Offline (${offlineTracks.length})`}
            icon="download"
            kana="保"
            current={false}
            onClick={() => onSelectPage('library', '', 'offline')}
          />

          <SectionLabel num="03" label="SYSTEM" seal="設" />
          <NavRow
            label="Settings"
            icon="settings"
            kana="設"
            current={activePage === 'settings'}
            onClick={() => onSelectPage('settings')}
          />

          <SectionLabel num="04" label="PLAYLISTS" seal="列" />
          {creating ? (
            <div style={{ display: 'flex', gap: 6, padding: '4px 2px' }}>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTitle.trim()) {
                    const id = createPlaylist(newTitle);
                    setNewTitle('');
                    setCreating(false);
                    onSelectPage('playlist', id);
                    onClose();
                  }
                }}
                placeholder="Playlist name..."
                autoFocus
                style={{
                  flex: 1,
                  height: 34,
                  borderRadius: 'var(--radius)',
                  backgroundColor: 'var(--paper-lift)',
                  border: '1px solid var(--line-strong)',
                  color: 'var(--ink)',
                  padding: '0 8px',
                  fontSize: 13,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (newTitle.trim()) {
                    const id = createPlaylist(newTitle);
                    setNewTitle('');
                    setCreating(false);
                    onSelectPage('playlist', id);
                    onClose();
                  }
                }}
                style={{
                  height: 34,
                  padding: '0 10px',
                  borderRadius: 'var(--radius)',
                  backgroundColor: 'var(--bone)',
                  color: 'var(--ink-on-bone)',
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Add
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="ryo-pressable"
              style={{
                width: '100%',
                height: 36,
                margin: '4px 0',
                borderRadius: 'var(--radius)',
                backgroundColor: 'transparent',
                border: '1px solid var(--line)',
                color: 'var(--ink)',
                fontSize: 13.5,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <Icon name="add" size={14} color="var(--ink)" />
              <span>New playlist</span>
            </button>
          )}

          {playlists.map((pl) => {
            const firstTrack = pl.trackIds.map((id) => trackMap.get(id)).find((t) => t?.artwork);
            return (
              <button
                key={pl.id}
                type="button"
                onClick={() => {
                  onSelectPage('playlist', pl.id);
                  onClose();
                }}
                className="ryo-pressable"
                style={{
                  width: '100%',
                  height: 48,
                  padding: '0 8px',
                  borderRadius: 'var(--radius)',
                  backgroundColor: 'transparent',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                }}
              >
                <Artwork src={firstTrack?.artwork} size={36} placeholderIcon={pl.smart ? 'on-repeat' : 'playlist'} />
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: 'var(--ink)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {pl.title}
                  </div>
                  <div className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                    {pl.trackIds.length} SONGS
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Foot LIVE Register */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}>
          <span className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>
            RYOKU // MUSIC
          </span>
          <div style={{ flex: 1, height: 1, backgroundColor: 'var(--line-soft)' }} />
          <span
            className={isPlaying ? 'led-pulsing' : ''}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: isPlaying ? 'var(--accent)' : 'var(--ink-faint)',
            }}
          />
          <span
            className="font-mono-tech"
            style={{ fontSize: 10, color: isPlaying ? 'var(--ink-dim)' : 'var(--ink-faint)', letterSpacing: 1.4 }}
          >
            LIVE
          </span>
        </div>
      </aside>
    </div>
  );
};
