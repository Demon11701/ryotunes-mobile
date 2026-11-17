import React, { useRef, useState } from 'react';
import { AudioProvider, useAudio } from './audio/AudioContextProvider';
import { LibraryPage as LibraryPageKind, LibraryTab } from './audio/types';
import { Backdrop } from './components/Backdrop';
import { BentoPlayerCard, StageCenterMode } from './components/BentoPlayerCard';
import { BottomNavBar, MainTab } from './components/BottomNavBar';
import { FloatingMiniPlayer } from './components/FloatingMiniPlayer';
import { NowPlayingStage } from './components/NowPlayingStage';
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
  const [activeTab, setActiveTab] = useState<MainTab>('stage');
  const [stageCenterMode, setStageCenterMode] = useState<StageCenterMode>('art');
  const [exploreSubView, setExploreSubView] = useState<'search' | 'home'>('search');
  const [libSubPage, setLibSubPage] = useState<'library' | 'playlist' | 'album' | 'artist'>('library');
  const [libParam, setLibParam] = useState<string>('');
  const [libTab, setLibTab] = useState<LibraryTab>('songs');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const quickFileRef = useRef<HTMLInputElement | null>(null);

  const navigateLibrary = (page: LibraryPageKind, param = '', tab: LibraryTab = 'songs') => {
    setLibParam(param);
    setLibTab(tab);
    if (page === 'home') {
      setExploreSubView('home');
      setActiveTab('explore');
    } else if (page === 'search') {
      setExploreSubView('search');
      setActiveTab('explore');
    } else if (page === 'settings') {
      setActiveTab('studio');
    } else {
      setLibSubPage(page);
      setActiveTab('library');
    }
  };

  const activeSkinPage: LibraryPageKind =
    activeTab === 'explore'
      ? exploreSubView
      : activeTab === 'studio'
      ? 'settings'
      : libSubPage;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: activeTab === 'stage' ? bentoTokens.bgDeep : 'var(--paper)',
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
        viewMode={activeTab}
        onToggleBentoOrViz={() => {
          if (activeTab !== 'stage') {
            setActiveTab('stage');
          } else {
            setStageCenterMode((m) => (m === 'spectrum' ? 'art' : 'spectrum'));
          }
        }}
        onToggleLibrary={() => setActiveTab((t) => (t === 'library' ? 'stage' : 'library'))}
        onOpenSound={() => setSoundOpen(true)}
      />

      {/* TAB 01 · STAGE: Unified Bento Console (Zero Duplicate Visualizers) */}
      {activeTab === 'stage' && (
        <main
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '12px 14px 14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: bentoTokens.gradientBg,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <BentoPlayerCard
              centerMode={stageCenterMode}
              onChangeCenterMode={setStageCenterMode}
              onOpenLibrary={() => {
                setLibSubPage('library');
                setActiveTab('library');
              }}
              onOpenNowPlaying={() => setNowPlayingOpen(true)}
            />

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
                <Icon name="expand" size={14} color={bentoTokens.accentLavender} />
                <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 8.5, color: bentoTokens.ink }}>
                  FULL VIEW
                </span>
              </button>
            </div>
          </div>
        </main>
      )}

      {/* TABS 02 · EXPLORE / 03 · LIBRARY / 04 · STUDIO */}
      {activeTab !== 'stage' && (
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Backdrop artwork={currentTrack?.artwork} strength={0.22} />

          {/* Section Sub-Header */}
          <div
            style={{
              position: 'relative',
              height: 42,
              padding: '0 12px',
              borderBottom: '1px solid var(--line-soft)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              backgroundColor: 'var(--paper)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation rail"
              className="ryo-pressable"
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius)',
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Icon name="sidebar" size={17} color="var(--ink)" />
            </button>

            <span className="font-ndot" style={{ fontSize: 11.5, color: 'var(--ink)', letterSpacing: 1.3 }}>
              {activeTab === 'explore'
                ? exploreSubView === 'search'
                  ? '02 · EXPLORE // PROVIDERS'
                  : '02 · EXPLORE // HOME'
                : activeTab === 'library'
                ? `03 · LIBRARY // ${libSubPage.toUpperCase()}`
                : '04 · STUDIO // RYOTUNES'}
            </span>

            <div style={{ flex: 1 }} />

            {activeTab === 'explore' && (
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  padding: 2,
                  borderRadius: 999,
                  backgroundColor: 'var(--paper-lift)',
                  border: '1px solid var(--line-soft)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setExploreSubView('search')}
                  className="font-mono-tech ryo-pressable"
                  style={{
                    height: 24,
                    padding: '0 9px',
                    borderRadius: 999,
                    border: 'none',
                    backgroundColor: exploreSubView === 'search' ? 'var(--bone)' : 'transparent',
                    color: exploreSubView === 'search' ? 'var(--ink-on-bone)' : 'var(--ink-muted)',
                    fontSize: 9.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  SEARCH
                </button>
                <button
                  type="button"
                  onClick={() => setExploreSubView('home')}
                  className="font-mono-tech ryo-pressable"
                  style={{
                    height: 24,
                    padding: '0 9px',
                    borderRadius: 999,
                    border: 'none',
                    backgroundColor: exploreSubView === 'home' ? 'var(--bone)' : 'transparent',
                    color: exploreSubView === 'home' ? 'var(--ink-on-bone)' : 'var(--ink-muted)',
                    fontSize: 9.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  HOME
                </button>
              </div>
            )}

            {activeTab === 'studio' && (
              <button
                type="button"
                onClick={() => setSoundOpen(true)}
                className="font-mono-tech ryo-pressable"
                style={{
                  height: 26,
                  padding: '0 10px',
                  borderRadius: 999,
                  backgroundColor: 'var(--accent-soft)',
                  border: '1px solid var(--accent)',
                  color: 'var(--accent)',
                  fontSize: 9.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                DSP STUDIO
              </button>
            )}
          </div>

          {/* Active Tab Scroll Content */}
          <div style={{ position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 14px 8px' }}>
            {activeTab === 'explore' && exploreSubView === 'search' && (
              <SearchPage initialQuery={libParam} />
            )}
            {activeTab === 'explore' && exploreSubView === 'home' && (
              <HomePage onNavigate={navigateLibrary} onOpenBento={() => setActiveTab('stage')} />
            )}

            {activeTab === 'library' && libSubPage === 'library' && (
              <LibraryPage
                initialTab={libTab}
                onNavigate={(p, param) => navigateLibrary(p, param)}
              />
            )}
            {activeTab === 'library' && (libSubPage === 'playlist' || libSubPage === 'album' || libSubPage === 'artist') && (
              <DetailPage
                kind={libSubPage}
                id={libParam}
                onBack={() => setLibSubPage('library')}
              />
            )}

            {activeTab === 'studio' && (
              <SettingsPage
                onOpenLibrary={(page = 'home', param = '', tab = 'songs') => navigateLibrary(page, param, tab)}
                onOpenSound={() => setSoundOpen(true)}
              />
            )}
          </div>

          {/* Floating Bento Mini-Player Capsule above Bottom Navigation */}
          <FloatingMiniPlayer onOpenStage={() => setActiveTab('stage')} />
        </div>
      )}

      {/* Fixed 4-Tab Bottom Navigation Bar */}
      <BottomNavBar activeTab={activeTab} onSelectTab={setActiveTab} />

      {/* Overlays & Modals */}
      <SidebarDrawer
        open={drawerOpen}
        activePage={activeSkinPage}
        onSelectPage={(p, param, tab) => navigateLibrary(p, param, tab)}
        onOpenBento={() => setActiveTab('stage')}
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
