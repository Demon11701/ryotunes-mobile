import React, { useEffect, useRef } from 'react';
import { useTheme } from '../theme/ThemeContext';

interface SpectrumCanvasProps {
  points: number[];
  live: boolean;
  height?: number;
  forceMode?: 'wave' | 'bars' | 'dot-matrix';
  accentOverride?: string;
  inkOverride?: string;
}

/**
 * Port of SpectrumField.qml:
 * Supports "wave" (centered bars / fluid ribbon) and "bars" (equalizer columns with peak dots).
 */
export const SpectrumCanvas: React.FC<SpectrumCanvasProps> = ({
  points,
  live,
  height = 56,
  forceMode,
  accentOverride,
  inkOverride,
}) => {
  const { accent, colors, visualizerStyle } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mode = forceMode || (visualizerStyle === 'spectrum-bars' ? 'bars' : 'wave');
  const c0 = accentOverride || accent;
  const c1 = inkOverride || colors.ink;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const bands = 40;
    const slotW = w / bands;
    const barW = Math.max(2, slotW * 0.56);

    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, c0);
    grad.addColorStop(1, c1);
    ctx.fillStyle = grad;

    if (mode === 'bars') {
      for (let i = 0; i < bands; i++) {
        const raw = live && points.length > 0 ? Math.min(1, Math.max(0, (points[i] || 0) / 1000)) : 0;
        if (raw <= 0.005) continue;
        const barH = Math.max(2, raw * (h * 0.9));
        const x = i * slotW + (slotW - barW) / 2;
        const y = h - barH;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 2);
        ctx.fill();
      }
      return;
    }

    // Center-growing wave field matching NowPlaying.qml SpectrumField
    const midY = h / 2;
    for (let i = 0; i < bands; i++) {
      const raw = live && points.length > 0 ? Math.min(1, Math.max(0, (points[i] || 0) / 1000)) : 0;
      if (raw <= 0.005) continue;
      const barH = Math.max(2, raw * (h * 0.88));
      const x = i * slotW + (slotW - barW) / 2;
      const y = midY - barH / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, barW / 2);
      ctx.fill();
    }
  }, [points, live, c0, c1, mode]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height,
        opacity: live ? 0.78 : 0.25,
        transition: 'opacity 200ms ease',
        display: 'block',
      }}
    />
  );
};
