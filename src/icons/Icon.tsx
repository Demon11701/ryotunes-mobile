import React from 'react';
import { GLYPHS } from './glyphs';

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 18,
  color = 'currentColor',
  className = '',
  style,
}) => {
  const glyph = GLYPHS[name];
  if (!glyph) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={{ flexShrink: 0, display: 'block', ...style }}
      aria-hidden="true"
    >
      <path
        d={glyph.d}
        stroke={glyph.fill ? 'none' : color}
        fill={glyph.fill ? color : 'none'}
        strokeWidth={glyph.w ?? 1.5}
        strokeLinecap={glyph.cap ?? 'round'}
        strokeLinejoin="round"
      />
    </svg>
  );
};
