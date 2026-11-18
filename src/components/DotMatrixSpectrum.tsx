import React, { useEffect, useRef } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { sampleBandInterpolated } from '../audio/spectrumUtils';
import { useTheme } from '../theme/ThemeContext';

interface DotMatrixSpectrumProps {
  points?: number[];
  isPlaying: boolean;
  cols?: number;
  rows?: number;
  maxVal?: number;
  height?: number | string;
  transparent?: boolean;
  roundDots?: boolean;
  peakColor?: string;
  midColor?: string;
  baseColor?: string;
  unlitColor?: string;
  bgColor?: string;
  borderColor?: string;
}

/**
 * 60-FPS Ref-Driven Dot-Matrix Cava Visualizer (26x5, 38x10, 14x3):
 * Subscribes directly to AudioContext spectrum listeners and interpolates locally
 * inside requestAnimationFrame with 0 React re-renders.
 */
export const DotMatrixSpectrum: React.FC<DotMatrixSpectrumProps> = ({
  points,
  isPlaying,
  cols = 26,
  rows = 5,
  maxVal = 1000,
  height = 30,
  transparent = false,
  roundDots = false,
  peakColor,
  midColor,
  baseColor,
  unlitColor,
  bgColor,
  borderColor,
}) => {
  const { getSpectrumPoints, subscribeSpectrum } = useAudio();
  const { bentoTokens } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRef = useRef<number[]>(points && points.length > 0 ? points : getSpectrumPoints());
  const currentRef = useRef<number[]>(new Array(cols).fill(0));
  const liveRef = useRef<boolean>(isPlaying);

  liveRef.current = isPlaying;
  if (points && points.length > 0 && points.some((v) => v > 0)) {
    targetRef.current = points;
  }

  const cPeak = peakColor || bentoTokens.ink;
  const cMid = midColor || bentoTokens.accentLavender;
  const cBase = baseColor || bentoTokens.accent;
  const cUnlit = unlitColor || bentoTokens.vizDotUnlit || 'rgba(168, 85, 247, 0.14)';

  useEffect(() => {
    targetRef.current = getSpectrumPoints();
    const unsub = subscribeSpectrum((pts) => {
      targetRef.current = pts;
    });
    return unsub;
  }, [getSpectrumPoints, subscribeSpectrum]);

  useEffect(() => {
    if (currentRef.current.length !== cols) {
      currentRef.current = new Array(cols).fill(0);
    }

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

      const gapX = cols >= 32 ? 2.5 : 2;
      const gapY = rows >= 8 ? 2 : 2;
      const cellW = Math.max(2, (w - gapX * (cols - 1)) / cols);
      const cellH = Math.max(2, (h - gapY * (rows - 1)) / rows);
      const radius = roundDots ? Math.min(cellW, cellH) / 2 : 1.5;

      const cur = currentRef.current;
      const tgt = targetRef.current;
      const playing = liveRef.current;
      let anyActive = false;

      for (let c = 0; c < cols; c++) {
        const rawTarget = playing && tgt.length > 0 ? sampleBandInterpolated(tgt, c, cols, maxVal) : 0;
        const nextVal = cur[c] + (rawTarget - cur[c]) * 0.28;
        cur[c] = nextVal < 0.002 ? 0 : nextVal;
        if (cur[c] > 0.004) anyActive = true;

        const val = playing || cur[c] > 0.004 ? cur[c] : 0;
        const activeRows = val > 0.01 ? Math.max(1, Math.min(rows, Math.round(Math.pow(val, 0.82) * rows))) : 0;

        for (let r = 0; r < rows; r++) {
          const rowFromBottom = rows - 1 - r;
          const x = c * (cellW + gapX);
          const y = r * (cellH + gapY);

          if (rowFromBottom < activeRows) {
            if (rowFromBottom === rows - 1) ctx.fillStyle = cPeak;
            else if (rowFromBottom >= rows - 2) ctx.fillStyle = cMid;
            else ctx.fillStyle = cBase;
            ctx.globalAlpha = 0.96;
          } else {
            ctx.fillStyle = cUnlit;
            ctx.globalAlpha = roundDots ? 0.45 : 1;
          }
          ctx.beginPath();
          ctx.roundRect(x, y, cellW, cellH, radius);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      if (playing || anyActive) {
        raf = requestAnimationFrame(renderFrame);
      }
    };

    raf = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, cols, rows, maxVal, roundDots, cPeak, cMid, cBase, cUnlit]);

  return (
    <div
      style={{
        width: '100%',
        height,
        borderRadius: transparent ? 0 : 6,
        backgroundColor: transparent ? 'transparent' : bgColor || bentoTokens.bgSurface,
        border: transparent ? 'none' : `1px solid ${borderColor || bentoTokens.borderDim}`,
        padding: transparent ? 0 : 4,
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
};
