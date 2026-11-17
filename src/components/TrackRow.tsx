import React from 'react';
import { fmtTime, useAudio } from '../audio/AudioContextProvider';
import { Track } from '../audio/types';
import { Icon } from '../icons/Icon';
import { Artwork } from './Artwork';
import { OfflineButton } from './OfflineButton';
import { ProviderBadge } from './ProviderBadge';

interface TrackRowProps {
  track: Track;
  index?: number;
  active?: boolean;
  onPlay: () => void;
  onAction?: () => void;
  actionIcon?: string;
}

/**
 * Port of /usr/share/ryotunes/client/components/TrackRow.qml
 * Includes ProviderBadge, [ ↓ OFFLINE ] download trigger, and favorite heart.
 */
export const TrackRow: React.FC<TrackRowProps> = ({
  track,
  index,
  active = false,
  onPlay,
  onAction,
  actionIcon,
}) => {
  const { likedIds, toggleLike, resolvingTrackId } = useAudio();
  const liked = likedIds.includes(track.id);
  const resolving = resolvingTrackId === track.id;

  return (
    <div
      onClick={onPlay}
      className="ryo-pressable"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minHeight: 56,
        padding: '6px 8px',
        borderRadius: 'var(--radius)',
        backgroundColor: active ? 'var(--tint-10)' : 'transparent',
        borderBottom: active ? '1px solid transparent' : '1px solid var(--line-soft)',
        cursor: 'pointer',
      }}
    >
      {/* Index or Active accent music note */}
      {index !== undefined && (
        <div
          style={{
            width: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {active ? (
            <Icon name="graphic_eq" size={16} color="var(--accent)" />
          ) : (
            <span className="font-mono-tech" style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
              {index + 1}
            </span>
          )}
        </div>
      )}

      <Artwork src={track.artwork} size={40} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: active ? 'var(--accent)' : 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {resolving ? `Resolving: ${track.title}` : track.title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-muted)',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {track.artist}
          </span>
          <ProviderBadge track={track} compact />
        </div>
      </div>

      <span className="font-mono-tech" style={{ fontSize: 10.5, color: 'var(--ink-faint)', flexShrink: 0 }}>
        {fmtTime(track.duration)}
      </span>

      <OfflineButton track={track} />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleLike(track.id);
        }}
        aria-label="Toggle favorite"
        className="ryo-pressable"
        style={{
          width: 30,
          height: 30,
          borderRadius: 'var(--radius)',
          background: 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <Icon name="heart" size={15} color={liked ? 'var(--accent)' : 'var(--ink-faint)'} />
      </button>

      {onAction && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          aria-label="Track options"
          className="ryo-pressable"
          style={{
            width: 30,
            height: 30,
            borderRadius: 'var(--radius)',
            background: 'transparent',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Icon name={actionIcon || 'more'} size={15} color="var(--ink-muted)" />
        </button>
      )}
    </div>
  );
};
