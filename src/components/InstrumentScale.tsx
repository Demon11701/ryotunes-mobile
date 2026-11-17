import React, { useRef, useState } from 'react';

interface InstrumentScaleProps {
  divisions?: number;
  majorEvery?: number;
  fraction: number; // 0..1
  ink?: string;
  accent?: string;
  height?: number;
  interactive?: boolean;
  onSeekFraction?: (fraction: number) => void;
}

/**
 * Port of InstrumentScale.qml:
 * Graduated vertical division ticks with major ticks every N marks (default 6 for 42-tick player scrubber).
 */
export const InstrumentScale: React.FC<InstrumentScaleProps> = ({
  divisions = 42,
  majorEvery = 6,
  fraction,
  ink = '#847A9E',
  accent = '#A855F7',
  height = 14,
  interactive = true,
  onSeekFraction,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const clamped = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;

  const computeFraction = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return clamped;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  return (
    <div
      ref={trackRef}
      role={interactive ? 'slider' : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      onPointerDown={(e) => {
        if (!interactive || !onSeekFraction) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        onSeekFraction(computeFraction(e.clientX));
      }}
      onPointerMove={(e) => {
        if (!dragging || !interactive || !onSeekFraction) return;
        onSeekFraction(computeFraction(e.clientX));
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      style={{
        width: '100%',
        height: height + 10,
        paddingTop: 5,
        paddingBottom: 5,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 2,
        cursor: interactive ? 'pointer' : 'default',
        touchAction: 'none',
      }}
    >
      {Array.from({ length: divisions }).map((_, idx) => {
        const major = idx % majorEvery === 0;
        const filled = (idx + 0.5) / divisions <= clamped;
        const tickH = Math.round(height * (major ? 1 : 0.7));
        return (
          <div
            key={idx}
            style={{
              flex: 1,
              maxWidth: 3,
              height: tickH,
              borderRadius: 1,
              backgroundColor: filled ? accent : ink,
              opacity: filled ? 1 : major ? 0.42 : 0.22,
              transition: dragging ? 'none' : 'background-color 90ms ease, opacity 90ms ease',
            }}
          />
        );
      })}
    </div>
  );
};
