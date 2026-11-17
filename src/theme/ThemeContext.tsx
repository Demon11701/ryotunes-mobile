import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  AccentPolicyOverride,
  BentoThemeMode,
  DecorPref,
  SeekbarStyle,
  ThemeModePref,
  VisualizerStyle,
} from '../audio/types';
import { getSkinById, PaletteMode, PROVIDER_COLORS, RyotunesSkin, SKINS } from './skins';

export interface BentoTokens {
  bgDeep: string;
  bgSurface: string;
  bgElevated: string;
  bgOsdBox: string;
  borderDim: string;
  accent: string;
  accentLavender: string;
  ink: string;
  muted: string;
  scaleInk: string;
  ledIdle: string;
  error: string;
  fontDisplay: string;
  fontMono: string;
  radiusCard: number;
  glowSoft: string;
  glowMedium: string;
  gradientBg: string;
  vizDotBody: string;
  vizDotUnlit: string;
}

interface ThemeContextValue {
  skinId: string;
  setSkinId: (id: string) => void;
  skin: RyotunesSkin;
  skins: RyotunesSkin[];
  themeModePref: ThemeModePref;
  setThemeModePref: (m: ThemeModePref) => void;
  mode: 'dark' | 'light';
  setMode: (mode: ThemeModePref) => void;
  modeMissing: boolean;
  decorPref: DecorPref;
  setDecorPref: (d: DecorPref) => void;
  decor: 'rich' | 'calm';
  setDecor: (d: DecorPref) => void;
  accentPolicy: AccentPolicyOverride;
  setAccentPolicy: (a: AccentPolicyOverride) => void;
  washOverride: number | null;
  setWashOverride: (w: number | null) => void;
  effectiveWash: number;
  uiScale: number;
  setUiScale: (scale: number) => void;
  bentoThemeMode: BentoThemeMode;
  setBentoThemeMode: (m: BentoThemeMode) => void;
  bentoTokens: BentoTokens;
  seekbarStyle: SeekbarStyle;
  setSeekbarStyle: (s: SeekbarStyle) => void;
  visualizerStyle: VisualizerStyle;
  setVisualizerStyle: (v: VisualizerStyle) => void;
  providerGlowEnabled: boolean;
  setProviderGlowEnabled: (v: boolean) => void;
  blurEnabled: boolean;
  setBlurEnabled: (v: boolean) => void;
  activeProvider: string;
  setActiveProvider: (p: string) => void;
  providerColor: string;
  colors: PaletteMode;
  paperDark: boolean;
  accent: string;
  setArtAccent: (color: string | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 3 && clean.length !== 6) return [168, 85, 247];
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return [168, 85, 247];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgba(color: string, a: number): string {
  if (color.startsWith('#')) {
    const [r, g, b] = hexToRgb(color);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  const hslMatch = color.match(/^hsl\(([^)]+)\)$/i);
  if (hslMatch) {
    return `hsla(${hslMatch[1]}, ${a})`;
  }
  return color;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [skinId, setSkinId] = useState<string>(() => localStorage.getItem('ryotunes_skin') || 'ryoku-purple');
  const [themeModePref, setThemeModePref] = useState<ThemeModePref>(() => {
    const saved = localStorage.getItem('ryotunes_mode') as ThemeModePref | null;
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  });
  const [decorPref, setDecorPref] = useState<DecorPref>(() => {
    const saved = localStorage.getItem('ryotunes_decor') as DecorPref | null;
    return saved === 'rich' || saved === 'calm' || saved === 'skin' ? saved : 'skin';
  });
  const [accentPolicy, setAccentPolicy] = useState<AccentPolicyOverride>(() => {
    const saved = localStorage.getItem('ryotunes_accent_policy') as AccentPolicyOverride | null;
    return saved === 'artwork' || saved === 'provider' || saved === 'sun' ? saved : 'skin';
  });
  const [washOverride, setWashOverride] = useState<number | null>(() => {
    const raw = localStorage.getItem('ryotunes_wash_override');
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(2, n)) : null;
  });
  const [uiScale, setUiScale] = useState<number>(() => {
    const n = Number(localStorage.getItem('ryotunes_ui_scale'));
    return [80, 90, 100, 110, 120, 130, 140].includes(n) ? n : 100;
  });
  const [bentoThemeMode, setBentoThemeMode] = useState<BentoThemeMode>(() =>
    localStorage.getItem('ryotunes_bento_theme') === 'inherit' ? 'inherit' : 'nothing'
  );
  const [seekbarStyle, setSeekbarStyle] = useState<SeekbarStyle>(() => {
    const s = localStorage.getItem('ryotunes_seekbar_style');
    return s === 'hairline' || s === 'waveform' || s === 'scale' ? s : 'scale';
  });
  const [visualizerStyle, setVisualizerStyle] = useState<VisualizerStyle>(() => {
    const v = localStorage.getItem('ryotunes_viz_style');
    return v === 'dot-matrix' || v === 'spectrum-wave' || v === 'spectrum-bars' ? v : 'dot-matrix';
  });
  const [providerGlowEnabled, setProviderGlowEnabled] = useState<boolean>(
    () => localStorage.getItem('ryotunes_provider_glow') !== 'false'
  );
  const [blurEnabled, setBlurEnabled] = useState<boolean>(
    () => localStorage.getItem('ryotunes_blur_enabled') !== 'false'
  );
  const [activeProvider, setActiveProvider] = useState<string>('local');
  const [artAccent, setArtAccent] = useState<string | null>(null);

  const skin = useMemo(() => getSkinById(skinId), [skinId]);
  const desiredMode: 'dark' | 'light' =
    themeModePref === 'system' ? skin.defaultMode : themeModePref;
  const modeMissing = themeModePref !== 'system' && !skin.modes[themeModePref];
  const mode: 'dark' | 'light' = skin.modes[desiredMode] ? desiredMode : skin.defaultMode;
  const colors = useMemo<PaletteMode>(
    () => skin.modes[mode] ?? skin.modes.dark ?? skin.modes.light!,
    [skin, mode]
  );

  const decor: 'rich' | 'calm' = decorPref === 'skin' ? skin.decor : decorPref;
  const effectiveWash = washOverride !== null ? washOverride : skin.wash;

  const paperDark = useMemo(() => {
    const [r, g, b] = hexToRgb(colors.paper);
    return (r + g + b) / (3 * 255) < 0.5;
  }, [colors.paper]);

  const providerColor = useMemo(
    () => PROVIDER_COLORS[activeProvider] || PROVIDER_COLORS.youtube,
    [activeProvider]
  );

  const accent = useMemo(() => {
    const resolvedPolicy = accentPolicy === 'skin' ? skin.accent : accentPolicy;
    if (resolvedPolicy === 'provider') return providerColor;
    if (resolvedPolicy === 'sun') return colors.sun;
    if (resolvedPolicy === 'artwork') return artAccent || providerColor || colors.sun;
    if (resolvedPolicy.startsWith('#')) return resolvedPolicy;
    return colors.sun;
  }, [accentPolicy, skin.accent, colors.sun, artAccent, providerColor]);

  const bentoTokens = useMemo<BentoTokens>(() => {
    if (bentoThemeMode === 'nothing') {
      return {
        bgDeep: '#0B0910',
        bgSurface: '#14101F',
        bgElevated: '#1F1830',
        bgOsdBox: '#161124',
        borderDim: '#382C52',
        accent: '#A855F7',
        accentLavender: '#C084FC',
        ink: '#F3EEFF',
        muted: '#9D91B8',
        scaleInk: '#847A9E',
        ledIdle: '#4A3E66',
        error: '#FF5263',
        fontDisplay: "'Ndot 57', 'Space Mono', monospace",
        fontMono: "'Ndot 57', 'Space Mono', monospace",
        radiusCard: 18,
        glowSoft: 'rgba(168, 85, 247, 0.22)',
        glowMedium: 'rgba(168, 85, 247, 0.42)',
        gradientBg: 'radial-gradient(circle at 50% 18%, rgba(168, 85, 247, 0.14) 0%, rgba(11, 9, 16, 1) 64%)',
        vizDotBody: '#F3EEFF',
        vizDotUnlit: '#222228',
      };
    }

    return {
      bgDeep: colors.paper,
      bgSurface: colors.paperLift,
      bgElevated: colors.paperLift,
      bgOsdBox: colors.paperLift,
      borderDim: rgba(colors.ink, 0.26),
      accent,
      accentLavender: colors.sun,
      ink: colors.ink,
      muted: colors.inkDim,
      scaleInk: rgba(colors.inkDim, 0.72),
      ledIdle: rgba(colors.inkDim, 0.35),
      error: colors.alert,
      fontDisplay: skin.type.display,
      fontMono: skin.type.mono,
      radiusCard: Math.max(2, skin.shape.radiusCard),
      glowSoft: rgba(accent, 0.24),
      glowMedium: rgba(accent, 0.42),
      gradientBg: `radial-gradient(circle at 50% 18%, ${rgba(accent, 0.16)} 0%, ${colors.paper} 66%)`,
      vizDotBody: colors.ink,
      vizDotUnlit: rgba(colors.inkDim, 0.22),
    };
  }, [bentoThemeMode, colors, accent, skin]);

  useEffect(() => {
    localStorage.setItem('ryotunes_skin', skinId);
  }, [skinId]);
  useEffect(() => {
    localStorage.setItem('ryotunes_mode', themeModePref);
  }, [themeModePref]);
  useEffect(() => {
    localStorage.setItem('ryotunes_decor', decorPref);
  }, [decorPref]);
  useEffect(() => {
    localStorage.setItem('ryotunes_accent_policy', accentPolicy);
  }, [accentPolicy]);
  useEffect(() => {
    if (washOverride === null) localStorage.removeItem('ryotunes_wash_override');
    else localStorage.setItem('ryotunes_wash_override', String(washOverride));
  }, [washOverride]);
  useEffect(() => {
    localStorage.setItem('ryotunes_ui_scale', String(uiScale));
  }, [uiScale]);
  useEffect(() => {
    localStorage.setItem('ryotunes_bento_theme', bentoThemeMode);
  }, [bentoThemeMode]);
  useEffect(() => {
    localStorage.setItem('ryotunes_seekbar_style', seekbarStyle);
  }, [seekbarStyle]);
  useEffect(() => {
    localStorage.setItem('ryotunes_viz_style', visualizerStyle);
  }, [visualizerStyle]);
  useEffect(() => {
    localStorage.setItem('ryotunes_provider_glow', String(providerGlowEnabled));
  }, [providerGlowEnabled]);
  useEffect(() => {
    localStorage.setItem('ryotunes_blur_enabled', String(blurEnabled));
  }, [blurEnabled]);

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--paper', colors.paper);
    root.setProperty('--paper-lift', colors.paperLift);
    root.setProperty('--ink', colors.ink);
    root.setProperty('--ink-dim', colors.inkDim);
    root.setProperty('--ink-muted', rgba(colors.inkDim, 0.88));
    root.setProperty('--ink-faint', rgba(colors.inkDim, 0.68));
    root.setProperty('--bone', colors.bone);
    root.setProperty('--ink-on-bone', colors.inkOnBone);
    root.setProperty('--sun', colors.sun);
    root.setProperty('--alert', colors.alert);
    root.setProperty('--accent', accent);
    root.setProperty('--accent-soft', rgba(accent, 0.16));
    root.setProperty('--line', rgba(colors.ink, 0.26));
    root.setProperty('--line-soft', rgba(colors.ink, 0.13));
    root.setProperty('--line-strong', rgba(colors.ink, 0.42));
    root.setProperty('--tint-5', rgba(colors.ink, 0.05));
    root.setProperty('--tint-10', rgba(colors.ink, 0.1));
    root.setProperty('--tint-16', rgba(colors.ink, 0.16));
    root.setProperty('--font-display', skin.type.display);
    root.setProperty('--font-ui', skin.type.ui);
    root.setProperty('--font-mono', skin.type.mono);
    root.setProperty('--radius', `${skin.shape.radius}px`);
    root.setProperty('--radius-card', `${skin.shape.radiusCard}px`);
    root.setProperty('--dur-snap', `${skin.motion.snap}ms`);
    root.setProperty('--dur-move', `${skin.motion.move}ms`);
    root.setProperty('--dur-swap', `${skin.motion.swap}ms`);
    root.setProperty('--dur-slow', `${skin.motion.slow}ms`);
    root.setProperty('--wash', String(effectiveWash));
    root.setProperty('--provider-color', providerColor);
    root.setProperty('--ui-scale', String(uiScale / 100));
    root.setProperty('--bento-bg-deep', bentoTokens.bgDeep);
    root.setProperty('--bento-bg-surface', bentoTokens.bgSurface);
    root.setProperty('--bento-bg-elevated', bentoTokens.bgElevated);
    root.setProperty('--bento-bg-osd-box', bentoTokens.bgOsdBox);
    root.setProperty('--bento-border-dim', bentoTokens.borderDim);
    root.setProperty('--bento-accent-purple', bentoTokens.accent);
    root.setProperty('--bento-accent-lavender', bentoTokens.accentLavender);
    root.setProperty('--bento-ink', bentoTokens.ink);
    root.setProperty('--bento-muted', bentoTokens.muted);
    root.setProperty('--bento-scale-ink', bentoTokens.scaleInk);
    root.setProperty('--bento-error', bentoTokens.error);
    root.setProperty('--bento-led-idle', bentoTokens.ledIdle);
    // Apply global scale smoothly via zoom on root app container or CSS zoom
    (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom =
      uiScale === 100 ? '' : String(uiScale / 100);
  }, [colors, accent, skin, effectiveWash, providerColor, uiScale, bentoTokens]);

  return (
    <ThemeContext.Provider
      value={{
        skinId,
        setSkinId,
        skin,
        skins: SKINS,
        themeModePref,
        setThemeModePref,
        mode,
        setMode: setThemeModePref,
        modeMissing,
        decorPref,
        setDecorPref,
        decor,
        setDecor: setDecorPref,
        accentPolicy,
        setAccentPolicy,
        washOverride,
        setWashOverride,
        effectiveWash,
        uiScale,
        setUiScale,
        bentoThemeMode,
        setBentoThemeMode,
        bentoTokens,
        seekbarStyle,
        setSeekbarStyle,
        visualizerStyle,
        setVisualizerStyle,
        providerGlowEnabled,
        setProviderGlowEnabled,
        blurEnabled,
        setBlurEnabled,
        activeProvider,
        setActiveProvider,
        providerColor,
        colors,
        paperDark,
        accent,
        setArtAccent,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
