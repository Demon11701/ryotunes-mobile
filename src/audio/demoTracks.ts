import { Track } from './types';

function makeCoverSvgDataUrl(
  title: string,
  sub: string,
  c1: string,
  c2: string,
  accent: string
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="70%" cy="28%" r="60%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <rect width="400" height="400" fill="url(#glow)"/>
  <circle cx="200" cy="185" r="96" fill="none" stroke="${accent}" stroke-width="2" stroke-opacity="0.65" stroke-dasharray="6 8"/>
  <circle cx="200" cy="185" r="56" fill="none" stroke="#F3EEFF" stroke-width="1.5" stroke-opacity="0.38"/>
  <circle cx="200" cy="185" r="14" fill="${accent}"/>
  <text x="28" y="340" fill="#F3EEFF" font-family="monospace" font-size="22" font-weight="bold" letter-spacing="2">${title}</text>
  <text x="28" y="368" fill="#C084FC" font-family="monospace" font-size="13" letter-spacing="3">${sub}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Generates an actual playable PCM WAV blob so WebAudio AnalyserNode produces real,
 * musical 60fps FFT spectrum data in the browser preview without external assets.
 */
function synthesizeLoopWav(
  chordFreqs: number[],
  bassFreq: number,
  bpm: number,
  durationSec = 32
): string {
  const sampleRate = 22050;
  const totalSamples = sampleRate * durationSec;
  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, totalSamples * 2, true);

  const beatDur = 60 / bpm;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const beatPos = (t % beatDur) / beatDur;
    const step = Math.floor(t / beatDur);

    // Punchy sub kick envelope every beat
    const kickEnv = Math.exp(-beatPos * 9.5);
    const kick = Math.sin(2 * Math.PI * (52 + 80 * Math.exp(-beatPos * 18)) * t) * kickEnv * 0.42;

    // Warm bass pulse
    const bFreq = bassFreq * (step % 4 === 3 ? 1.122 : step % 4 === 2 ? 0.891 : 1);
    const bass =
      (Math.sin(2 * Math.PI * bFreq * t) + 0.35 * Math.sin(4 * Math.PI * bFreq * t)) *
      (0.24 + 0.14 * Math.sin(2 * Math.PI * (t / (beatDur * 2))));

    // Shimmer pad chord + arpeggio note
    let pad = 0;
    for (let k = 0; k < chordFreqs.length; k++) {
      pad += Math.sin(2 * Math.PI * chordFreqs[k] * t) * 0.085;
    }
    const arpFreq = chordFreqs[step % chordFreqs.length] * (step % 8 >= 4 ? 2 : 1);
    const arpEnv = Math.exp(-((t % (beatDur / 2)) / (beatDur / 2)) * 5.2);
    const arp = Math.sin(2 * Math.PI * arpFreq * t) * arpEnv * 0.16;

    // Crisp hi-hat tick on off-beats
    const hatPhase = (t + beatDur * 0.5) % beatDur;
    const hatEnv = Math.exp(-(hatPhase / beatDur) * 26);
    const hat = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * hatEnv * 0.08;

    const sample = Math.max(-0.95, Math.min(0.95, kick + bass + pad + arp + hat));
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

let cachedDemos: Track[] | null = null;

export function getDemoTracks(): Track[] {
  if (cachedDemos) return cachedDemos;

  cachedDemos = [
    {
      id: 'DEMO:1',
      title: 'Obsidian Telemetry',
      artist: 'Ryoku // Synth Lab',
      album: 'Nothing Purple Vol. I',
      duration: 32,
      src: synthesizeLoopWav([220, 261.63, 329.63, 392.0], 55, 118, 32),
      artwork: makeCoverSvgDataUrl('OBSIDIAN', 'NOTHING × RYOKU', '#0B0910', '#24143B', '#A855F7'),
      format: 'WAV',
      source: 'demo',
      lyrics: {
        synced: true,
        source: 'Ryoku Telemetry Sync',
        lines: [
          { timeMs: 0, text: 'Signal locked in obsidian space', romanized: '01 // INITIALIZING GLYPH MATRIX' },
          { timeMs: 4200, text: 'Forty-two ticks across the phosphor line' },
          { timeMs: 8500, text: 'Violet waves breathe beneath the glass' },
          { timeMs: 13000, text: 'Nothing between the sound and the pulse' },
          { timeMs: 17500, text: 'Every peak lights up in chalk white' },
          { timeMs: 22000, text: 'Standby fades into neon telemetry' },
          { timeMs: 26800, text: 'Looping endlessly through Ryotunes core' },
        ],
      },
    },
    {
      id: 'DEMO:2',
      title: 'Dot Matrix Nocturne',
      artist: 'Ndot 57 Ensemble',
      album: 'Glyph Sessions',
      duration: 36,
      src: synthesizeLoopWav([196.0, 246.94, 293.66, 369.99], 49, 104, 36),
      artwork: makeCoverSvgDataUrl('DOT MATRIX', 'GLYPH SESSIONS', '#110C1A', '#2F1548', '#C084FC'),
      format: 'WAV',
      source: 'demo',
      lyrics: {
        synced: true,
        source: 'Local LRC',
        lines: [
          { timeMs: 0, text: 'Twelve pixel grid in quiet violet glow' },
          { timeMs: 5500, text: 'Registration brackets hold the midnight frame' },
          { timeMs: 11200, text: 'Subharmonic frequencies trace the curve' },
          { timeMs: 17400, text: 'Load your MP3 or FLAC from device storage' },
          { timeMs: 24000, text: 'Tap any line to jump across the scale' },
          { timeMs: 30000, text: 'Audio engine standing by for Android core' },
        ],
      },
    },
    {
      id: 'DEMO:3',
      title: 'Purple Horizon 075%',
      artist: 'Kurogane & Ryoku',
      album: 'Instrument Archive',
      duration: 28,
      src: synthesizeLoopWav([261.63, 311.13, 392.0, 466.16], 65.4, 126, 28),
      artwork: makeCoverSvgDataUrl('HORIZON', 'INSTRUMENT ARCHIVE', '#16111B', '#3D195E', '#E9D5FF'),
      format: 'WAV',
      source: 'demo',
      lyrics: {
        synced: false,
        source: 'Archive Notes',
        lines: [
          { text: 'Instrumental telemetry showcase track' },
          { text: '26x5 Cava LED Matrix + 38CH Full Glyph Spectrum' },
          { text: 'Adjust Bass, Width, Tempo or Reverb in Sound FX' },
        ],
      },
    },
  ];

  return cachedDemos;
}
