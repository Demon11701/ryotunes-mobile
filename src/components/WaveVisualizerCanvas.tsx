import React, { useEffect, useRef } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { bandRangeEnergy, sampleBandInterpolated } from '../audio/spectrumUtils';

interface WaveVisualizerCanvasProps {
  points?: number[];
  live: boolean;
  maxVal?: number;
  smoothing?: number;
  color?: string;
  opacity?: number;
  blurPx?: number;
}

/**
 * 60-FPS Ref-Driven 3-layer FFT wave visualizer driven directly by AudioContext spectrum
 * subscription: Bass (0..7), Mids (8..22), and Highs (23..39), decaying smoothly to 0 on pause.
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
  const { getSpectrumPoints, subscribeSpectrum } = useAudio();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRef = useRef<number[]>(points && points.length > 0 ? points : getSpectrumPoints());
  const localPtsRef = useRef<number[]>(new Array(40).fill(0));
  const liveRef = useRef<boolean>(live);
  const envRef = useRef<{ bass: number; mid: number; high: number }>({ bass: 0, mid: 0, high: 0 });
  const phaseRef = useRef<number>(0);

  liveRef.current = live;
  if (points && points.length > 0 && points.some((v) => v > 0)) {
    targetRef.current = points;
  }

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

      const curTgt = targetRef.current;
      const isLive = liveRef.current && curTgt.length > 0;
      const smoothedPts = localPtsRef.current;

      for (let i = 0; i < 40; i++) {
        const tgt = isLive ? curTgt[i] || 0 : 0;
        const next = smoothedPts[i] + (tgt - smoothedPts[i]) * 0.28;
        smoothedPts[i] = next < 0.5 ? 0 : next;
      }

      const targetBass = isLive ? bandRangeEnergy(smoothedPts, 0, 7, maxVal) : 0;
      const targetMid = isLive ? bandRangeEnergy(smoothedPts, 8, 22, maxVal) : 0;
      const targetHigh = isLive ? bandRangeEnergy(smoothedPts, 23, 39, maxVal) : 0;

      const env = envRef.current;
      env.bass += (targetBass - env.bass) * 0.28;
      env.mid += (targetMid - env.mid) * 0.28;
      env.high += (targetHigh - env.high) * 0.28;

      const totalEnergy = env.bass + env.mid + env.high;
      if (!isLive && totalEnergy < 0.004) {
        env.bass = 0;
        env.mid = 0;
        env.high = 0;
        return;
      }

      phaseRef.current += 0.052 + env.bass * 0.065;
      const phase = phaseRef.current;
      const steps = 40;

      const layers = [
        { energy: env.bass, freq: 1.6, speed: 1.0, bandOffset: 0, baseAlpha: 0.78, scaleY: 0.58 },
        { energy: env.mid, freq: 2.5, speed: -1.35, bandOffset: 6, baseAlpha: 0.54, scaleY: 0.45 },
        { energy: env.high, freq: 3.7, speed: 1.85, bandOffset: 12, baseAlpha: 0.38, scaleY: 0.34 },
      ];

      layers.forEach((layer) => {
        if (layer.energy < 0.004) return;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = t * w;
          const specVal = sampleBandInterpolated(smoothedPts, (i + layer.bandOffset) % steps, steps, maxVal);
          const smoothSpec = (specVal * (1 + smoothing * 0.08)) / (1 + smoothing * 0.08);
          const carrier = 0.5 + 0.5 * Math.sin(t * Math.PI * layer.freq * 2 + phase * layer.speed);
          const amp = (layer.energy * 0.62 + smoothSpec * 0.38) * (0.45 + 0.55 * carrier);
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

      if (isLive || totalEnergy >= 0.004) {
        raf = requestAnimationFrame(renderFrame);
      }
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
