import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AudioProvider, useAudio } from './audio/AudioContextProvider';
import { RyotunesNativeMedia } from './audio/NativeMediaBridge';
import { GithubUpdateInfo, LibraryPage as LibraryPageKind, LibraryTab } from './audio/types';
import { Backdrop } from './components/Backdrop';
import { BentoPlayerCard, StageCenterMode } from './components/BentoPlayerCard';
import { BottomNavBar, MainTab } from './components/BottomNavBar';
import { FloatingMiniPlayer } from './components/FloatingMiniPlayer';
import { NowPlayingStage } from './components/NowPlayingStage';
import { SidebarDrawer } from './components/SidebarDrawer';
import { SoundDialog } from './components/SoundDialog';
import { Toast } from './components/Toast';
import { TopMediaBar } from './components/TopMediaBar';
import { UpdateBannerModal } from './components/UpdateBannerModal';
import { VolumeOsd } from './components/VolumeOsd';
import { WelcomeModal } from './components/WelcomeModal';
import { Icon } from './icons/Icon';
import { DetailPage } from './pages/DetailPages';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage, SettingsTab } from './pages/SettingsPage';
import { ThemeProvider, useTheme } from './theme/ThemeContext';

const RyotunesShell: React.FC = () => {
  const {
    currentTrack,
    importLocalFiles,
    syncDeviceLibrary,
    isNativeAndroid,
    showToast,
    loadingRecommendations,
    refreshRecommendations,
  } = useAudio();
  const { bentoTokens } = useTheme();
  const [activeTab, setActiveTab] = useState<MainTab>('stage');
  const [stageCenterMode, setStageCenterMode] = useState<StageCenterMode>('art');
  const [exploreSubView, setExploreSubView] = useState<'search' | 'home'>('search');
  const [libSubPage, setLibSubPage] = useState<'library' | 'playlist' | 'album' | 'artist'>('library');
  const [libParam, setLibParam] = useState<string>('');
  const [libTab, setLibTab] = useState<LibraryTab>('songs');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('accounts');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ryotunes_onboarded') !== 'true';
    } catch {
      return false;
    }
  });
  const [appVersionLabel, setAppVersionLabel] = useState<string>('v1.3.0-beta.1');
  const [updateInfo, setUpdateInfo] = useState<GithubUpdateInfo | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState<boolean>(false);
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false);
  const [updateStatusText, setUpdateStatusText] = useState<string>('');
  const quickFileRef = useRef<HTMLInputElement | null>(null);

  const checkForUpdates = useCallback(
    async (interactive: boolean) => {
      if (!isNativeAndroid) {
        if (interactive) showToast('Las actualizaciones OTA automáticas corren en Android', 'info');
        return;
      }
      setCheckingUpdate(true);
      try {
        const info = await RyotunesNativeMedia.checkGithubUpdate();
        setUpdateInfo(info);
        if (info.currentVersion) {
          setAppVersionLabel(`v${info.currentVersion}`);
        }
        if (info.hasUpdate) {
          setUpdateStatusText(`Nueva versión disponible: v${info.latestVersion}`);
          setUpdateModalOpen(true);
        } else {
          const msg = `Ya tienes la última versión (v${info.currentVersion || '1.3.0-beta.1'})`;
          setUpdateStatusText(msg);
          if (interactive) showToast(msg, 'success');
        }
      } catch (err) {
        if (interactive) {
          showToast(
            err instanceof Error ? err.message : 'No se pudo comprobar actualizaciones',
            'error'
          );
        }
      } finally {
        setCheckingUpdate(false);
      }
    },
    [isNativeAndroid, showToast]
  );

  useEffect(() => {
    if (!isNativeAndroid) return;
    RyotunesNativeMedia.getAppVersionInfo()
      .then((info) => {
        if (info?.versionName) setAppVersionLabel(`v${info.versionName}`);
      })
      .catch(() => {});
    const timer = window.setTimeout(() => {
      void checkForUpdates(false);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [isNativeAndroid, checkForUpdates]);

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
      if (
        param === 'accounts' ||
        param === 'appearance' ||
        param === 'playback' ||
        param === 'storage' ||
        param === 'widget'
      ) {
        setSettingsTab(param);
      }
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

      {/* Persistent Top Media.qml Capsule Bar (shown outside STAGE to avoid duplicating active track info) */}
      {activeTab !== 'stage' && (
        <TopMediaBar
          viewMode={activeTab}
          onToggleBentoOrViz={() => setActiveTab('stage')}
          onToggleLibrary={() => setActiveTab((t) => (t === 'library' ? 'stage' : 'library'))}
          onOpenSound={() => setSoundOpen(true)}
        />
      )}

      {/* TAB 01 · STAGE: Unified Flagship Mobile Console */}
      {activeTab === 'stage' && (
        <main
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            paddingTop: 'calc(var(--safe-top) + 10px)',
            paddingLeft: 'calc(var(--safe-left) + 14px)',
            paddingRight: 'calc(var(--safe-right) + 14px)',
            paddingBottom: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            background: bentoTokens.gradientBg,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
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
              onOpenSound={() => setSoundOpen(true)}
              onOpenStudio={() => setActiveTab('studio')}
            />

            <button
              type="button"
              onClick={() => (isNativeAndroid ? syncDeviceLibrary(true) : quickFileRef.current?.click())}
              className="ryo-pressable"
              style={{
                height: 30,
                padding: '0 14px',
                borderRadius: 999,
                backgroundColor: bentoTokens.bgSurface,
                border: `1px solid ${bentoTokens.borderDim}`,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <Icon name="folder" size={12} color={bentoTokens.accentLavender} />
              <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 9, color: bentoTokens.muted }}>
                {isNativeAndroid ? 'SYNC DEVICE LIBRARY' : 'IMPORT LOCAL AUDIO'}
              </span>
            </button>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  disabled={loadingRecommendations}
                  onClick={() => void refreshRecommendations(true)}
                  aria-label="Actualizar recomendaciones"
                  className="font-mono-tech ryo-pressable"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    border: '1px solid var(--line)',
                    backgroundColor: 'var(--paper-lift)',
                    color: loadingRecommendations ? 'var(--accent)' : 'var(--ink)',
                    fontSize: 13,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: loadingRecommendations ? 'wait' : 'pointer',
                  }}
                >
                  ↻
                </button>
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
          <div
            style={{
              position: 'relative',
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '14px 14px calc(164px + env(safe-area-inset-bottom))',
            }}
          >
            {activeTab === 'explore' && exploreSubView === 'search' && (
              <SearchPage initialQuery={libParam} onNavigate={navigateLibrary} />
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
                initialTab={settingsTab}
                appVersionLabel={appVersionLabel}
                checkingUpdate={checkingUpdate}
                updateStatusText={updateStatusText}
                onCheckUpdates={() => void checkForUpdates(true)}
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
      <WelcomeModal
        open={welcomeOpen}
        onFinish={(openAccounts) => {
          setWelcomeOpen(false);
          if (openAccounts) {
            setSettingsTab('accounts');
            setActiveTab('studio');
          }
        }}
      />
      <UpdateBannerModal
        open={updateModalOpen}
        updateInfo={updateInfo}
        onClose={() => setUpdateModalOpen(false)}
      />
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
