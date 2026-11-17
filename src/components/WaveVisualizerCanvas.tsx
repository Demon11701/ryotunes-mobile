import React, { useEffect, useRef } from 'react';

interface WaveVisualizerCanvasProps {
  points: number[];
  live: boolean;
  maxVal?: number;
  smoothing?: number;
  color?: string;
  opacity?: number;
  blurPx?: number;
}

/**
 * Port of WaveVisualizer.qml:
 * Moving average smoothed spectrum area fill at the base of the Bento card.
 */
export const WaveVisualizerCanvas: React.FC<WaveVisualizerCanvasProps> = ({
  points,
  live,
  maxVal = 1000,
  smoothing = 2,
  color = 'rgba(168, 85, 247, 0.22)',
  opacity = 1,
  blurPx = 4,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w <= 0 || h <= 0) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    if (!live || points.length < 2) return;

    const n = points.length;
    const smoothed: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let count = 0;
      for (let j = -smoothing; j <= smoothing; j++) {
        const idx = Math.max(0, Math.min(n - 1, i + j));
        sum += points[idx] || 0;
        count++;
      }
      smoothed[i] = sum / count;
    }

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < n; i++) {
      const x = (i * w) / (n - 1);
      const y = h - Math.min(1, smoothed[i] / maxVal) * (h * 0.62);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }, [points, live, maxVal, smoothing, color]);

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
        filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
      }}
    />
  );
};
