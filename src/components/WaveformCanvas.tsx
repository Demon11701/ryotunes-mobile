import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime } from '../audio/AudioContextProvider';
import { buildDeterministicWaveform } from '../audio/providerService';
import { useTheme } from '../theme/ThemeContext';

interface WaveformCanvasProps {
  trackId: string;
  samples?: number[];
  fraction: number; // 0..1
  duration: number;
  height?: number;
  playedColor?: string;
  restColor?: string;
  interactive?: boolean;
  onSeekFraction?: (f: number) => void;
}

/**
 * Exact 1:1 port of /usr/share/ryotunes/client/components/Waveform.qml:
 * 240 thin bars with 70% upper body + 30% mirrored reflection at 0.35 opacity,
 * interactive scrubbing and hover time tooltip.
 */
export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  trackId,
  samples,
  fraction,
  duration,
  height = 56,
  playedColor,
  restColor,
  interactive = true,
  onSeekFraction,
}) => {
  const { accent, providerColor, colors } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const bars = useMemo(() => {
    if (samples && samples.length > 0) return samples;
    return buildDeterministicWaveform(trackId || 'ryotunes', 240);
  }, [samples, trackId]);

  const peak = useMemo(() => Math.max(1, ...bars), [bars]);
  const activeColor = playedColor || (trackId.startsWith('sc:') ? providerColor : accent);
  const idleColor = restColor || colors.inkDim;

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

    const n = 240;
    const slot = w / n;
    const barW = Math.max(1, slot * 0.66);
    const baseY = h * 0.7;
    const topH = h * 0.7;
    const botH = h * 0.3;
    const playedIdx = Math.max(0, Math.min(1, fraction)) * n;

    for (let i = 0; i < n; i++) {
      const idx = Math.floor((i * bars.length) / n);
      const a = Math.max(0.06, bars[idx] / peak);
      const bx = i * slot + (slot - barW) / 2;
      const mh = a * topH;
      const bh = a * botH;

      ctx.fillStyle = i < playedIdx ? activeColor : idleColor;
      ctx.globalAlpha = i < playedIdx ? 0.95 : 0.34;
      ctx.fillRect(bx, baseY - mh, barW, mh);
      ctx.globalAlpha = i < playedIdx ? 0.34 : 0.14;
      ctx.fillRect(bx, baseY, barW, bh);
    }
    ctx.globalAlpha = 1;
  }, [bars, peak, fraction, activeColor, idleColor, height]);

  const calcFrac = (clientX: number) => {
    const el = canvasRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height,
        cursor: interactive ? 'pointer' : 'default',
        touchAction: interactive ? 'none' : 'auto',
      }}
      onPointerDown={(e) => {
        if (!interactive) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        const f = calcFrac(e.clientX);
        setHoverFrac(f);
        onSeekFraction?.(f);
      }}
      onPointerMove={(e) => {
        if (!interactive) return;
        const f = calcFrac(e.clientX);
        setHoverFrac(f);
        if (dragging) onSeekFraction?.(f);
      }}
      onPointerUp={() => {
        setDragging(false);
      }}
      onPointerLeave={() => {
        setHoverFrac(null);
        setDragging(false);
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

      {interactive && hoverFrac !== null && duration > 0 && (
        <>
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${hoverFrac * 100}%`,
              width: 1,
              backgroundColor: 'var(--ink)',
              opacity: 0.4,
              pointerEvents: 'none',
            }}
          />
          <div
            className="font-mono-tech"
            style={{
              position: 'absolute',
              bottom: '100%',
              left: `clamp(24px, ${hoverFrac * 100}%, calc(100% - 24px))`,
              transform: 'translate(-50%, -4px)',
              padding: '2px 6px',
              borderRadius: 4,
              backgroundColor: 'var(--bone)',
              color: 'var(--ink-on-bone)',
              fontSize: 10,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {fmtTime(hoverFrac * duration)}
          </div>
        </>
      )}
    </div>
  );
};
