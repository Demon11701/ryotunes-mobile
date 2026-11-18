import React, { useEffect, useRef } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { sampleBandInterpolated } from '../audio/spectrumUtils';
import { useTheme } from '../theme/ThemeContext';

interface SpectrumCanvasProps {
  points?: number[];
  live: boolean;
  height?: number;
  forceMode?: 'wave' | 'bars' | 'dot-matrix';
  accentOverride?: string;
  inkOverride?: string;
}

/**
 * 60-FPS Ref-Driven SpectrumCanvas:
 * Reads real FFT target points via AudioContext subscription without React re-renders.
 */
export const SpectrumCanvas: React.FC<SpectrumCanvasProps> = ({
  points,
  live,
  height = 56,
  forceMode,
  accentOverride,
  inkOverride,
}) => {
  const { getSpectrumPoints, subscribeSpectrum } = useAudio();
  const { accent, colors, visualizerStyle } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRef = useRef<number[]>(points && points.length > 0 ? points : getSpectrumPoints());
  const currentRef = useRef<number[]>(new Array(40).fill(0));
  const liveRef = useRef<boolean>(live);

  liveRef.current = live;
  if (points && points.length > 0 && points.some((v) => v > 0)) {
    targetRef.current = points;
  }

  const mode = forceMode || (visualizerStyle === 'spectrum-bars' ? 'bars' : 'wave');
  const c0 = accentOverride || accent;
  const c1 = inkOverride || colors.ink;

  useEffect(() => {
    targetRef.current = getSpectrumPoints();
    const unsub = subscribeSpectrum((pts) => {
      targetRef.current = pts;
    });
    return unsub;
  }, [getSpectrumPoints, subscribeSpectrum]);

  useEffect(() => {
    let raf = 0;

    const renderFrame = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w <= 0 || h <= 0) {
        if (liveRef.current) raf = requestAnimationFrame(renderFrame);
        return;
      }

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = Math.floor(w * dpr);
      const targetH = Math.floor(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w + 1, h + 1);

      const bands = 40;
      const slotW = w / bands;
      const barW = Math.max(2, slotW * 0.56);

      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, c0);
      grad.addColorStop(1, c1);
      ctx.fillStyle = grad;

      const cur = currentRef.current;
      const tgt = targetRef.current;
      const isLive = liveRef.current;
      let anyActive = false;

      if (mode === 'bars') {
        for (let i = 0; i < bands; i++) {
          const targetVal = isLive && tgt.length > 0 ? sampleBandInterpolated(tgt, i, bands, 1000) : 0;
          const next = cur[i] + (targetVal - cur[i]) * 0.28;
          cur[i] = next < 0.002 ? 0 : next;
          if (cur[i] > 0.005) anyActive = true;
          if (cur[i] <= 0.005) continue;
          const barH = Math.max(2, cur[i] * (h * 0.9));
          const x = i * slotW + (slotW - barW) / 2;
          const y = h - barH;
          ctx.beginPath();
          ctx.roundRect(x, y, barW, barH, 2);
          ctx.fill();
        }
      } else {
        const midY = h / 2;
        for (let i = 0; i < bands; i++) {
          const targetVal = isLive && tgt.length > 0 ? sampleBandInterpolated(tgt, i, bands, 1000) : 0;
          const next = cur[i] + (targetVal - cur[i]) * 0.28;
          cur[i] = next < 0.002 ? 0 : next;
          if (cur[i] > 0.005) anyActive = true;
          if (cur[i] <= 0.005) continue;
          const barH = Math.max(2, cur[i] * (h * 0.88));
          const x = i * slotW + (slotW - barW) / 2;
          const y = midY - barH / 2;
          ctx.beginPath();
          ctx.roundRect(x, y, barW, barH, barW / 2);
          ctx.fill();
        }
      }

      if (isLive || anyActive) {
        raf = requestAnimationFrame(renderFrame);
      }
    };

    raf = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(raf);
  }, [live, c0, c1, mode]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height,
        opacity: live ? 0.85 : 0.35,
        transition: 'opacity 200ms ease',
        display: 'block',
      }}
    />
  );
};
