import React from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeContext';
import { DotMatrixSpectrum } from './DotMatrixSpectrum';

interface FloatingMiniPlayerProps {
  onOpenStage: () => void;
}

/**
 * Floating Bento capsule shown over EXPLORE / LIBRARY / STUDIO tabs:
 * Circular SVG progress around cover art, TITLE // ARTIST, miniature 14x3 live FFT LEDs,
 * and instant Play/Pause + Next controls. Tapping the capsule returns to 01 · STAGE.
 */
export const FloatingMiniPlayer: React.FC<FloatingMiniPlayerProps> = ({ onOpenStage }) => {
  const { currentTrack, isPlaying, position, duration, spectrumPoints, togglePlay, next } = useAudio();
  const { bentoTokens } = useTheme();

  if (!currentTrack) return null;

  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const ringSize = 44;
  const strokeW = 2.5;
  const r = (ringSize - strokeW) / 2;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - progress);

  return (
    <div style={{ padding: '0 10px 8px', flexShrink: 0, zIndex: 25 }}>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenStage}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenStage();
          }
        }}
        className="ryo-pressable"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '7px 10px',
          borderRadius: 16,
          backgroundColor: bentoTokens.bgSurface,
          border: `1px solid ${isPlaying ? bentoTokens.accent : bentoTokens.borderDim}`,
          boxShadow: isPlaying
            ? `0 8px 24px ${bentoTokens.glowSoft}, 0 4px 12px rgba(0,0,0,0.45)`
            : '0 6px 16px rgba(0, 0, 0, 0.35)',
          backdropFilter: 'blur(14px)',
          cursor: 'pointer',
        }}
      >
        {/* Artwork inside circular SVG progress ring */}
        <div
          style={{
            position: 'relative',
            width: ringSize,
            height: ringSize,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width={ringSize}
            height={ringSize}
            viewBox={`0 0 ${ringSize} ${ringSize}`}
            style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}
          >
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={r}
              fill="none"
              stroke={bentoTokens.borderDim}
              strokeWidth={strokeW}
            />
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={r}
              fill="none"
              stroke={bentoTokens.accent}
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 180ms linear' }}
            />
          </svg>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              overflow: 'hidden',
              backgroundColor: bentoTokens.bgDeep,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {currentTrack.artwork ? (
              <img
                src={currentTrack.artwork}
                alt={currentTrack.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <Icon name="album" size={16} color={bentoTokens.accent} />
            )}
          </div>
        </div>

        {/* Title // Artist + mini live FFT LEDs */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div
            style={{
              fontFamily: bentoTokens.fontMono,
              fontSize: 10.5,
              color: bentoTokens.ink,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentTrack.title.toUpperCase()} <span style={{ color: bentoTokens.accentLavender }}>//</span>{' '}
            <span style={{ color: bentoTokens.muted }}>{currentTrack.artist.toUpperCase()}</span>
          </div>
          <div style={{ width: 96 }}>
            <DotMatrixSpectrum
              points={spectrumPoints}
              isPlaying={isPlaying}
              cols={14}
              rows={3}
              height={11}
              transparent
            />
          </div>
        </div>

        {/* Instant Play/Pause + Next */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="ryo-pressable"
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: isPlaying ? bentoTokens.accent : bentoTokens.bgElevated,
            border: `1px solid ${bentoTokens.accent}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Icon name={isPlaying ? 'pause' : 'play'} size={15} color={isPlaying ? '#FFFFFF' : bentoTokens.ink} />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          aria-label="Next track"
          className="ryo-pressable"
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
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
      </div>
    </div>
  );
};
