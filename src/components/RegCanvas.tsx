import React, { useEffect, useRef } from 'react';
import { useTheme } from '../theme/ThemeContext';

/**
 * Exact port of /usr/lib/qt6/qml/Ryoku/Ui/Reg.qml:
 * Registration dot grid (46px pitch), sparse + marks every 4 intersections,
 * and 4 corner print-register crosses.
 */
export const RegCanvas: React.FC<{ opacity?: number }> = ({ opacity = 0.7 }) => {
  const { decor, colors } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (decor !== 'rich') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const paint = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w <= 0 || h <= 0) return;

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      const cell = 46;
      const every = 4;
      const margin = 18;
      const rgb = colors.ink.startsWith('#') ? colors.ink : '#eadfed';
      const r = parseInt(rgb.slice(1, 3), 16) || 205;
      const g = parseInt(rgb.slice(3, 5), 16) || 196;
      const b = parseInt(rgb.slice(5, 7), 16) || 186;

      for (let gy = 0; gy * cell < h + cell; gy++) {
        for (let gx = 0; gx * cell < w + cell; gx++) {
          const x = gx * cell;
          const y = gy * cell;
          if (gx % every === 0 && gy % every === 0) {
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.13)`;
            ctx.fillRect(x - 3, y, 7, 1);
            ctx.fillRect(x, y - 3, 1, 7);
          } else {
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.07)`;
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.32)`;
      const pts: [number, number][] = [
        [margin, margin],
        [w - margin, margin],
        [margin, h - margin],
        [w - margin, h - margin],
      ];
      for (const [px, py] of pts) {
        ctx.fillRect(px - 7, py, 15, 1);
        ctx.fillRect(px, py - 7, 1, 15);
      }
    };

    paint();
    const ro = new ResizeObserver(paint);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, [decor, colors.ink]);

  if (decor !== 'rich') return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        opacity,
      }}
    />
  );
};
