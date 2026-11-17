import React, { useEffect, useRef } from 'react';
import { useTheme } from '../theme/ThemeContext';

interface DotMatrixSpectrumProps {
  points: number[];
  isPlaying: boolean;
  cols?: number;
  rows?: number;
  maxVal?: number;
  peakColor?: string;
  midColor?: string;
  baseColor?: string;
  unlitColor?: string;
  bgColor?: string;
  borderColor?: string;
}

/**
 * Modular Dot-Matrix Cava Visualizer (26 cols x 5 LED rows) with dynamic Bento tokens.
 */
export const DotMatrixSpectrum: React.FC<DotMatrixSpectrumProps> = ({
  points,
  isPlaying,
  cols = 26,
  rows = 5,
  maxVal = 1000,
  peakColor,
  midColor,
  baseColor,
  unlitColor,
  bgColor,
  borderColor,
}) => {
  const { bentoTokens } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const cPeak = peakColor || bentoTokens.ink;
  const cMid = midColor || bentoTokens.accentLavender;
  const cBase = baseColor || bentoTokens.accent;
  const cUnlit = unlitColor || 'rgba(168, 85, 247, 0.14)';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;

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
    ctx.clearRect(0, 0, w, h);

    const gapX = 2;
    const gapY = 2;
    const cellW = Math.max(2, (w - gapX * (cols - 1)) / cols);
    const cellH = Math.max(2, (h - gapY * (rows - 1)) / rows);
    const numPts = points.length;

    for (let c = 0; c < cols; c++) {
      let val = 0;
      if (isPlaying && numPts > 0) {
        const startIdx = Math.floor((c / cols) * numPts);
        const endIdx = Math.max(startIdx + 1, Math.floor(((c + 1) / cols) * numPts));
        let bandMax = 0;
        for (let k = startIdx; k < Math.min(numPts, endIdx); k++) {
          const v = points[k] || 0;
          if (v > bandMax) bandMax = v;
        }
        val = Math.min(1.0, Math.max(0, bandMax / maxVal));
      }

      const activeRows = val > 0.01 ? Math.max(1, Math.round(val * rows)) : 0;
      for (let r = 0; r < rows; r++) {
        const rowFromBottom = rows - 1 - r;
        const x = c * (cellW + gapX);
        const y = r * (cellH + gapY);

        if (rowFromBottom < activeRows) {
          if (rowFromBottom === rows - 1) ctx.fillStyle = cPeak;
          else if (rowFromBottom >= rows - 2) ctx.fillStyle = cMid;
          else ctx.fillStyle = cBase;
        } else {
          ctx.fillStyle = cUnlit;
        }
        ctx.fillRect(x, y, cellW, cellH);
      }
    }
  }, [points, isPlaying, cols, rows, maxVal, cPeak, cMid, cBase, cUnlit]);

  return (
    <div
      style={{
        width: '100%',
        height: 30,
        borderRadius: 6,
        backgroundColor: bgColor || bentoTokens.bgSurface,
        border: `1px solid ${borderColor || bentoTokens.borderDim}`,
        padding: 4,
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
};
