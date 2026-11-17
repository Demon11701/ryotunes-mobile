import React from 'react';
import { Track } from '../audio/types';
import { Icon } from '../icons/Icon';
import { PROVIDER_COLORS } from '../theme/skins';

interface ProviderBadgeProps {
  track?: Pick<Track, 'provider' | 'source' | 'offline'>;
  provider?: string;
  compact?: boolean;
}

const LABELS: Record<string, { label: string; glyph: string }> = {
  youtube: { label: 'YT MUSIC', glyph: 'youtube-music' },
  spotify: { label: 'SPOTIFY', glyph: 'spotify' },
  soundcloud: { label: 'SOUNDCLOUD', glyph: 'soundcloud' },
  tidal: { label: 'TIDAL', glyph: 'tidal' },
  local: { label: 'LOCAL', glyph: 'folder' },
  offline: { label: 'OFFLINE', glyph: 'check-circle' },
  demo: { label: 'DEMO', glyph: 'music' },
};

/**
 * Port of /usr/share/ryotunes/client/components/ProviderBadge.qml:
 * Provider glyph in brand colour on a compact chip, with OFFLINE pill when cached locally.
 */
export const ProviderBadge: React.FC<ProviderBadgeProps> = ({ track, provider, compact = false }) => {
  const key = provider || track?.provider || track?.source || 'local';
  const meta = LABELS[key] || LABELS.local;
  const color = PROVIDER_COLORS[key] || PROVIDER_COLORS.local;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <span
        className="font-mono-tech"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          height: compact ? 18 : 20,
          padding: compact ? '0 5px' : '0 7px',
          borderRadius: 999,
          backgroundColor: 'rgba(10, 8, 16, 0.65)',
          border: `1px solid ${color}55`,
          color,
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: 0.6,
        }}
      >
        <Icon name={meta.glyph} size={11} color={color} />
        {!compact && <span>{meta.label}</span>}
      </span>

      {track?.offline && (
        <span
          className="font-mono-tech"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            height: compact ? 18 : 20,
            padding: '0 6px',
            borderRadius: 999,
            backgroundColor: 'var(--accent-soft)',
            border: '1px solid var(--accent)',
            color: 'var(--accent)',
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: 0.7,
          }}
        >
          <Icon name="check-circle" size={10} color="var(--accent)" />
          <span>OFFLINE</span>
        </span>
      )}
    </span>
  );
};
