import React from 'react';
import { SeekbarStyle } from '../audio/types';
import { useTheme } from '../theme/ThemeContext';
import { InstrumentScale } from './InstrumentScale';
import { WaveformCanvas } from './WaveformCanvas';

interface SeekbarControlProps {
  trackId: string;
  samples?: number[];
  fraction: number;
  duration: number;
  accentColor?: string;
  inkColor?: string;
  forceStyle?: SeekbarStyle;
  compact?: boolean;
  onSeekFraction?: (f: number) => void;
}

/**
 * Adaptive seekbar supporting all 3 Ryotunes styles:
 * - Hairline (2px)
 * - Waveform (240 bars + 70/30 mirrored reflection)
 * - InstrumentScale (42 graduated ticks)
 */
export const SeekbarControl: React.FC<SeekbarControlProps> = ({
  trackId,
  samples,
  fraction,
  duration,
  accentColor,
  inkColor,
  forceStyle,
  compact = false,
  onSeekFraction,
}) => {
  const { seekbarStyle, accent } = useTheme();
  const mode = forceStyle || seekbarStyle;
  const activeColor = accentColor || accent;
  const pct = Math.max(0, Math.min(100, fraction * 100));

  if (mode === 'waveform') {
    return (
      <WaveformCanvas
        trackId={trackId}
        samples={samples}
        fraction={fraction}
        duration={duration}
        height={compact ? 24 : 38}
        playedColor={activeColor}
        restColor={inkColor}
        interactive={duration > 0 && Boolean(onSeekFraction)}
        onSeekFraction={onSeekFraction}
      />
    );
  }

  if (mode === 'hairline') {
    return (
      <div
        role="slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        style={{
          position: 'relative',
          width: '100%',
          height: compact ? 14 : 20,
          display: 'flex',
          alignItems: 'center',
          cursor: duration > 0 && onSeekFraction ? 'pointer' : 'default',
          touchAction: 'none',
        }}
        onPointerDown={(e) => {
          if (!onSeekFraction || duration <= 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
          onSeekFraction(f);
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 1 || !onSeekFraction || duration <= 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
          onSeekFraction(f);
        }}
      >
        <div
          style={{
            width: '100%',
            height: 2,
            borderRadius: 999,
            backgroundColor: inkColor ? `${inkColor}44` : 'var(--line-strong)',
            position: 'relative',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 999,
              backgroundColor: activeColor,
              transition: 'width 120ms linear',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: `${pct}%`,
              width: compact ? 8 : 10,
              height: compact ? 8 : 10,
              borderRadius: '50%',
              backgroundColor: activeColor,
              transform: 'translate(-50%, -50%)',
              boxShadow: `0 0 8px ${activeColor}`,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <InstrumentScale
      divisions={42}
      majorEvery={6}
      fraction={fraction}
      ink={inkColor || '#847A9E'}
      accent={activeColor}
      height={compact ? 12 : 15}
      interactive={duration > 0 && Boolean(onSeekFraction)}
      onSeekFraction={onSeekFraction}
    />
  );
};
