import React, { useEffect, useRef } from 'react';

interface DotMatrixGridProps {
  step?: number;
  color?: string;
  opacity?: number;
  inset?: number;
  dotSize?: number;
}

/**
 * Nothing OS Dot-Matrix Background Canvas (PlayerControl.qml / OsdValueIndicator.qml).
 */
export const DotMatrixGrid: React.FC<DotMatrixGridProps> = ({
  step = 12,
  color = '#C084FC',
  opacity = 0.16,
  inset = 6,
  dotSize = 1.5,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const paint = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = Math.max(1, parent.clientWidth - inset * 2);
      const h = Math.max(1, parent.clientHeight - inset * 2);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;

      for (let x = 6; x < w; x += step) {
        for (let y = 6; y < h; y += step) {
          ctx.fillRect(x, y, dotSize, dotSize);
        }
      }
    };

    paint();
    const ro = new ResizeObserver(paint);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, [step, color, inset, dotSize]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: inset,
        left: inset,
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
};
