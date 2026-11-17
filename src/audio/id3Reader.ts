import { Track } from './types';

function decodeSynchsafe(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 & 0x7f) << 21) | ((b1 & 0x7f) << 14) | ((b2 & 0x7f) << 7) | (b3 & 0x7f);
}

function decodeUint32BE(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

function decodeTextFrame(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const enc = bytes[0];
  const payload = bytes.slice(1);
  let decoderName = 'iso-8859-1';
  if (enc === 1 || enc === 2) decoderName = 'utf-16';
  else if (enc === 3) decoderName = 'utf-8';
  try {
    return new TextDecoder(decoderName).decode(payload).replace(/\0+$/g, '').trim();
  } catch {
    return new TextDecoder('utf-8').decode(payload).replace(/\0+$/g, '').trim();
  }
}

function decodeApicFrame(bytes: Uint8Array): string | undefined {
  if (bytes.length < 4) return undefined;
  const enc = bytes[0];
  let idx = 1;
  while (idx < bytes.length && bytes[idx] !== 0) idx++;
  const mime = new TextDecoder('ascii').decode(bytes.slice(1, idx)) || 'image/jpeg';
  idx++; // skip null
  if (idx >= bytes.length) return undefined;
  idx++; // skip picture type
  if (enc === 1 || enc === 2) {
    while (idx + 1 < bytes.length && !(bytes[idx] === 0 && bytes[idx + 1] === 0)) idx += 2;
    idx += 2;
  } else {
    while (idx < bytes.length && bytes[idx] !== 0) idx++;
    idx++;
  }
  if (idx >= bytes.length) return undefined;
  const imgData = bytes.slice(idx);
  const blob = new Blob([imgData], { type: mime });
  return URL.createObjectURL(blob);
}

function stripExt(name: string): { title: string; artist: string; ext: string } {
  const match = name.match(/^(.*)\.([a-zA-Z0-9]+)$/);
  const base = match ? match[1] : name;
  const ext = match ? match[2].toUpperCase() : 'AUDIO';
  const parts = base.split(' - ');
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), ext };
  }
  return { title: base.trim(), artist: 'Local File', ext };
}

async function probeDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    const done = (d: number) => {
      audio.src = '';
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    audio.src = src;
  });
}

export async function parseAudioFile(file: File): Promise<Track> {
  const src = URL.createObjectURL(file);
  const fallback = stripExt(file.name);
  let title = fallback.title;
  let artist = fallback.artist;
  let album = 'Local Device';
  let artwork: string | undefined;

  try {
    const headerBuf = await file.slice(0, 512 * 1024).arrayBuffer();
    const bytes = new Uint8Array(headerBuf);
    if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      const major = bytes[3];
      const tagSize = decodeSynchsafe(bytes[6], bytes[7], bytes[8], bytes[9]);
      let offset = 10;
      const limit = Math.min(bytes.length, 10 + tagSize);

      while (offset + 10 <= limit) {
        const frameId = String.fromCharCode(
          bytes[offset],
          bytes[offset + 1],
          bytes[offset + 2],
          bytes[offset + 3]
        );
        if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
        const size =
          major === 4
            ? decodeSynchsafe(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
            : decodeUint32BE(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        offset += 10;
        if (size <= 0 || offset + size > bytes.length) break;
        const data = bytes.slice(offset, offset + size);
        if (frameId === 'TIT2') title = decodeTextFrame(data) || title;
        else if (frameId === 'TPE1') artist = decodeTextFrame(data) || artist;
        else if (frameId === 'TALB') album = decodeTextFrame(data) || album;
        else if (frameId === 'APIC' && !artwork) artwork = decodeApicFrame(data);
        offset += size;
      }
    }
  } catch {
    // Fallback to filename metadata
  }

  const duration = await probeDuration(src);
  return {
    id: `LOCAL:${file.name}:${file.size}:${file.lastModified}`,
    title,
    artist,
    album,
    duration,
    src,
    artwork,
    format: fallback.ext,
    source: 'local',
    addedAt: Date.now(),
  };
}
