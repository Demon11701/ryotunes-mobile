import React from 'react';
import { fmtTime, useAudio } from '../audio/AudioContextProvider';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeContext';
import { DotMatrixGrid } from './DotMatrixGrid';
import { DotMatrixSpectrum } from './DotMatrixSpectrum';
import { InstrumentBrackets } from './InstrumentBrackets';
import { OfflineButton } from './OfflineButton';
import { ProviderBadge } from './ProviderBadge';
import { SeekbarControl } from './SeekbarControl';
import { SpectrumCanvas } from './SpectrumCanvas';
import { WaveVisualizerCanvas } from './WaveVisualizerCanvas';

interface BentoPlayerCardProps {
  onOpenLibrary: () => void;
  onOpenNowPlaying: () => void;
}

/**
 * 1:1 port of ~/.config/quickshell/ii/modules/ii/mediaControls/PlayerControl.qml:
 * Supports dual theming (fixed Nothing OS Obsidian Purple or inherit active Ryotunes Skin),
 * adaptive seekbar (InstrumentScale / Waveform 240 / Hairline), visualizer switcher & [ ↓ OFFLINE ].
 */
export const BentoPlayerCard: React.FC<BentoPlayerCardProps> = ({
  onOpenLibrary,
  onOpenNowPlaying,
}) => {
  const {
    currentTrack,
    isPlaying,
    position,
    duration,
    spectrumPoints,
    togglePlay,
    next,
    prev,
    seek,
  } = useAudio();
  const { bentoTokens, bentoThemeMode, visualizerStyle, decor, effectiveWash, blurEnabled } = useTheme();

  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const artSrc = currentTrack?.artwork;

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

      {/* Subtle background wave visualizer */}
      <WaveVisualizerCanvas
        points={spectrumPoints}
        live={isPlaying}
        color={bentoTokens.glowSoft}
        blurPx={4}
      />

      {/* Ryoku Instrument Corner Brackets */}
      <InstrumentBrackets color={bentoTokens.accent} length={10} weight={2} inset={6} opacity={0.85} />

      {/* Foreground Content (margins: 14px) */}
      <div
        style={{
          position: 'relative',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* 1. TOP MODULAR HEADER BAR */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
              fontSize: 10.5,
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

          {/* Interactive [ ⊙ RYOTUNES ↗ ] Modular Chip */}
          <button
            type="button"
            onClick={onOpenLibrary}
            className="ryo-pressable"
            style={{
              height: 24,
              padding: '0 10px',
              borderRadius: 12,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.accent}`,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              cursor: 'pointer',
              color: bentoTokens.ink,
              flexShrink: 0,
            }}
          >
            <Icon name="album" size={12} color={bentoTokens.accentLavender} />
            <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 9.5, color: bentoTokens.ink }}>
              RYOTUNES ↗
            </span>
          </button>
        </div>

        {/* 2. MIDDLE BENTO ROW: ARTWORK + METADATA + SPECTRUM */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 12 }}>
          <button
            type="button"
            onClick={onOpenNowPlaying}
            title="Open Full Now Playing Stage & Lyrics"
            className="ryo-pressable"
            style={{
              width: 86,
              height: 86,
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
                style={{
                  fontFamily: bentoTokens.fontDisplay,
                  fontSize: 15,
                  lineHeight: 1.2,
                  color: bentoTokens.ink,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
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

        {/* 3. INTERACTIVE SEEKBAR (HONORS HAIRLINE / WAVEFORM 240 / INSTRUMENT SCALE) */}
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

        {/* 4. BOTTOM MODULAR TRANSPORT & TIME READOUT BAR */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              height: 30,
              padding: '0 10px',
              borderRadius: 7,
              backgroundColor: bentoTokens.bgSurface,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
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
            <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 11, color: bentoTokens.ink }}>
              {fmtTime(position)} / {fmtTime(duration)}
            </span>
          </div>

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={prev}
            aria-label="Previous track"
            className="ryo-pressable"
            style={{
              width: 34,
              height: 32,
              borderRadius: 8,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name="previous" size={16} color={bentoTokens.ink} />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="ryo-pressable"
            style={{
              minWidth: 96,
              height: 32,
              padding: '0 14px',
              borderRadius: 16,
              backgroundColor: isPlaying ? bentoTokens.accent : bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.accent}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              cursor: 'pointer',
              color: '#FFFFFF',
              boxShadow: isPlaying ? `0 0 16px ${bentoTokens.glowMedium}` : 'none',
            }}
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={15} color={isPlaying ? '#FFFFFF' : bentoTokens.ink} />
            <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 11, color: isPlaying ? '#FFFFFF' : bentoTokens.ink }}>
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </span>
          </button>

          <button
            type="button"
            onClick={next}
            aria-label="Next track"
            className="ryo-pressable"
            style={{
              width: 34,
              height: 32,
              borderRadius: 8,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name="next" size={16} color={bentoTokens.ink} />
          </button>
        </div>
      </div>
    </section>
  );
};
