import React from 'react';

interface InstrumentBracketsProps {
  color?: string;
  length?: number;
  weight?: number;
  inset?: number;
  opacity?: number;
}

/**
 * Exact port of InstrumentBrackets.qml:
 * Two opposite corner L-ticks framing the surface (top-left ┌ and bottom-right ┘).
 */
export const InstrumentBrackets: React.FC<InstrumentBracketsProps> = ({
  color = '#A855F7',
  length = 10,
  weight = 2,
  inset = 6,
  opacity = 0.85,
}) => {
  const shared: React.CSSProperties = {
    position: 'absolute',
    backgroundColor: color,
    pointerEvents: 'none',
    opacity,
  };

  return (
    <>
      {/* Top-Left ┌ */}
      <div style={{ ...shared, top: inset, left: inset, width: length, height: weight }} />
      <div style={{ ...shared, top: inset, left: inset, width: weight, height: length }} />
      {/* Bottom-Right ┘ */}
      <div style={{ ...shared, bottom: inset, right: inset, width: length, height: weight }} />
      <div style={{ ...shared, bottom: inset, right: inset, width: weight, height: length }} />
    </>
  );
};
