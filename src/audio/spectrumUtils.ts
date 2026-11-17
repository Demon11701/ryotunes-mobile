/**
 * Sanitizes and fractionally interpolates the 40-band FFT array across any
 * visualizer target resolution (26 cols, 38 cols, 40 cols, or wave ribbons)
 * so zero sectors ever drop to NaN or dead gaps.
 */
export function sampleBandInterpolated(
  points: number[],
  targetIndex: number,
  totalTargets: number,
  maxVal = 1000
): number {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const denom = Number.isFinite(maxVal) && maxVal > 0 ? maxVal : 1000;
  const sanitize = (v: unknown): number => {
    const num = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(num) ? Math.max(0, Math.min(1, num / denom)) : 0;
  };

  if (points.length === 1 || totalTargets <= 1) {
    return sanitize(points[0]);
  }

  const pos = Math.max(0, Math.min(points.length - 1, (targetIndex / (totalTargets - 1)) * (points.length - 1)));
  const lo = Math.floor(pos);
  const hi = Math.min(points.length - 1, Math.ceil(pos));
  const frac = pos - lo;
  return sanitize(points[lo]) * (1 - frac) + sanitize(points[hi]) * frac;
}

export function bandRangeEnergy(
  points: number[],
  startBand: number,
  endBand: number,
  maxVal = 1000
): number {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const lo = Math.max(0, Math.min(points.length - 1, startBand));
  const hi = Math.max(lo, Math.min(points.length - 1, endBand));
  let sum = 0;
  let count = 0;
  for (let i = lo; i <= hi; i++) {
    sum += sampleBandInterpolated(points, i, points.length, maxVal);
    count++;
  }
  return count > 0 ? sum / count : 0;
}
