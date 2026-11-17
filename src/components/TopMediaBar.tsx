import React, { useEffect, useState } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeContext';

interface TopMediaBarProps {
  viewMode: 'bento' | 'library' | 'visualizer' | 'nowPlaying';
  onToggleBentoOrViz: () => void;
  onToggleLibrary: () => void;
}

/**
 * Exact port of ~/.config/quickshell/ii/modules/ii/bar/Media.qml:
 * Dynamically adapts to fixed Nothing OS Obsidian Purple or inherited active skin.
 */
export const TopMediaBar: React.FC<TopMediaBarProps> = ({
  viewMode,
  onToggleBentoOrViz,
  onToggleLibrary,
}) => {
  const { currentTrack, isPlaying, position, duration, volume, muted, triggerOsd } = useAudio();
  const { bentoTokens, bentoThemeMode } = useTheme();
  const [eqPhase, setEqPhase] = useState(0);

  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => setEqPhase((p) => (p + 1) % 4), 180);
    return () => window.clearInterval(id);
  }, [isPlaying]);

  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
  const size = 20;
  const strokeW = 2;
  const radius = (size - strokeW) / 2;
  const circ = 2 * Math.PI * radius;
  const dashOffset = circ * (1 - progress);

  const label = currentTrack
    ? `${currentTrack.title.toUpperCase()} // ${currentTrack.artist.toUpperCase()}`
    : 'AUDIO // STANDBY';

  const padVol = (v: number) => (muted ? 'MUTE' : `${v < 10 ? '00' : v < 100 ? '0' : ''}${v}%`);

  return (
    <header
      style={{
        paddingTop: 'calc(var(--safe-top) + 8px)',
        paddingLeft: 'calc(var(--safe-left) + 12px)',
        paddingRight: 'calc(var(--safe-right) + 12px)',
        paddingBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        zIndex: 30,
        background:
          bentoThemeMode === 'nothing'
            ? 'linear-gradient(180deg, rgba(11,9,16,0.96) 0%, rgba(11,9,16,0.78) 100%)'
            : `${bentoTokens.bgDeep}EB`,
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${bentoTokens.borderDim}`,
      }}
    >
      <button
        type="button"
        onClick={onToggleBentoOrViz}
        title="Tap to toggle Bento / Full Visualizer"
        className="ryo-pressable"
        style={{
          flex: 1,
          minWidth: 0,
          height: 32,
          borderRadius: 999,
          border:
            viewMode === 'bento' || viewMode === 'visualizer'
              ? `1px solid ${bentoTokens.accent}`
              : `1px solid ${bentoTokens.borderDim}`,
          backgroundColor:
            viewMode === 'bento' || viewMode === 'visualizer'
              ? bentoTokens.glowSoft
              : bentoTokens.bgSurface,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 10px 0 6px',
          cursor: 'pointer',
          color: bentoTokens.ink,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: size,
            height: size,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={bentoTokens.borderDim} strokeWidth={strokeW} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={bentoTokens.accent}
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 180ms linear' }}
            />
          </svg>
          <div style={{ position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={isPlaying ? 'graphic_eq' : 'music'} size={10} color={isPlaying ? bentoTokens.accentLavender : bentoTokens.muted} />
          </div>
        </div>

        {isPlaying && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 14, flexShrink: 0 }}>
            {[0, 1, 2].map((index) => {
              const hMode = (eqPhase + index) % 4;
              const h = hMode === 0 ? 5 : hMode === 1 ? 11 : hMode === 2 ? 7 : 13;
              return (
                <div
                  key={index}
                  style={{
                    width: 2,
                    height: h,
                    borderRadius: 1,
                    backgroundColor: index === 1 ? bentoTokens.accentLavender : bentoTokens.accent,
                    transition: 'height 140ms ease-in-out',
                  }}
                />
              );
            })}
          </div>
        )}

        <span
          style={{
            fontFamily: bentoTokens.fontMono,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'left',
            fontSize: 11,
            color: isPlaying ? bentoTokens.ink : bentoTokens.muted,
          }}
        >
          {label}
        </span>
      </button>

      <button
        type="button"
        onClick={triggerOsd}
        className="ryo-pressable"
        style={{
          height: 32,
          padding: '0 9px',
          borderRadius: 999,
          border: `1px solid ${muted ? bentoTokens.error : bentoTokens.borderDim}`,
          backgroundColor: bentoTokens.bgSurface,
          color: muted ? bentoTokens.error : bentoTokens.accentLavender,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <Icon name={muted || volume === 0 ? 'volume-mute' : 'volume'} size={14} color={muted ? bentoTokens.error : bentoTokens.accentLavender} />
        <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 10 }}>{padVol(volume)}</span>
      </button>

      <button
        type="button"
        onClick={onToggleLibrary}
        className="ryo-pressable"
        style={{
          height: 32,
          padding: '0 10px',
          borderRadius: 999,
          border: `1px solid ${bentoTokens.accent}`,
          backgroundColor: viewMode === 'library' ? bentoTokens.accent : bentoTokens.bgElevated,
          color: viewMode === 'library' ? '#FFFFFF' : bentoTokens.ink,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <Icon name="library" size={13} color={viewMode === 'library' ? '#FFFFFF' : bentoTokens.accentLavender} />
        <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 10 }}>
          {viewMode === 'library' ? 'BENTO' : 'LIB'}
        </span>
      </button>
    </header>
  );
};
