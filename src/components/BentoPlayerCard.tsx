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
  onOpenSound?: () => void;
  onOpenStudio?: () => void;
  centerMode?: StageCenterMode;
  onChangeCenterMode?: (mode: StageCenterMode) => void;
}

/**
 * Flagship Nothing OS x Ryoku Purple Mobile Stage Console:
 * - Clean header with provider pill & [ ↓ OFFLINE ]
 * - 4-view stage selector: COVER | LYRICS | SPECTRUM | QUEUE
 * - Hero centered cover art + Like button + combined 60-FPS Waves & 26x5 FFT LEDs
 * - Thumb-zone transport deck: 36px scrubber + 48px Play/Pause + Shuffle/Repeat + FX/OSD/Skin strip
 */
export const BentoPlayerCard: React.FC<BentoPlayerCardProps> = ({
  onOpenLibrary,
  onOpenNowPlaying,
  onOpenSound,
  onOpenStudio,
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
    likedIds,
    toggleLike,
    togglePlay,
    next,
    prev,
    seek,
    toggleShuffle,
    cycleRepeat,
    triggerOsd,
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
  const isLiked = currentTrack ? likedIds.includes(currentTrack.id) : false;

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
    { key: 'art', label: 'COVER' },
    { key: 'lyrics', label: 'LYRICS' },
    { key: 'spectrum', label: 'SPECTRUM' },
    { key: 'queue', label: 'QUEUE' },
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
          ? `0 18px 44px ${bentoTokens.glowSoft}, 0 6px 18px rgba(0,0,0,0.6)`
          : '0 10px 28px rgba(0, 0, 0, 0.45)',
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
            opacity: Math.min(0.45, 0.24 * effectiveWash),
            filter: 'blur(26px) saturate(1.25)',
            transform: 'scale(1.12)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Ambient obsidian / active skin gradient */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            bentoThemeMode === 'nothing'
              ? 'linear-gradient(180deg, rgba(20, 13, 36, 0.76) 0%, rgba(10, 8, 18, 0.94) 100%)'
              : `linear-gradient(180deg, ${bentoTokens.bgSurface}cc 0%, ${bentoTokens.bgDeep}ef 100%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Nothing OS Dot-Matrix Background Grid */}
      {decor === 'rich' && (
        <DotMatrixGrid step={12} color={bentoTokens.accentLavender} opacity={0.14} inset={6} dotSize={1.5} />
      )}

      {/* Ryoku Instrument Corner Brackets */}
      <InstrumentBrackets color={bentoTokens.accent} length={10} weight={2} inset={7} opacity={0.82} />

      <div
        style={{
          position: 'relative',
          padding: '14px 14px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 11,
        }}
      >
        {/* 1. CLEAN MODULAR HEADER: LED + STATUS + PROVIDER + OFFLINE */}
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
              letterSpacing: '0.06em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {isPlaying ? 'PLAYING // RYOTUNES' : 'STANDBY // RYOTUNES'}
          </span>

          <div style={{ flex: 1 }} />

          {currentTrack && <ProviderBadge track={currentTrack} compact />}
          {currentTrack && <OfflineButton track={currentTrack} />}
        </div>

        {/* 2. 4-VIEW STAGE SWITCHER: COVER | LYRICS | SPECTRUM | QUEUE */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 6,
            padding: 4,
            borderRadius: 12,
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
                  height: 28,
                  padding: '0 6px',
                  borderRadius: 8,
                  border: active ? `1px solid ${bentoTokens.accent}` : '1px solid transparent',
                  backgroundColor: active ? bentoTokens.bgElevated : 'transparent',
                  color: active ? bentoTokens.ink : bentoTokens.muted,
                  fontFamily: bentoTokens.fontMono,
                  fontSize: 9.5,
                  fontWeight: active ? 700 : 500,
                  letterSpacing: '0.06em',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* 3. ACTIVE CENTER VIEWPORT */}
        {activeCenter === 'art' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Centered Hero Cover Art */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 2 }}>
              <button
                type="button"
                onClick={onOpenNowPlaying}
                title="Open Full Now Playing Overlay"
                className="ryo-pressable"
                style={{
                  width: 174,
                  height: 174,
                  borderRadius: Math.min(18, bentoTokens.radiusCard + 2),
                  backgroundColor: bentoTokens.bgSurface,
                  border: `1.5px solid ${isPlaying ? bentoTokens.accent : bentoTokens.borderDim}`,
                  boxShadow: isPlaying
                    ? `0 16px 38px ${bentoTokens.glowMedium}, 0 6px 16px rgba(0,0,0,0.55)`
                    : '0 10px 24px rgba(0,0,0,0.45)',
                  overflow: 'hidden',
                  padding: 0,
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
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <Icon name="album" size={44} color={bentoTokens.accent} />
                    <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 9.5, color: bentoTokens.muted }}>
                      NO ARTWORK
                    </span>
                  </div>
                )}
              </button>
            </div>

            {/* Metadata + Like (♥) Action */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div
                  onClick={onOpenNowPlaying}
                  style={{
                    fontFamily: bentoTokens.fontDisplay,
                    fontSize: 17.5,
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
                <div
                  style={{
                    fontFamily: bentoTokens.fontMono,
                    fontSize: 11.5,
                    lineHeight: 1.2,
                    color: bentoTokens.accentLavender,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {(currentTrack?.artist || 'UNKNOWN ARTIST').toUpperCase()}
                </div>
              </div>

              {currentTrack && (
                <button
                  type="button"
                  onClick={() => toggleLike(currentTrack.id)}
                  aria-label={isLiked ? 'Unlike track' : 'Like track'}
                  className="ryo-pressable"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: isLiked ? bentoTokens.glowSoft : bentoTokens.bgSurface,
                    border: `1px solid ${isLiked ? bentoTokens.accent : bentoTokens.borderDim}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <Icon
                    name="heart"
                    size={18}
                    color={isLiked ? bentoTokens.accentLavender : bentoTokens.muted}
                  />
                </button>
              )}

              <button
                type="button"
                onClick={onOpenLibrary}
                aria-label="Open library"
                className="ryo-pressable"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: bentoTokens.bgSurface,
                  border: `1px solid ${bentoTokens.borderDim}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <Icon name="library" size={17} color={bentoTokens.ink} />
              </button>
            </div>

            {/* Combined 60-FPS Waves + 26x5 FFT Dot-Matrix Visualizer */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 46,
                borderRadius: 10,
                backgroundColor: bentoTokens.bgSurface,
                border: `1px solid ${bentoTokens.borderDim}`,
                overflow: 'hidden',
                padding: '5px 8px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <WaveVisualizerCanvas
                live={isPlaying}
                color={bentoTokens.glowMedium}
                opacity={0.9}
                blurPx={2}
              />
              <div style={{ position: 'relative', width: '100%', zIndex: 1 }}>
                {visualizerStyle === 'dot-matrix' ? (
                  <DotMatrixSpectrum isPlaying={isPlaying} cols={26} rows={5} height={34} transparent />
                ) : (
                  <SpectrumCanvas
                    live={isPlaying}
                    height={34}
                    forceMode={visualizerStyle === 'spectrum-bars' ? 'bars' : 'wave'}
                    accentOverride={bentoTokens.accent}
                    inkOverride={bentoTokens.ink}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {activeCenter === 'lyrics' && (
          <div
            style={{
              ...scopedSkinVars,
              height: 292,
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
              height: 292,
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

        {/* 4. THUMB-ZONE SEEKBAR (36px touch target) + CLEAR TIMESTAMPS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ minHeight: 36, display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '100%' }}>
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
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
            <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 10.5, color: bentoTokens.accentLavender }}>
              {fmtTime(position)}
            </span>
            <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 10.5, color: bentoTokens.muted }}>
              {fmtTime(duration)}
            </span>
          </div>
        </div>

        {/* 5. ERGONOMIC THUMB TRANSPORT DECK (48px Primary + 42px Skip + 38px Mode) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <button
            type="button"
            onClick={toggleShuffle}
            aria-label="Toggle shuffle"
            className="ryo-pressable"
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
              backgroundColor: shuffle ? bentoTokens.glowSoft : bentoTokens.bgElevated,
              border: `1px solid ${shuffle ? bentoTokens.accent : bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon name="shuffle" size={16} color={shuffle ? bentoTokens.accentLavender : bentoTokens.muted} />
          </button>

          <button
            type="button"
            onClick={prev}
            aria-label="Previous track"
            className="ryo-pressable"
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon name="previous" size={18} color={bentoTokens.ink} />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="ryo-pressable"
            style={{
              flex: 1,
              maxWidth: 156,
              height: 48,
              padding: '0 16px',
              borderRadius: 24,
              backgroundColor: isPlaying ? bentoTokens.accent : bentoTokens.bgElevated,
              border: `1.5px solid ${bentoTokens.accent}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              cursor: 'pointer',
              color: '#FFFFFF',
              boxShadow: isPlaying ? `0 0 20px ${bentoTokens.glowMedium}` : 'none',
            }}
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={18} color={isPlaying ? '#FFFFFF' : bentoTokens.ink} />
            <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 12, fontWeight: 700, color: isPlaying ? '#FFFFFF' : bentoTokens.ink }}>
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </span>
          </button>

          <button
            type="button"
            onClick={next}
            aria-label="Next track"
            className="ryo-pressable"
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon name="next" size={18} color={bentoTokens.ink} />
          </button>

          <button
            type="button"
            onClick={cycleRepeat}
            aria-label="Cycle repeat mode"
            className="ryo-pressable"
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
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
              size={16}
              color={repeat !== 'off' ? bentoTokens.accentLavender : bentoTokens.muted}
            />
          </button>
        </div>

        {/* 6. QUICK INSTRUMENT STRIP: SOUND FX · VOL OSD · SKIN */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, paddingTop: 2 }}>
          <button
            type="button"
            onClick={onOpenSound}
            className="ryo-pressable"
            style={{
              height: 34,
              borderRadius: 10,
              backgroundColor: bentoTokens.bgSurface,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <Icon name="sound" size={13} color={bentoTokens.accentLavender} />
            <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 9, color: bentoTokens.ink }}>
              SOUND FX
            </span>
          </button>

          <button
            type="button"
            onClick={triggerOsd}
            className="ryo-pressable"
            style={{
              height: 34,
              borderRadius: 10,
              backgroundColor: bentoTokens.bgSurface,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <Icon name="volume" size={13} color={bentoTokens.accentLavender} />
            <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 9, color: bentoTokens.ink }}>
              VOL OSD
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenStudio}
            className="ryo-pressable"
            style={{
              height: 34,
              borderRadius: 10,
              backgroundColor: bentoTokens.bgSurface,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <Icon name="settings" size={13} color={bentoTokens.accentLavender} />
            <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 9, color: bentoTokens.ink }}>
              SKIN
            </span>
          </button>
        </div>
      </div>
    </section>
  );
};
