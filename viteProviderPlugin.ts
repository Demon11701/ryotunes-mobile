import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const YT_IOS_UA =
  'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_2_1 like Mac OS X;)';

let cachedScClientId = '';
let cachedScClientAt = 0;

interface DevSearchItem {
  id: string;
  provider: 'youtube' | 'spotify' | 'soundcloud' | 'tidal';
  remoteId: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artwork?: string;
  format: string;
}

function parseDurationSec(text?: string): number {
  if (!text) return 0;
  const parts = text.trim().split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

async function getSoundCloudClientId(): Promise<string> {
  if (cachedScClientId && Date.now() - cachedScClientAt < 1000 * 60 * 60) {
    return cachedScClientId;
  }
  const html = await (
    await fetch('https://soundcloud.com', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    })
  ).text();
  const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(
    (m) => m[1]
  );
  const settled = await Promise.allSettled(
    scripts.slice(-6).reverse().map(async (s) => {
      const js = await (await fetch(s, { signal: AbortSignal.timeout(7000) })).text();
      const match = js.match(/client_id\s*:\s*"([a-zA-Z0-9]{20,40})"/);
      return match ? match[1] : '';
    })
  );
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) {
      cachedScClientId = r.value;
      cachedScClientAt = Date.now();
      return cachedScClientId;
    }
  }
  return '';
}

async function searchYoutubeMusic(query: string): Promise<DevSearchItem[]> {
  const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({
      context: {
        client: { clientName: 'WEB_REMIX', clientVersion: '1.20241104.01.00', hl: 'en', gl: 'US' },
      },
      query,
      params: 'EgWKAQIIAWoMEAMQBBAJEAoQBRAV',
    }),
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as Record<string, unknown>;
  const tabs =
    (data?.contents as { tabbedSearchResultsRenderer?: { tabs?: Array<{ tabRenderer?: { content?: { sectionListRenderer?: { contents?: unknown[] } } } }> } })
      ?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

  const items: DevSearchItem[] = [];
  for (const sec of tabs as Array<{ musicShelfRenderer?: { contents?: unknown[] } }>) {
    const rows = sec?.musicShelfRenderer?.contents || [];
    for (const row of rows as Array<{ musicResponsiveListItemRenderer?: Record<string, unknown> }>) {
      const r = row?.musicResponsiveListItemRenderer;
      if (!r) continue;
      const vid =
        (r.playlistItemData as { videoId?: string } | undefined)?.videoId ||
        (
          (r.overlay as { musicItemThumbnailOverlayRenderer?: { content?: { musicPlayButtonRenderer?: { playNavigationEndpoint?: { watchEndpoint?: { videoId?: string } } } } } } | undefined)
            ?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
        );
      if (!vid) continue;
      const cols = (r.flexColumns as Array<{ musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: Array<{ text?: string }> } } }>) || [];
      const titleRuns = cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const metaRuns = cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const title = titleRuns.map((x) => x.text || '').join('').trim();
      if (!title) continue;

      const cleanMeta = metaRuns
        .map((x) => (x.text || '').trim())
        .filter((t) => t && t !== '•' && t !== '·' && t !== ',' && t !== '&');
      const artist = cleanMeta[0] || 'YouTube Music';
      const last = cleanMeta[cleanMeta.length - 1] || '';
      const dur = /^\d+:\d{2}(:\d{2})?$/.test(last) ? parseDurationSec(last) : 0;
      const album = cleanMeta.length >= 3 ? cleanMeta[cleanMeta.length - 2] : 'YouTube Music';

      const thumbs =
        (r.thumbnail as { musicThumbnailRenderer?: { thumbnail?: { thumbnails?: Array<{ url?: string }> } } } | undefined)
          ?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      let rawThumb = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      if (/=w\d+-h\d+/.test(rawThumb)) rawThumb = rawThumb.replace(/=w\d+-h\d+[^&]*/, '=w512-h512-l90-rj');

      items.push({
        id: `yt:${vid}`,
        provider: 'youtube',
        remoteId: vid,
        title,
        artist,
        album,
        duration: dur,
        artwork: `/api/provider/proxy-image?url=${encodeURIComponent(rawThumb)}`,
        format: 'YTM AAC',
      });
      if (items.length >= 16) return items;
    }
  }
  return items;
}

async function searchSoundCloud(query: string): Promise<DevSearchItem[]> {
  const clientId = await getSoundCloudClientId();
  if (!clientId) return [];
  const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${encodeURIComponent(clientId)}&limit=14`;
  const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    collection?: Array<{
      id: number;
      title?: string;
      duration?: number;
      artwork_url?: string;
      user?: { username?: string; avatar_url?: string };
      genre?: string;
    }>;
  };
  return (data.collection || [])
    .filter((t) => t.id && t.title)
    .map((t) => {
      const artRaw = (t.artwork_url || t.user?.avatar_url || '').replace('-large.', '-t500x500.');
      return {
        id: `sc:${t.id}`,
        provider: 'soundcloud' as const,
        remoteId: String(t.id),
        title: t.title || 'SoundCloud Track',
        artist: t.user?.username || 'SoundCloud Artist',
        album: t.genre || 'SoundCloud',
        duration: Math.round((t.duration || 0) / 1000),
        artwork: artRaw ? `/api/provider/proxy-image?url=${encodeURIComponent(artRaw)}` : undefined,
        format: 'SOUNDCLOUD',
      };
    });
}

async function searchCatalogProvider(
  query: string,
  provider: 'spotify' | 'tidal'
): Promise<DevSearchItem[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=14`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      trackId: number;
      trackName?: string;
      artistName?: string;
      collectionName?: string;
      trackTimeMillis?: number;
      artworkUrl100?: string;
    }>;
  };
  return (data.results || [])
    .filter((r) => r.trackId && r.trackName)
    .map((r) => {
      const artRaw = (r.artworkUrl100 || '').replace('100x100bb', '600x600bb');
      return {
        id: `${provider}:track:${r.trackId}`,
        provider,
        remoteId: String(r.trackId),
        title: r.trackName || 'Untitled',
        artist: r.artistName || 'Unknown Artist',
        album: r.collectionName || (provider === 'spotify' ? 'Spotify Catalog' : 'TIDAL Masters'),
        duration: Math.round((r.trackTimeMillis || 0) / 1000),
        artwork: artRaw ? `/api/provider/proxy-image?url=${encodeURIComponent(artRaw)}` : undefined,
        format: provider === 'spotify' ? 'SPOTIFY' : 'TIDAL FLAC',
      };
    });
}

async function resolveYoutubeAudioStream(videoId: string, quality: string) {
  const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': YT_IOS_UA },
    body: JSON.stringify({
      context: {
        client: { clientName: 'IOS', clientVersion: '20.10.4', deviceModel: 'iPhone16,2', hl: 'en', gl: 'US' },
      },
      videoId,
    }),
    signal: AbortSignal.timeout(7000),
  });
  if (!r.ok) throw new Error(`YouTube HTTP ${r.status}`);
  const j = (await r.json()) as {
    streamingData?: {
      adaptiveFormats?: Array<{ mimeType?: string; url?: string; bitrate?: number; approxDurationMs?: string }>;
    };
    videoDetails?: { lengthSeconds?: string };
  };
  const fmts = (j?.streamingData?.adaptiveFormats || []).filter(
    (f) => f.url && (f.mimeType || '').startsWith('audio/mp4')
  );
  const allAudio =
    fmts.length > 0
      ? fmts
      : (j?.streamingData?.adaptiveFormats || []).filter(
          (f) => f.url && (f.mimeType || '').startsWith('audio/')
        );
  if (allAudio.length === 0 || !allAudio[0].url) {
    throw new Error('No playable audio stream found');
  }
  allAudio.sort((a, b) => (quality === 'LOW' ? (a.bitrate || 0) - (b.bitrate || 0) : (b.bitrate || 0) - (a.bitrate || 0)));
  const pick = allAudio[0];
  return {
    streamUrl: pick.url!,
    mimeType: (pick.mimeType || 'audio/mp4').split(';')[0],
    duration: Number(j?.videoDetails?.lengthSeconds || 0) || Math.round(Number(pick.approxDurationMs || 0) / 1000),
  };
}

function resampleWaveform(samples: number[]): number[] {
  if (!samples.length) return [];
  const out: number[] = [];
  const count = 240;
  for (let i = 0; i < count; i++) {
    const idx = Math.floor((i * samples.length) / count);
    out.push(Math.max(4, Math.min(100, Math.round(samples[idx] || 0))));
  }
  return out;
}

async function resolveSoundCloudStream(scId: string) {
  const clientId = await getSoundCloudClientId();
  if (!clientId) throw new Error('SoundCloud client_id unavailable');
  const trackRes = await fetch(
    `https://api-v2.soundcloud.com/tracks/${encodeURIComponent(scId)}?client_id=${encodeURIComponent(clientId)}`,
    { signal: AbortSignal.timeout(7000) }
  );
  if (!trackRes.ok) throw new Error(`SoundCloud HTTP ${trackRes.status}`);
  const track = (await trackRes.json()) as {
    title?: string;
    user?: { username?: string };
    duration?: number;
    waveform_url?: string;
    media?: {
      transcodings?: Array<{
        url: string;
        format?: { protocol?: string; mime_type?: string };
      }>;
    };
  };

  let waveform: number[] = [];
  if (track.waveform_url) {
    try {
      const wf = (await (await fetch(track.waveform_url, { signal: AbortSignal.timeout(4000) })).json()) as {
        samples?: number[];
      };
      if (wf.samples?.length) waveform = resampleWaveform(wf.samples);
    } catch {
      // optional
    }
  }

  const transcodings = track.media?.transcodings || [];
  const prog = transcodings.find((t) => t.format?.protocol === 'progressive');
  if (prog?.url) {
    const uJson = (await (
      await fetch(`${prog.url}?client_id=${encodeURIComponent(clientId)}`, {
        signal: AbortSignal.timeout(6000),
      })
    ).json()) as { url?: string };
    if (uJson.url) {
      return {
        streamUrl: uJson.url,
        mimeType: (prog.format?.mime_type || 'audio/mpeg').split(';')[0],
        duration: Math.round((track.duration || 0) / 1000),
        waveform,
      };
    }
  }

  // Fallback for HLS-only SoundCloud tracks: match canonical clean audio stream + preserve authentic SoundCloud waveform
  const searchQuery = `${track.user?.username || ''} ${track.title || ''}`.trim();
  if (searchQuery) {
    const ytMatches = await searchYoutubeMusic(searchQuery);
    if (ytMatches[0]) {
      const resolved = await resolveYoutubeAudioStream(ytMatches[0].remoteId, 'HIGH');
      return { ...resolved, waveform };
    }
  }
  throw new Error('SoundCloud stream requires progressive fallback');
}

export function ryotunesProviderDevPlugin(): Plugin {
  return {
    name: 'ryotunes-provider-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const rawUrl = req.url || '';
        if (!rawUrl.startsWith('/api/provider/')) return next();

        const u = new URL(rawUrl, 'http://localhost');
        try {
          if (u.pathname === '/api/provider/search') {
            const q = (u.searchParams.get('q') || '').trim();
            const provider = (u.searchParams.get('provider') || 'all').toLowerCase();
            if (!q) return sendJson(res, 200, { items: [] });

            let items: DevSearchItem[] = [];
            if (provider === 'youtube') items = await searchYoutubeMusic(q);
            else if (provider === 'soundcloud') items = await searchSoundCloud(q);
            else if (provider === 'spotify') items = await searchCatalogProvider(q, 'spotify');
            else if (provider === 'tidal') items = await searchCatalogProvider(q, 'tidal');
            else {
              const settled = await Promise.allSettled([
                searchYoutubeMusic(q),
                searchCatalogProvider(q, 'spotify'),
                searchSoundCloud(q),
                searchCatalogProvider(q, 'tidal'),
              ]);
              const lists = settled.map((s) => (s.status === 'fulfilled' ? s.value : []));
              const maxLen = Math.max(...lists.map((l) => l.length), 0);
              for (let i = 0; i < maxLen; i++) {
                for (const l of lists) {
                  if (l[i]) items.push(l[i]);
                }
              }
            }
            return sendJson(res, 200, { items: items.slice(0, 32) });
          }

          if (u.pathname === '/api/provider/stream') {
            const id = u.searchParams.get('id') || '';
            const title = u.searchParams.get('title') || '';
            const artist = u.searchParams.get('artist') || '';
            const quality = (u.searchParams.get('quality') || 'HIGH').toUpperCase();

            let result: { streamUrl: string; mimeType: string; duration: number; waveform?: number[] };
            if (id.startsWith('yt:')) {
              result = await resolveYoutubeAudioStream(id.slice(3), quality);
            } else if (id.startsWith('sc:')) {
              result = await resolveSoundCloudStream(id.slice(3));
            } else {
              const q = `${artist} ${title}`.trim();
              const matches = await searchYoutubeMusic(q);
              if (!matches[0]) throw new Error('No matching audio stream found for this track');
              result = await resolveYoutubeAudioStream(matches[0].remoteId, quality);
            }

            return sendJson(res, 200, {
              ...result,
              proxyUrl: `/api/provider/proxy-audio?url=${encodeURIComponent(result.streamUrl)}&mime=${encodeURIComponent(result.mimeType)}`,
            });
          }

          if (u.pathname === '/api/provider/proxy-audio') {
            const target = u.searchParams.get('url');
            if (!target) return sendJson(res, 400, { error: 'Missing url' });
            const headers: Record<string, string> = { 'User-Agent': YT_IOS_UA };
            if (req.headers.range) headers.Range = String(req.headers.range);

            const upstream = await fetch(target, { headers, signal: AbortSignal.timeout(25000) });
            res.statusCode = upstream.status;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', upstream.headers.get('content-type') || u.searchParams.get('mime') || 'audio/mp4');
            res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
            const cl = upstream.headers.get('content-length');
            if (cl) res.setHeader('Content-Length', cl);
            const cr = upstream.headers.get('content-range');
            if (cr) res.setHeader('Content-Range', cr);

            const arr = await upstream.arrayBuffer();
            res.end(Buffer.from(arr));
            return;
          }

          if (u.pathname === '/api/provider/proxy-image') {
            const target = u.searchParams.get('url');
            if (!target) return sendJson(res, 400, { error: 'Missing url' });
            const upstream = await fetch(target, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(10000),
            });
            res.statusCode = upstream.status;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
            const buf = await upstream.arrayBuffer();
            res.end(Buffer.from(buf));
            return;
          }

          sendJson(res, 404, { error: 'Unknown provider endpoint' });
        } catch (err) {
          sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
