import React, { useState } from 'react';
import { fmtTime, useAudio } from '../audio/AudioContextProvider';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeContext';
import { DotMatrixGrid } from './DotMatrixGrid';
import { DotMatrixSpectrum } from './DotMatrixSpectrum';
import { FullVisualizerCard } from './FullVisualizerCard';
import { InstrumentBrackets } from './InstrumentBrackets';
import { LyricsView } from './LyricsView';
import { OfflineButton } from './OfflineButton';
import { ProviderBadge } from './ProviderBadge';
import { QueueSheet } from './QueueSheet';
import { SeekbarControl } from './SeekbarControl';
import { SpectrumCanvas } from './SpectrumCanvas';
import { WaveVisualizerCanvas } from './WaveVisualizerCanvas';

export type StageCenterMode = 'art' | 'lyrics' | 'spectrum' | 'queue';

interface BentoPlayerCardProps {
  onOpenLibrary: () => void;
  onOpenNowPlaying: () => void;
  centerMode?: StageCenterMode;
  onChangeCenterMode?: (mode: StageCenterMode) => void;
}

/**
 * Ergonomic Bento Stage Console:
 * - Supports interactive center switcher: Caratula + 26x5 | Letras Karaoke | Espectro 38CH | Cola
 * - Always-accessible Seekbar (42-div scale / Waveform 240 / Hairline 2px) + Shuffle/Prev/Play/Next/Repeat
 * - Honors dual theming (Fixed Nothing OS Obsidian Purple or Inherit Active Ryotunes Skin)
 */
export const BentoPlayerCard: React.FC<BentoPlayerCardProps> = ({
  onOpenLibrary,
  onOpenNowPlaying,
  centerMode: controlledMode,
  onChangeCenterMode,
}) => {
  const {
    currentTrack,
    isPlaying,
    position,
    duration,
    shuffle,
    repeat,
    spectrumPoints,
    togglePlay,
    next,
    prev,
    seek,
    toggleShuffle,
    cycleRepeat,
  } = useAudio();
  const { bentoTokens, bentoThemeMode, visualizerStyle, decor, effectiveWash, blurEnabled } = useTheme();
  const [internalMode, setInternalMode] = useState<StageCenterMode>('art');

  const activeCenter = controlledMode ?? internalMode;
  const setCenter = (m: StageCenterMode) => {
    setInternalMode(m);
    onChangeCenterMode?.(m);
  };

  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const artSrc = currentTrack?.artwork;

  const scopedSkinVars: React.CSSProperties = {
    '--paper': bentoTokens.bgDeep,
    '--paper-lift': bentoTokens.bgSurface,
    '--ink': bentoTokens.ink,
    '--ink-dim': bentoTokens.accentLavender,
    '--ink-muted': bentoTokens.muted,
    '--ink-faint': bentoTokens.ledIdle,
    '--line': bentoTokens.borderDim,
    '--line-soft': bentoTokens.borderDim,
    '--line-strong': bentoTokens.accent,
    '--accent': bentoTokens.accent,
    '--tint-5': bentoTokens.glowSoft,
  } as React.CSSProperties;

  const modes: { key: StageCenterMode; label: string }[] = [
    { key: 'art', label: 'CARÁTULA + 26×5' },
    { key: 'lyrics', label: 'LETRAS KARAOKE' },
    { key: 'spectrum', label: 'ESPECTRO 38CH' },
    { key: 'queue', label: 'COLA' },
  ];

  return (
    <section
      style={{
        position: 'relative',
        width: '100%',
        borderRadius: bentoTokens.radiusCard,
        backgroundColor: bentoTokens.bgDeep,
        border: `1px solid ${isPlaying ? bentoTokens.accent : bentoTokens.borderDim}`,
        boxShadow: isPlaying
          ? `0 14px 36px ${bentoTokens.glowSoft}, 0 4px 12px rgba(0,0,0,0.55)`
          : '0 8px 24px rgba(0, 0, 0, 0.45)',
        overflow: 'hidden',
        transition: 'border-color 180ms ease, box-shadow 220ms ease, background-color 220ms ease',
      }}
    >
      {/* Blurred cover art tinted by wash */}
      {artSrc && blurEnabled && effectiveWash > 0 && (
        <img
          src={artSrc}
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: Math.min(0.45, 0.22 * effectiveWash),
            filter: 'blur(20px) saturate(1.2)',
            transform: 'scale(1.1)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Ambient gradient overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            bentoThemeMode === 'nothing'
              ? 'linear-gradient(180deg, rgba(20, 13, 36, 0.78) 0%, rgba(10, 8, 18, 0.92) 100%)'
              : `linear-gradient(180deg, ${bentoTokens.bgSurface}cc 0%, ${bentoTokens.bgDeep}ec 100%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Nothing OS Dot-Matrix Background Grid */}
      {decor === 'rich' && (
        <DotMatrixGrid step={12} color={bentoTokens.accentLavender} opacity={0.16} inset={6} dotSize={1.5} />
      )}

      {/* Real-time 3-layer FFT wave background */}
      <WaveVisualizerCanvas
        points={spectrumPoints}
        live={isPlaying}
        color={bentoTokens.glowSoft}
        blurPx={4}
      />

      {/* Ryoku Instrument Corner Brackets */}
      <InstrumentBrackets color={bentoTokens.accent} length={10} weight={2} inset={6} opacity={0.85} />

      <div
        style={{
          position: 'relative',
          padding: 13,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* 1. TOP MODULAR HEADER BAR */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            className={isPlaying ? 'led-pulsing' : ''}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: isPlaying ? bentoTokens.accent : bentoTokens.ledIdle,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: bentoTokens.fontMono,
              fontSize: 10,
              color: isPlaying ? bentoTokens.accentLavender : bentoTokens.muted,
              letterSpacing: '0.05em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {isPlaying ? 'PLAYING // RYOTUNES' : 'STANDBY // RYOTUNES'}
          </span>

          <div style={{ flex: 1 }} />

          {currentTrack && <OfflineButton track={currentTrack} />}

          <button
            type="button"
            onClick={onOpenLibrary}
            className="ryo-pressable"
            style={{
              height: 24,
              padding: '0 9px',
              borderRadius: 12,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.accent}`,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              color: bentoTokens.ink,
              flexShrink: 0,
            }}
          >
            <Icon name="album" size={11} color={bentoTokens.accentLavender} />
            <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 9, color: bentoTokens.ink }}>
              RYOTUNES ↗
            </span>
          </button>
        </div>

        {/* 2. LIVE STAGE CENTER MODE SWITCHER */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.35fr 1.2fr 1.1fr 0.72fr',
            gap: 4,
            padding: 3,
            borderRadius: 10,
            backgroundColor: bentoTokens.bgSurface,
            border: `1px solid ${bentoTokens.borderDim}`,
          }}
        >
          {modes.map((m) => {
            const active = activeCenter === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setCenter(m.key)}
                className="ryo-pressable"
                style={{
                  height: 24,
                  padding: '0 4px',
                  borderRadius: 7,
                  border: active ? `1px solid ${bentoTokens.accent}` : '1px solid transparent',
                  backgroundColor: active ? bentoTokens.bgElevated : 'transparent',
                  color: active ? bentoTokens.ink : bentoTokens.muted,
                  fontFamily: bentoTokens.fontMono,
                  fontSize: 8,
                  letterSpacing: '0.03em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  cursor: 'pointer',
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* 3. ACTIVE CENTER PANE */}
        {activeCenter === 'art' && (
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, minHeight: 88 }}>
            <button
              type="button"
              onClick={onOpenNowPlaying}
              title="Open Full Stage Overlay"
              className="ryo-pressable"
              style={{
                width: 88,
                height: 88,
                borderRadius: Math.min(12, bentoTokens.radiusCard),
                backgroundColor: bentoTokens.bgSurface,
                border: `1px solid ${isPlaying ? bentoTokens.accent : bentoTokens.borderDim}`,
                overflow: 'hidden',
                padding: 0,
                flexShrink: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              {artSrc ? (
                <img
                  src={artSrc}
                  alt={currentTrack?.title || 'Album cover'}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                  <Icon name="album" size={30} color={bentoTokens.accent} />
                  <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 8, color: bentoTokens.muted }}>
                    NO ART
                  </span>
                </div>
              )}
            </button>

            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div
                  onClick={onOpenNowPlaying}
                  style={{
                    fontFamily: bentoTokens.fontDisplay,
                    fontSize: 15,
                    lineHeight: 1.2,
                    color: bentoTokens.ink,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  {(currentTrack?.title || 'UNTITLED TRACK').toUpperCase()}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      fontFamily: bentoTokens.fontMono,
                      fontSize: 10.5,
                      lineHeight: 1.2,
                      color: bentoTokens.accentLavender,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                  >
                    {(currentTrack?.artist || 'UNKNOWN ARTIST').toUpperCase()}
                  </span>
                  {currentTrack && <ProviderBadge track={currentTrack} compact />}
                </div>
              </div>

              {visualizerStyle === 'dot-matrix' ? (
                <DotMatrixSpectrum points={spectrumPoints} isPlaying={isPlaying} cols={26} rows={5} />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: 30,
                    borderRadius: 6,
                    backgroundColor: bentoTokens.bgSurface,
                    border: `1px solid ${bentoTokens.borderDim}`,
                    padding: '2px 4px',
                  }}
                >
                  <SpectrumCanvas
                    points={spectrumPoints}
                    live={isPlaying}
                    height={24}
                    forceMode={visualizerStyle === 'spectrum-bars' ? 'bars' : 'wave'}
                    accentOverride={bentoTokens.accent}
                    inkOverride={bentoTokens.ink}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {activeCenter === 'lyrics' && (
          <div
            style={{
              ...scopedSkinVars,
              height: 204,
              borderRadius: 12,
              backgroundColor: bentoTokens.bgSurface,
              border: `1px solid ${bentoTokens.borderDim}`,
              overflow: 'hidden',
            }}
          >
            <LyricsView />
          </div>
        )}

        {activeCenter === 'spectrum' && <FullVisualizerCard embedded />}

        {activeCenter === 'queue' && (
          <div
            style={{
              ...scopedSkinVars,
              height: 204,
              borderRadius: 12,
              backgroundColor: bentoTokens.bgSurface,
              border: `1px solid ${bentoTokens.borderDim}`,
              padding: 10,
              overflow: 'hidden',
            }}
          >
            <QueueSheet />
          </div>
        )}

        {/* 4. INTERACTIVE SEEKBAR (42-div Scale / 240-bar Waveform / 2px Hairline) */}
        <SeekbarControl
          trackId={currentTrack?.id || 'ryotunes'}
          samples={currentTrack?.waveform}
          fraction={progress}
          duration={duration}
          accentColor={bentoTokens.accent}
          inkColor={bentoTokens.scaleInk}
          compact
          onSeekFraction={(f) => seek(f * duration)}
        />

        {/* 5. BOTTOM TRANSPORT BAR (TIME + SHUFFLE + PREV + PLAY/PAUSE + NEXT + REPEAT) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div
            style={{
              height: 30,
              padding: '0 7px',
              borderRadius: 7,
              backgroundColor: bentoTokens.bgSurface,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: 2.5,
                backgroundColor: bentoTokens.accentLavender,
                flexShrink: 0,
              }}
            />
            <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 10, color: bentoTokens.ink }}>
              {fmtTime(position)} / {fmtTime(duration)}
            </span>
          </div>

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={toggleShuffle}
            aria-label="Toggle shuffle"
            className="ryo-pressable"
            style={{
              width: 28,
              height: 30,
              borderRadius: 8,
              backgroundColor: shuffle ? bentoTokens.glowSoft : bentoTokens.bgElevated,
              border: `1px solid ${shuffle ? bentoTokens.accent : bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon name="shuffle" size={13} color={shuffle ? bentoTokens.accentLavender : bentoTokens.muted} />
          </button>

          <button
            type="button"
            onClick={prev}
            aria-label="Previous track"
            className="ryo-pressable"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon name="previous" size={14} color={bentoTokens.ink} />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="ryo-pressable"
            style={{
              minWidth: 78,
              height: 32,
              padding: '0 10px',
              borderRadius: 16,
              backgroundColor: isPlaying ? bentoTokens.accent : bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.accent}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              cursor: 'pointer',
              color: '#FFFFFF',
              boxShadow: isPlaying ? `0 0 14px ${bentoTokens.glowMedium}` : 'none',
              flexShrink: 0,
            }}
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={14} color={isPlaying ? '#FFFFFF' : bentoTokens.ink} />
            <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 10, color: isPlaying ? '#FFFFFF' : bentoTokens.ink }}>
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </span>
          </button>

          <button
            type="button"
            onClick={next}
            aria-label="Next track"
            className="ryo-pressable"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon name="next" size={14} color={bentoTokens.ink} />
          </button>

          <button
            type="button"
            onClick={cycleRepeat}
            aria-label="Cycle repeat mode"
            className="ryo-pressable"
            style={{
              width: 28,
              height: 30,
              borderRadius: 8,
              backgroundColor: repeat !== 'off' ? bentoTokens.glowSoft : bentoTokens.bgElevated,
              border: `1px solid ${repeat !== 'off' ? bentoTokens.accent : bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon
              name={repeat === 'one' ? 'repeat-one' : 'repeat'}
              size={13}
              color={repeat !== 'off' ? bentoTokens.accentLavender : bentoTokens.muted}
            />
          </button>
        </div>
      </div>
    </section>
  );
};
