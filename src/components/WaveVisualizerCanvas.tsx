import React, { useEffect, useRef } from 'react';
import { bandRangeEnergy, sampleBandInterpolated } from '../audio/spectrumUtils';

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
 * Edge-to-edge 3-layer FFT wave synthesizer driven by real 40-band spectrum:
 * Bass (0..7), Mids (8..22), and Highs (23..39), decaying smoothly to 0 when paused.
 */
export const WaveVisualizerCanvas: React.FC<WaveVisualizerCanvasProps> = ({
  points,
  live,
  maxVal = 1000,
  smoothing = 2,
  color = 'rgba(168, 85, 247, 0.24)',
  opacity = 1,
  blurPx = 3,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<number[]>(points);
  const liveRef = useRef<boolean>(live);
  const envRef = useRef<{ bass: number; mid: number; high: number }>({ bass: 0, mid: 0, high: 0 });
  const phaseRef = useRef<number>(0);

  pointsRef.current = points;
  liveRef.current = live;

  useEffect(() => {
    let raf = 0;

    const renderFrame = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;

      const w = parent.clientWidth;
      const h = parent.clientHeight;
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

      const curPts = pointsRef.current;
      const isLive = liveRef.current && curPts.length > 0;

      const targetBass = isLive ? bandRangeEnergy(curPts, 0, 7, maxVal) : 0;
      const targetMid = isLive ? bandRangeEnergy(curPts, 8, 22, maxVal) : 0;
      const targetHigh = isLive ? bandRangeEnergy(curPts, 23, 39, maxVal) : 0;

      const env = envRef.current;
      const rateBass = targetBass >= env.bass ? 0.42 : 0.16;
      const rateMid = targetMid >= env.mid ? 0.42 : 0.16;
      const rateHigh = targetHigh >= env.high ? 0.42 : 0.16;
      env.bass = env.bass * (1 - rateBass) + targetBass * rateBass;
      env.mid = env.mid * (1 - rateMid) + targetMid * rateMid;
      env.high = env.high * (1 - rateHigh) + targetHigh * rateHigh;

      const totalEnergy = env.bass + env.mid + env.high;
      if (!isLive && totalEnergy < 0.004) {
        env.bass = 0;
        env.mid = 0;
        env.high = 0;
        return;
      }

      phaseRef.current += 0.055 + env.bass * 0.06;
      const phase = phaseRef.current;
      const steps = 40;

      const layers = [
        { energy: env.bass, freq: 1.6, speed: 1.0, bandOffset: 0, baseAlpha: 0.75, scaleY: 0.56 },
        { energy: env.mid, freq: 2.5, speed: -1.35, bandOffset: 6, baseAlpha: 0.52, scaleY: 0.44 },
        { energy: env.high, freq: 3.7, speed: 1.85, bandOffset: 12, baseAlpha: 0.36, scaleY: 0.34 },
      ];

      layers.forEach((layer) => {
        if (layer.energy < 0.004) return;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = t * w;
          const specVal = isLive
            ? sampleBandInterpolated(curPts, (i + layer.bandOffset) % steps, steps, maxVal)
            : 0;
          const smoothSpec = (specVal * (1 + smoothing * 0.08)) / (1 + smoothing * 0.08);
          const carrier = 0.5 + 0.5 * Math.sin(t * Math.PI * layer.freq * 2 + phase * layer.speed);
          const amp = (layer.energy * 0.65 + smoothSpec * 0.35) * (0.45 + 0.55 * carrier);
          const y = h - Math.max(0, Math.min(0.88, amp * layer.scaleY)) * h;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.save();
        ctx.globalAlpha = layer.baseAlpha;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      });

      raf = requestAnimationFrame(renderFrame);
    };

    raf = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(raf);
  }, [live, maxVal, smoothing, color]);

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
