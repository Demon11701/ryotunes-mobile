import React from 'react';
import { Icon } from '../icons/Icon';

interface ArtworkProps {
  src?: string;
  collage?: string[];
  size?: number;
  round?: boolean;
  radius?: number;
  placeholderIcon?: string;
}

export const Artwork: React.FC<ArtworkProps> = ({
  src,
  collage,
  size = 44,
  round = false,
  radius,
  placeholderIcon = 'music',
}) => {
  const corner = round ? size / 2 : radius ?? 'var(--radius)';

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: corner,
        backgroundColor: 'var(--paper-lift)',
        border: '1px solid var(--line-soft)',
        overflow: 'hidden',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      {collage && collage.length === 4 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            width: '100%',
            height: '100%',
          }}
        >
          {collage.map((u, idx) => (
            <img key={idx} src={u} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ))}
        </div>
      ) : src ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <Icon name={placeholderIcon} size={Math.round(size * 0.44)} color="var(--ink-faint)" />
      )}
    </div>
  );
};
