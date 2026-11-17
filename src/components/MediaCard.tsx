import React from 'react';
import { Icon } from '../icons/Icon';
import { Artwork } from './Artwork';

interface MediaCardProps {
  title: string;
  subtitle?: string;
  artwork?: string;
  collage?: string[];
  round?: boolean;
  width?: number;
  placeholderIcon?: string;
  onOpen: () => void;
  onPlay?: () => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  title,
  subtitle,
  artwork,
  collage,
  round = false,
  width = 148,
  placeholderIcon = 'music',
  onOpen,
  onPlay,
}) => {
  return (
    <div
      onClick={onOpen}
      className="ryo-pressable"
      style={{
        width,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        cursor: 'pointer',
      }}
    >
      <div style={{ position: 'relative', width, height: width }}>
        <Artwork
          src={artwork}
          collage={collage}
          size={width}
          round={round}
          radius={round ? width / 2 : undefined}
          placeholderIcon={round ? 'user' : placeholderIcon}
        />
        {!round && onPlay && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            aria-label={`Play ${title}`}
            className="ryo-pressable"
            style={{
              position: 'absolute',
              right: 8,
              bottom: 8,
              width: 34,
              height: 34,
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--paper)',
              border: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name="play" size={14} color="var(--ink)" />
          </button>
        )}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--ink)',
          textAlign: round ? 'center' : 'left',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </div>
      {subtitle && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-muted)',
            textAlign: round ? 'center' : 'left',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: -4,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
};
