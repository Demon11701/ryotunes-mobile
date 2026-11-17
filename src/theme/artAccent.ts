/**
 * Port of /usr/share/ryotunes/client/components/ArtAccent.qml
 * 24x24 downsample, 3-bit RGB channel buckets, saturation * mid-lightness scoring.
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h, s, l];
}

export async function sampleArtworkAccent(
  imageUrl: string | undefined,
  paperDark: boolean
): Promise<string | null> {
  if (!imageUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const buckets: Record<number, { n: number; r: number; g: number; b: number; score: number }> = {};
        let best: { n: number; r: number; g: number; b: number; score: number } | null = null;

        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const max = Math.max(r, g, b) / 255;
          const min = Math.min(r, g, b) / 255;
          const sat = max === 0 ? 0 : (max - min) / max;
          if (sat < 0.12) continue;
          const score = sat * (1 - Math.abs(max - 0.65));
          const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
          const cur = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0, score: 0 });
          cur.n++;
          cur.r += r;
          cur.g += g;
          cur.b += b;
          cur.score += score;
          if (!best || cur.score > best.score) best = cur;
        }

        if (!best) {
          resolve(null);
          return;
        }
        const [h, s] = rgbToHsl(best.r / best.n, best.g / best.n, best.b / best.n);
        const clampedSat = Math.round(Math.max(0.6, Math.min(0.85, s)) * 100);
        const lightness = paperDark ? 72 : 42;
        resolve(`hsl(${Math.round(h * 360)}, ${clampedSat}%, ${lightness}%)`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}
