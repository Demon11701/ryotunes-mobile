import React, { useEffect, useState } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { AccountProviderId, AudioQuality, LibraryPage, LibraryTab } from '../audio/types';
import { DesktopWidgetCard } from '../components/DesktopWidgetCard';
import { Icon } from '../icons/Icon';
import { PROVIDER_COLORS } from '../theme/skins';
import { useTheme } from '../theme/ThemeContext';

export type SettingsTab = 'accounts' | 'appearance' | 'playback' | 'storage' | 'widget';

interface SettingsPageProps {
  initialTab?: SettingsTab;
  appVersionLabel?: string;
  checkingUpdate?: boolean;
  updateStatusText?: string;
  onCheckUpdates?: () => void;
  onOpenLibrary: (page?: LibraryPage, param?: string, tab?: LibraryTab) => void;
  onOpenSound: () => void;
}

const ACCOUNT_PROVIDERS: Array<{
  id: AccountProviderId;
  name: string;
  kanji: string;
  icon: string;
  color: string;
  hint: string;
}> = [
  {
    id: 'ytmusic',
    name: 'YouTube Music',
    kanji: '鍵',
    icon: 'youtube-music',
    color: PROVIDER_COLORS.youtube,
    hint: 'Sincroniza playlists guardadas y Me Gusta de tu cuenta Google.',
  },
  {
    id: 'spotify',
    name: 'Spotify',
    kanji: '緑',
    icon: 'spotify',
    color: PROVIDER_COLORS.spotify,
    hint: 'Sincroniza tus playlists y Tus Me Gusta de Spotify.',
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    kanji: '雲',
    icon: 'soundcloud',
    color: PROVIDER_COLORS.soundcloud,
    hint: 'Importa tus sets, playlists y likes de SoundCloud.',
  },
  {
    id: 'tidal',
    name: 'TIDAL',
    kanji: '潮',
    icon: 'tidal',
    color: PROVIDER_COLORS.tidal,
    hint: 'Sincroniza playlists Hi-Res y favoritos de TIDAL.',
  },
];

export const SettingsPage: React.FC<SettingsPageProps> = ({
  initialTab,
  appVersionLabel = 'v1.3.0-beta.1',
  checkingUpdate = false,
  updateStatusText,
  onCheckUpdates,
  onOpenLibrary,
  onOpenSound,
}) => {
  const {
    skinId,
    setSkinId,
    skins,
    themeModePref,
    setThemeModePref,
    mode,
    modeMissing,
    decorPref,
    setDecorPref,
    decor,
    accentPolicy,
    setAccentPolicy,
    washOverride,
    setWashOverride,
    effectiveWash,
    uiScale,
    setUiScale,
    bentoThemeMode,
    setBentoThemeMode,
    seekbarStyle,
    setSeekbarStyle,
    visualizerStyle,
    setVisualizerStyle,
    providerGlowEnabled,
    setProviderGlowEnabled,
    blurEnabled,
    setBlurEnabled,
    skin,
  } = useTheme();

  const {
    audioQuality,
    setAudioQuality,
    autoplay,
    setAutoplay,
    preventDuplicates,
    setPreventDuplicates,
    offlineTracks,
    clearOfflineAndCache,
    syncDeviceLibrary,
    isNativeAndroid,
    accounts,
    syncingAccount,
    importingPlaylistUrl,
    connectAccount,
    disconnectAccount,
    syncAccount,
    importPlaylistUrl,
  } = useAudio();

  const [section, setSection] = useState<SettingsTab>(initialTab || 'accounts');
  const [playlistUrlInput, setPlaylistUrlInput] = useState('');

  useEffect(() => {
    if (initialTab) setSection(initialTab);
  }, [initialTab]);

  const totalOfflineMb = (
    offlineTracks.reduce((acc, t) => acc + (t.offlineSizeBytes || 0), 0) /
    (1024 * 1024)
  ).toFixed(1);

  const ChipButton: React.FC<{
    label: string;
    active: boolean;
    disabled?: boolean;
    onClick: () => void;
  }> = ({ label, active, disabled = false, onClick }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="ryo-pressable"
      style={{
        height: 30,
        padding: '0 12px',
        borderRadius: 999,
        border: `1px solid ${active ? 'var(--bone)' : 'var(--line)'}`,
        backgroundColor: active ? 'var(--bone)' : 'transparent',
        color: active ? 'var(--ink-on-bone)' : 'var(--ink-muted)',
        opacity: disabled ? 0.38 : 1,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );

  const SectionHead: React.FC<{ title: string; mark: string }> = ({ title, mark }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
      <span className="font-mono-tech" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink)' }}>
        // {title}
      </span>
      <div style={{ flex: 1, height: 1, backgroundColor: 'var(--line-soft)' }} />
      {decor === 'rich' && <span style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>{mark}</span>}
    </div>
  );

  const ToggleRow: React.FC<{
    title: string;
    desc: string;
    value: boolean;
    onToggle: (next: boolean) => void;
  }> = ({ title, desc, value, onToggle }) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 'var(--radius-card)',
        backgroundColor: 'var(--paper-lift)',
        border: '1px solid var(--line-soft)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>{desc}</div>
      </div>
      <button
        type="button"
        onClick={() => onToggle(!value)}
        aria-pressed={value}
        className="ryo-pressable"
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          padding: 2,
          border: `1px solid ${value ? 'var(--accent)' : 'var(--line)'}`,
          backgroundColor: value ? 'var(--accent)' : 'var(--paper)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: value ? 'flex-end' : 'flex-start',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: value ? '#FFFFFF' : 'var(--ink-muted)',
          }}
        />
      </button>
    </div>
  );

  return (
    <div
      className="page-reenter"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        paddingBottom: 'calc(164px + env(safe-area-inset-bottom))',
      }}
    >
      <div>
        <div className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>
          力 // RYOTUNES SETTINGS {decor === 'rich' ? '· 設定' : ''}
        </div>
        <h1 className="font-display-ryo" style={{ margin: '4px 0 0', fontSize: 32, color: 'var(--ink)' }}>
          Personalization &amp; Audio
        </h1>
      </div>

      {/* Section Tabs */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {(
          [
            { k: 'accounts', l: 'Accounts · 鍵' },
            { k: 'appearance', l: 'Appearance · 表示' },
            { k: 'playback', l: 'Sound & Engine · 音響' },
            { k: 'storage', l: 'Providers & Offline · 保存' },
            { k: 'widget', l: 'Home Widget · 窓' },
          ] as { k: SettingsTab; l: string }[]
        ).map((t) => (
          <ChipButton key={t.k} label={t.l} active={section === t.k} onClick={() => setSection(t.k)} />
        ))}
      </div>

      {/* ── SECTION 0: ACCOUNTS // CLOUD SYNC & PLAYLIST URL IMPORT ──────────── */}
      {section === 'accounts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionHead title="ACCOUNTS // CLOUD SYNC" mark="鍵" />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
            {ACCOUNT_PROVIDERS.map((prov) => {
              const st = accounts[prov.id];
              const connected = Boolean(st?.connected);
              const isSyncing = syncingAccount === prov.id;
              return (
                <div
                  key={prov.id}
                  style={{
                    padding: 14,
                    borderRadius: 'var(--radius-card)',
                    backgroundColor: 'var(--paper-lift)',
                    border: `1.5px solid ${connected ? prov.color : 'var(--line-soft)'}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <Icon name={prov.icon} size={19} color={prov.color} />
                      <span
                        style={{
                          fontSize: 14.5,
                          fontWeight: 600,
                          color: 'var(--ink)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {prov.name}
                      </span>
                      {decor === 'rich' && (
                        <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{prov.kanji}</span>
                      )}
                    </div>

                    <span
                      className="font-mono-tech"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '3px 8px',
                        borderRadius: 999,
                        fontSize: 9.5,
                        fontWeight: 700,
                        backgroundColor: connected ? 'rgba(74, 222, 128, 0.14)' : 'var(--paper)',
                        border: `1px solid ${connected ? '#4ADE80' : 'var(--line)'}`,
                        color: connected ? '#4ADE80' : 'var(--ink-faint)',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          backgroundColor: connected ? '#4ADE80' : 'var(--ink-faint)',
                        }}
                      />
                      {connected ? 'CONNECTED' : 'OFFLINE'}
                    </span>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.4 }}>
                    {connected && st?.accountName ? `Sesión activa: ${st.accountName}` : prov.hint}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                    {!connected ? (
                      <button
                        type="button"
                        onClick={() => void connectAccount(prov.id)}
                        className="font-mono-tech ryo-pressable"
                        style={{
                          height: 32,
                          padding: '0 14px',
                          borderRadius: 999,
                          backgroundColor: prov.color,
                          color: '#FFFFFF',
                          border: 'none',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        CONECTAR
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isSyncing}
                          onClick={async () => {
                            const r = await syncAccount(prov.id);
                            if (r.playlistCount > 0) {
                              onOpenLibrary('library', '', 'playlists');
                            }
                          }}
                          className="font-mono-tech ryo-pressable"
                          style={{
                            height: 32,
                            padding: '0 14px',
                            borderRadius: 999,
                            backgroundColor: 'var(--bone)',
                            color: 'var(--ink-on-bone)',
                            border: 'none',
                            fontSize: 11,
                            fontWeight: 700,
                            opacity: isSyncing ? 0.65 : 1,
                            cursor: isSyncing ? 'wait' : 'pointer',
                          }}
                        >
                          {isSyncing ? 'SINCRONIZANDO…' : 'SINCRONIZAR'}
                        </button>
                        <button
                          type="button"
                          disabled={isSyncing}
                          onClick={() => void disconnectAccount(prov.id)}
                          className="font-mono-tech ryo-pressable"
                          style={{
                            height: 32,
                            padding: '0 12px',
                            borderRadius: 999,
                            backgroundColor: 'transparent',
                            color: 'var(--ink-muted)',
                            border: '1px solid var(--line)',
                            fontSize: 10.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          DESCONECTAR
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <SectionHead title="IMPORTAR PLAYLIST POR ENLACE" mark="経" />

          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-card)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-soft)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.45 }}>
              Pega cualquier enlace público de playlist de YouTube Music, Spotify, SoundCloud o TIDAL para añadirla al instante a tu biblioteca y poder descargarla offline.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="url"
                value={playlistUrlInput}
                onChange={(e) => setPlaylistUrlInput(e.target.value)}
                placeholder="https://music.youtube.com/playlist?list=... o open.spotify.com/playlist/..."
                style={{
                  flex: '1 1 220px',
                  height: 38,
                  borderRadius: 'var(--radius)',
                  backgroundColor: 'var(--paper)',
                  border: '1px solid var(--line)',
                  color: 'var(--ink)',
                  padding: '0 12px',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                disabled={importingPlaylistUrl || !playlistUrlInput.trim()}
                onClick={async () => {
                  const imported = await importPlaylistUrl(playlistUrlInput);
                  if (imported) {
                    setPlaylistUrlInput('');
                    onOpenLibrary('playlist', imported.id);
                  }
                }}
                className="font-mono-tech ryo-pressable"
                style={{
                  height: 38,
                  padding: '0 16px',
                  borderRadius: 999,
                  backgroundColor: 'var(--accent)',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: 11.5,
                  fontWeight: 700,
                  opacity: importingPlaylistUrl || !playlistUrlInput.trim() ? 0.5 : 1,
                  cursor: importingPlaylistUrl ? 'wait' : 'pointer',
                }}
              >
                {importingPlaylistUrl ? 'IMPORTANDO…' : 'IMPORTAR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SECTION 1: APPEARANCE (11 Skins + Bento Inheritance + Surfaces) ──── */}
      {section === 'appearance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionHead title="11 Skins (Ryoku Purple + 10 Official)" mark="表示" />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 10 }}>
            {skins.map((s) => {
              const p = s.modes[s.defaultMode] ?? s.modes.dark ?? s.modes.light!;
              const selected = s.id === skinId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSkinId(s.id)}
                  className="ryo-pressable"
                  style={{
                    padding: 10,
                    borderRadius: 'var(--radius-card)',
                    backgroundColor: 'var(--paper-lift)',
                    border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--line-soft)'}`,
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {/* Real preview.png */}
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '16 / 10',
                      borderRadius: 'calc(var(--radius-card) - 4px)',
                      overflow: 'hidden',
                      backgroundColor: p.paper,
                      border: '1px solid rgba(255,255,255,0.1)',
                      position: 'relative',
                    }}
                  >
                    <img
                      src={s.previewUrl}
                      alt={s.name}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                    {selected && (
                      <span
                        className="font-mono-tech"
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          padding: '2px 6px',
                          borderRadius: 999,
                          backgroundColor: 'var(--accent)',
                          color: '#FFFFFF',
                          fontSize: 8.5,
                          fontWeight: 700,
                        }}
                      >
                        ACTIVE
                      </span>
                    )}
                  </div>

                  {/* 5-color swatch strip */}
                  <div style={{ display: 'flex', gap: 3, height: 10, borderRadius: 4, overflow: 'hidden' }}>
                    {[p.paper, p.paperLift, p.ink, p.sun, p.bone].map((hex, i) => (
                      <span key={i} style={{ flex: 1, backgroundColor: hex }} />
                    ))}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{s.name}</span>
                    <span className="font-mono-tech" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
                      R{s.shape.radiusCard} · W{s.wash}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.35 }}>{s.description}</div>
                </button>
              );
            })}
          </div>

          <SectionHead title="Theme Mode & Decor Level" mark="調" />

          <div
            style={{
              padding: 12,
              borderRadius: 'var(--radius-card)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-soft)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Theme Mode</div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  Follow the skin default, or pin Light/Dark mode.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['system', 'light', 'dark'] as const).map((m) => (
                  <ChipButton
                    key={m}
                    label={m === 'system' ? 'System' : m === 'light' ? 'Light' : 'Dark'}
                    active={themeModePref === m}
                    onClick={() => setThemeModePref(m)}
                  />
                ))}
              </div>
            </div>
            {modeMissing && (
              <div style={{ fontSize: 11.5, color: 'var(--accent)' }}>
                {skin.name} has no {themeModePref} mode; showing its {mode} edition.
              </div>
            )}
          </div>

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
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Decor Level</div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                Rich adds Reg dot+cross grid, Kanji seals &amp; bloom; Calm keeps surfaces quiet.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['skin', 'rich', 'calm'] as const).map((d) => (
                <ChipButton
                  key={d}
                  label={d === 'skin' ? 'Skin Default' : d === 'rich' ? 'Rich' : 'Calm'}
                  active={decorPref === d}
                  onClick={() => setDecorPref(d)}
                />
              ))}
            </div>
          </div>

          <SectionHead title="Bento Module & Controls" mark="核" />

          {/* Bento Theme Inheritance Switch */}
          <div
            style={{
              padding: 12,
              borderRadius: 'var(--radius-card)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-soft)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
              Bento, Media Bar, OSD &amp; 38CH Visualizer Theme
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Keep Nothing OS Obsidian + Purple fixed, or inherit colors &amp; typography from the active Ryotunes Skin.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ChipButton
                label="Nothing OS Purple (Fixed)"
                active={bentoThemeMode === 'nothing'}
                onClick={() => setBentoThemeMode('nothing')}
              />
              <ChipButton
                label={`Inherit Active Skin (${skin.name})`}
                active={bentoThemeMode === 'inherit'}
                onClick={() => setBentoThemeMode('inherit')}
              />
            </div>
          </div>

          {/* Seekbar Switcher */}
          <div
            style={{
              padding: 12,
              borderRadius: 'var(--radius-card)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-soft)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Seekbar Style</div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Switch progress bar geometry across Bento, PlayerBar, and Now Playing stage.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <ChipButton
                label="InstrumentScale (42)"
                active={seekbarStyle === 'scale'}
                onClick={() => setSeekbarStyle('scale')}
              />
              <ChipButton
                label="Waveform (240 · 70/30)"
                active={seekbarStyle === 'waveform'}
                onClick={() => setSeekbarStyle('waveform')}
              />
              <ChipButton
                label="Hairline (2px)"
                active={seekbarStyle === 'hairline'}
                onClick={() => setSeekbarStyle('hairline')}
              />
            </div>
          </div>

          {/* Visualizer Switcher */}
          <div
            style={{
              padding: 12,
              borderRadius: 'var(--radius-card)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-soft)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Visualizer Engine</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <ChipButton
                label="Dot-Matrix Cava (26×5 / 38×10)"
                active={visualizerStyle === 'dot-matrix'}
                onClick={() => setVisualizerStyle('dot-matrix')}
              />
              <ChipButton
                label="SpectrumField Wave (40)"
                active={visualizerStyle === 'spectrum-wave'}
                onClick={() => setVisualizerStyle('spectrum-wave')}
              />
              <ChipButton
                label="SpectrumField Bars (40)"
                active={visualizerStyle === 'spectrum-bars'}
                onClick={() => setVisualizerStyle('spectrum-bars')}
              />
            </div>
          </div>

          {/* Accent & Cover Wash */}
          <div
            style={{
              padding: 12,
              borderRadius: 'var(--radius-card)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-soft)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Accent Rule</div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                Skin policy ({skin.accent}), or override with live 24×24 Cover Art or Provider Brand glow.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(
                [
                  { k: 'skin', l: 'Skin Policy' },
                  { k: 'artwork', l: 'Artwork 24×24' },
                  { k: 'provider', l: 'Provider Brand' },
                  { k: 'sun', l: 'Skin Sun' },
                ] as const
              ).map((a) => (
                <ChipButton
                  key={a.k}
                  label={a.l}
                  active={accentPolicy === a.k}
                  onClick={() => setAccentPolicy(a.k)}
                />
              ))}
            </div>

            <div style={{ height: 1, backgroundColor: 'var(--line-soft)' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>Cover Backdrop Wash Multiplier</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="font-mono-tech" style={{ fontSize: 12, color: 'var(--accent)' }}>
                  {effectiveWash.toFixed(2)}×
                </span>
                {washOverride !== null && (
                  <button
                    type="button"
                    onClick={() => setWashOverride(null)}
                    className="font-mono-tech"
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--line)',
                      borderRadius: 4,
                      color: 'var(--ink-muted)',
                      fontSize: 9.5,
                      padding: '2px 6px',
                      cursor: 'pointer',
                    }}
                  >
                    RESET
                  </button>
                )}
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={effectiveWash}
              onChange={(e) => setWashOverride(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
          </div>

          <ToggleRow
            title="ProviderGlow Ambient Light"
            desc="Radial ambient bloom tinted to YouTube (#FF2D2D), Spotify (#1DB954), SoundCloud (#FF5500), or TIDAL (#4FC3DC)."
            value={providerGlowEnabled}
            onToggle={setProviderGlowEnabled}
          />

          <ToggleRow
            title="Cover Backdrop Blur (64px)"
            desc="Disable to keep pure paper flat without cover art diffusion."
            value={blurEnabled}
            onToggle={setBlurEnabled}
          />

          {/* Interface Scale */}
          <div
            style={{
              padding: 12,
              borderRadius: 'var(--radius-card)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-soft)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Interface Scale</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[80, 90, 100, 110, 120, 130, 140].map((pct) => (
                <ChipButton
                  key={pct}
                  label={`${pct}%`}
                  active={uiScale === pct}
                  onClick={() => setUiScale(pct)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SECTION 2: SOUND STUDIO & PLAYBACK ENGINE ─────────────────────────── */}
      {section === 'playback' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionHead title="Sound Studio DSP" mark="音響" />

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
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Sound Studio (Tempo / Pitch / Reverb / Bass / Width)</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>
                5 presets (Flat, Slowed + Reverb, Nightcore, Bass Boost, Wide) applied live to WebAudio &amp; Android DSP.
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenSound}
              className="ryo-pressable"
              style={{
                height: 34,
                padding: '0 14px',
                borderRadius: 999,
                backgroundColor: 'var(--bone)',
                color: 'var(--ink-on-bone)',
                border: 'none',
                fontSize: 12.5,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Icon name="sound" size={14} color="var(--ink-on-bone)" />
              <span>Open</span>
            </button>
          </div>

          <SectionHead title="Audio Engine" mark="再生" />

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
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Stream Quality</div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Preferred bitrate tier when resolving tracks.</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['LOW', 'AUTO', 'HIGH'] as AudioQuality[]).map((q) => (
                <ChipButton key={q} label={q} active={audioQuality === q} onClick={() => setAudioQuality(q)} />
              ))}
            </div>
          </div>

          <ToggleRow
            title="Autoplay"
            desc="Continue playback seamlessly across the queue and similar picks."
            value={autoplay}
            onToggle={setAutoplay}
          />

          <ToggleRow
            title="Prevent duplicate tracks in queue"
            desc="Adding a track already queued moves it instead of appending a copy."
            value={preventDuplicates}
            onToggle={setPreventDuplicates}
          />
        </div>
      )}

      {/* ── SECTION 3: PROVIDERS & OFFLINE STORAGE ────────────────────────────── */}
      {section === 'storage' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionHead title="Streaming Catalogues" mark="経" />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
            {[
              { id: 'youtube', name: 'YouTube Music', desc: 'InnerTube search & IOS AAC audio', icon: 'youtube-music', color: PROVIDER_COLORS.youtube },
              { id: 'spotify', name: 'Spotify', desc: 'Catalog search + lossless match', icon: 'spotify', color: PROVIDER_COLORS.spotify },
              { id: 'soundcloud', name: 'SoundCloud', desc: 'Public tracks + 240-bar waveforms', icon: 'soundcloud', color: PROVIDER_COLORS.soundcloud },
              { id: 'tidal', name: 'TIDAL', desc: 'Hi-Res catalog search & resolve', icon: 'tidal', color: PROVIDER_COLORS.tidal },
            ].map((prov) => (
              <div
                key={prov.id}
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-card)',
                  backgroundColor: 'var(--paper-lift)',
                  border: `1px solid ${prov.color}55`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name={prov.icon} size={18} color={prov.color} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{prov.name}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{prov.desc}</div>
              </div>
            ))}
          </div>

          <SectionHead title="Offline & Local Cache" mark="保存" />

          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-card)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-soft)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>
                  Saved Offline Library ({offlineTracks.length} tracks · {totalOfflineMb} MB)
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  Tracks saved with ↓ OFFLINE store audio + artwork locally for playback without internet.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <ChipButton
                  label="Open Offline Library"
                  active={true}
                  onClick={() => onOpenLibrary('library', '', 'offline')}
                />
                <ChipButton
                  label="Clear Caches"
                  active={false}
                  onClick={() => clearOfflineAndCache()}
                />
              </div>
            </div>

            {isNativeAndroid && (
              <button
                type="button"
                onClick={() => syncDeviceLibrary(true)}
                className="ryo-pressable"
                style={{
                  alignSelf: 'flex-start',
                  height: 32,
                  padding: '0 14px',
                  borderRadius: 999,
                  backgroundColor: 'var(--paper)',
                  border: '1px solid var(--line)',
                  color: 'var(--ink)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Rescan Android MediaStore Folders
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── SECTION 4: ANDROID HOME WIDGET BLUEPRINT ──────────────────────────── */}
      {section === 'widget' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionHead title="Android Home Widget Blueprint (dev.ryoku.ryotunes)" mark="窓" />
          <DesktopWidgetCard onOpenLibrary={() => onOpenLibrary('home')} />
        </div>
      )}

      {/* ── SYSTEM // OTA UPDATES (GitHub Releases) ───────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
        <SectionHead title="SYSTEM // OTA UPDATES" mark="更" />
        <div
          style={{
            padding: 14,
            borderRadius: 'var(--radius-card)',
            backgroundColor: 'var(--paper-lift)',
            border: '1px solid var(--line-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="font-ndot" style={{ fontSize: 13, color: 'var(--ink)', letterSpacing: 1 }}>
                RYOTUNES MOBILE
              </span>
              <span
                className="font-mono-tech"
                style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  backgroundColor: 'var(--accent-soft)',
                  border: '1px solid var(--accent)',
                  color: 'var(--accent)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {appVersionLabel}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              {updateStatusText || 'Actualizaciones automáticas firmadas desde GitHub Releases.'}
            </div>
          </div>

          {onCheckUpdates && (
            <button
              type="button"
              disabled={checkingUpdate}
              onClick={onCheckUpdates}
              className="font-mono-tech ryo-pressable"
              style={{
                height: 36,
                padding: '0 16px',
                borderRadius: 999,
                backgroundColor: 'var(--bone)',
                color: 'var(--ink-on-bone)',
                border: 'none',
                fontSize: 11,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                opacity: checkingUpdate ? 0.6 : 1,
                cursor: checkingUpdate ? 'wait' : 'pointer',
                flexShrink: 0,
              }}
            >
              <Icon name="download" size={14} color="var(--ink-on-bone)" />
              <span>{checkingUpdate ? 'BUSCANDO…' : 'BUSCAR ACTUALIZACIONES'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
