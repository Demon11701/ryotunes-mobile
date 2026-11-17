import React from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { Icon } from '../icons/Icon';
import { Artwork } from './Artwork';
import { OfflineButton } from './OfflineButton';
import { ProviderBadge } from './ProviderBadge';
import { SeekbarControl } from './SeekbarControl';

interface PlayerBarProps {
  onOpenNowPlaying: () => void;
  onOpenSound: () => void;
}

/**
 * Persistent bottom transport bar for Ryotunes Library surface (PlayerBar.qml).
 * Honors Hairline / Waveform (240 bars) / InstrumentScale seekbar mode + Offline download button.
 */
export const PlayerBar: React.FC<PlayerBarProps> = ({ onOpenNowPlaying, onOpenSound }) => {
  const { currentTrack, isPlaying, position, duration, togglePlay, next, seek } = useAudio();
  if (!currentTrack) return null;

  const fraction = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  return (
    <div
      onClick={onOpenNowPlaying}
      style={{
        position: 'relative',
        flexShrink: 0,
        backgroundColor: 'var(--paper-lift)',
        borderTop: '1px solid var(--line)',
        paddingBottom: 'var(--safe-bottom)',
        cursor: 'pointer',
      }}
    >
      {/* Top interactive seekbar honoring active seekbarStyle */}
      <div onClick={(e) => e.stopPropagation()} style={{ padding: '0 4px' }}>
        <SeekbarControl
          trackId={currentTrack.id}
          samples={currentTrack.waveform}
          fraction={fraction}
          duration={duration}
          compact
          onSeekFraction={(f) => seek(f * duration)}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px 8px' }}>
        <Artwork src={currentTrack.artwork} size={44} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentTrack.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
            <span
              style={{
                fontSize: 12,
                color: 'var(--ink-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {currentTrack.artist}
            </span>
            <ProviderBadge track={currentTrack} compact />
          </div>
        </div>

        <OfflineButton track={currentTrack} compact />

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSound();
          }}
          aria-label="Sound effects"
          className="ryo-pressable"
          style={{
            width: 34,
            height: 34,
            borderRadius: 'var(--radius)',
            backgroundColor: 'transparent',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Icon name="sound" size={17} color="var(--ink-muted)" />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="ryo-pressable"
          style={{
            width: 38,
            height: 38,
            borderRadius: 'var(--radius)',
            backgroundColor: 'var(--bone)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Icon name={isPlaying ? 'pause' : 'play'} size={18} color="var(--ink-on-bone)" />
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
            width: 34,
            height: 34,
            borderRadius: 'var(--radius)',
            backgroundColor: 'transparent',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Icon name="next" size={17} color="var(--ink)" />
        </button>
      </div>
    </div>
  );
};
