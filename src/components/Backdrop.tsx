import React from 'react';
import { useTheme } from '../theme/ThemeContext';
import { RegCanvas } from './RegCanvas';

interface BackdropProps {
  artwork?: string;
  strength?: number;
  focusX?: number;
  focusY?: number;
}

/**
 * Port of Backdrop.qml + ProviderGlow.qml + Reg.qml:
 * Cover blur (64px) weighted by wash, smooth radial provider bloom (YT/Spotify/SoundCloud/Tidal),
 * and Rich mode print-registration grid overlay.
 */
export const Backdrop: React.FC<BackdropProps> = ({
  artwork,
  strength = 0.24,
  focusX = 82,
  focusY = 12,
}) => {
  const { effectiveWash, blurEnabled, providerGlowEnabled, providerColor, accent, decor } = useTheme();
  const effectiveStrength = blurEnabled ? Math.min(0.68, strength * effectiveWash) : 0;
  const glowTint = providerGlowEnabled ? providerColor : accent;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {artwork && effectiveStrength > 0 && (
        <img
          src={artwork}
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: effectiveStrength,
            filter: 'blur(64px) saturate(1.22)',
            transform: 'scale(1.08)',
            transition: 'opacity 320ms ease',
          }}
        />
      )}
      {/* Radial edge fade toward paper */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at ${focusX}% ${focusY}%, transparent 0%, color-mix(in srgb, var(--paper) 60%, transparent) 55%, var(--paper) 96%)`,
        }}
      />
      {/* Paper glass (App.qml line 159) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'var(--paper)',
          opacity: decor === 'rich' ? 0.78 : 0.88,
          transition: 'background-color 220ms ease',
        }}
      />
      {/* ProviderGlow.qml animated radial catalogue glow */}
      {providerGlowEnabled && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(circle at ${focusX}% ${focusY}%, ${glowTint}42 0%, ${glowTint}1A 35%, transparent 72%)`,
            transition: 'background 360ms ease',
          }}
        />
      )}
      {/* Registration sheet when Rich decor is active */}
      {decor === 'rich' && <RegCanvas opacity={0.45} />}
    </div>
  );
};
