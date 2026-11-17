import React, { useRef, useState } from 'react';
import { AudioProvider, useAudio } from './audio/AudioContextProvider';
import { AppViewMode, LibraryPage as LibraryPageKind, LibraryTab } from './audio/types';
import { Backdrop } from './components/Backdrop';
import { BentoPlayerCard } from './components/BentoPlayerCard';
import { FullVisualizerCard } from './components/FullVisualizerCard';
import { NowPlayingStage } from './components/NowPlayingStage';
import { PlayerBar } from './components/PlayerBar';
import { SidebarDrawer } from './components/SidebarDrawer';
import { SoundDialog } from './components/SoundDialog';
import { Toast } from './components/Toast';
import { TopMediaBar } from './components/TopMediaBar';
import { VolumeOsd } from './components/VolumeOsd';
import { Icon } from './icons/Icon';
import { DetailPage } from './pages/DetailPages';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { ThemeProvider, useTheme } from './theme/ThemeContext';

const RyotunesShell: React.FC = () => {
  const { currentTrack, importLocalFiles, syncDeviceLibrary, isNativeAndroid, triggerOsd } = useAudio();
  const { bentoTokens } = useTheme();
  const [viewMode, setViewMode] = useState<AppViewMode>('bento');
  const [libPage, setLibPage] = useState<LibraryPageKind>('home');
  const [libParam, setLibParam] = useState<string>('');
  const [libTab, setLibTab] = useState<LibraryTab>('songs');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const quickFileRef = useRef<HTMLInputElement | null>(null);

  const navigateLibrary = (page: LibraryPageKind, param = '', tab: LibraryTab = 'songs') => {
    setLibPage(page);
    setLibParam(param);
    setLibTab(tab);
    setViewMode('library');
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: viewMode === 'library' ? 'var(--paper)' : bentoTokens.bgDeep,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <input
        ref={quickFileRef}
        type="file"
        accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) importLocalFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Persistent Top Media.qml Capsule Bar */}
      <TopMediaBar
        viewMode={viewMode}
        onToggleBentoOrViz={() => setViewMode((m) => (m === 'visualizer' ? 'bento' : 'visualizer'))}
        onToggleLibrary={() => setViewMode((m) => (m === 'library' ? 'bento' : 'library'))}
      />

      {/* VIEW 1 & 2: NOTHING OS x RYOKU PURPLE BENTO HUB & FULL VISUALIZER */}
      {(viewMode === 'bento' || viewMode === 'visualizer') && (
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 14px calc(var(--safe-bottom) + 20px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
            background: bentoTokens.gradientBg,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            {/* Primary 1:1 PlayerControl.qml Bento Card */}
            <BentoPlayerCard
              onOpenLibrary={() => setViewMode('library')}
              onOpenNowPlaying={() => setNowPlayingOpen(true)}
            />

            {/* VisualizerWidget.qml 38-col LED Matrix Card */}
            <FullVisualizerCard tall={viewMode === 'visualizer'} />

            {/* Quick Instrument Controls Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <button
                type="button"
                onClick={() => (isNativeAndroid ? syncDeviceLibrary(true) : quickFileRef.current?.click())}
                className="ryo-pressable"
                style={{
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: bentoTokens.bgSurface,
                  border: `1px solid ${bentoTokens.borderDim}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  cursor: 'pointer',
                }}
              >
                <Icon name="folder" size={14} color={bentoTokens.accentLavender} />
                <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 8.5, color: bentoTokens.ink }}>
                  {isNativeAndroid ? 'SYNC LOCAL' : 'LOAD AUDIO'}
                </span>
              </button>

              <button
                type="button"
                onClick={triggerOsd}
                className="ryo-pressable"
                style={{
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: bentoTokens.bgSurface,
                  border: `1px solid ${bentoTokens.borderDim}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  cursor: 'pointer',
                }}
              >
                <Icon name="volume" size={14} color={bentoTokens.accentLavender} />
                <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 8.5, color: bentoTokens.ink }}>
                  VOL OSD
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSoundOpen(true)}
                className="ryo-pressable"
                style={{
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: bentoTokens.bgSurface,
                  border: `1px solid ${bentoTokens.borderDim}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  cursor: 'pointer',
                }}
              >
                <Icon name="sound" size={14} color={bentoTokens.accentLavender} />
                <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 8.5, color: bentoTokens.ink }}>
                  SOUND FX
                </span>
              </button>

              <button
                type="button"
                onClick={() => setNowPlayingOpen(true)}
                className="ryo-pressable"
                style={{
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: bentoTokens.bgSurface,
                  border: `1px solid ${bentoTokens.borderDim}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  cursor: 'pointer',
                }}
              >
                <Icon name="mic" size={14} color={bentoTokens.accentLavender} />
                <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 8.5, color: bentoTokens.ink }}>
                  LYRICS
                </span>
              </button>
            </div>
          </div>
        </main>
      )}

      {/* VIEW 3: FULL RYOTUNES LIBRARY (colors.json Ryoku Purple + Skins) */}
      {viewMode === 'library' && (
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Backdrop artwork={currentTrack?.artwork} strength={0.22} />

          {/* Library Sub-Header (TitleBar.qml mobile adaptation) */}
          <div
            style={{
              position: 'relative',
              height: 44,
              padding: '0 12px',
              borderBottom: '1px solid var(--line-soft)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              backgroundColor: 'var(--paper)',
            }}
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation rail"
              className="ryo-pressable"
              style={{
                width: 34,
                height: 34,
                borderRadius: 'var(--radius)',
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Icon name="sidebar" size={18} color="var(--ink)" />
            </button>

            <span className="font-ndot" style={{ fontSize: 12, color: 'var(--ink)', letterSpacing: 1.4 }}>
              RYOTUNES // {libPage.toUpperCase()}
            </span>

            <div style={{ flex: 1 }} />

            <button
              type="button"
              onClick={() => navigateLibrary('search')}
              aria-label="Search"
              className="ryo-pressable"
              style={{
                width: 34,
                height: 34,
                borderRadius: 'var(--radius)',
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Icon name="search" size={17} color="var(--ink-muted)" />
            </button>

            <button
              type="button"
              onClick={() => navigateLibrary('settings')}
              aria-label="Settings"
              className="ryo-pressable"
              style={{
                width: 34,
                height: 34,
                borderRadius: 'var(--radius)',
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Icon name="settings" size={17} color="var(--ink-muted)" />
            </button>
          </div>

          {/* Routed Library Page */}
          <div style={{ position: 'relative', flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>
            {libPage === 'home' && (
              <HomePage onNavigate={navigateLibrary} onOpenBento={() => setViewMode('bento')} />
            )}
            {libPage === 'library' && (
              <LibraryPage initialTab={libTab} onNavigate={(p, param) => navigateLibrary(p, param)} />
            )}
            {libPage === 'search' && <SearchPage initialQuery={libParam} />}
            {(libPage === 'playlist' || libPage === 'album' || libPage === 'artist') && (
              <DetailPage kind={libPage} id={libParam} onBack={() => navigateLibrary('library')} />
            )}
            {libPage === 'settings' && (
              <SettingsPage
                onOpenLibrary={(page = 'home', param = '', tab = 'songs') => navigateLibrary(page, param, tab)}
                onOpenSound={() => setSoundOpen(true)}
              />
            )}
          </div>

          <PlayerBar
            onOpenNowPlaying={() => setNowPlayingOpen(true)}
            onOpenSound={() => setSoundOpen(true)}
          />
        </div>
      )}

      {/* Overlays & Modals */}
      <SidebarDrawer
        open={drawerOpen}
        activePage={libPage}
        onSelectPage={(p, param, tab) => navigateLibrary(p, param, tab)}
        onOpenBento={() => setViewMode('bento')}
        onClose={() => setDrawerOpen(false)}
      />

      <NowPlayingStage
        open={nowPlayingOpen}
        onClose={() => setNowPlayingOpen(false)}
        onOpenSound={() => setSoundOpen(true)}
      />

      <SoundDialog open={soundOpen} onClose={() => setSoundOpen(false)} />
      <VolumeOsd />
      <Toast />
    </div>
  );
};

export function App() {
  return (
    <ThemeProvider>
      <AudioProvider>
        <RyotunesShell />
      </AudioProvider>
    </ThemeProvider>
  );
}

export default App;
