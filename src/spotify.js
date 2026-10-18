import { resolveTrack } from './source.js';

export function spotifyUrl(input) {
  let url;
  try { url = new URL(input.trim()); } catch { return null; }
  if (!['open.spotify.com', 'spotify.link'].includes(url.hostname.toLowerCase())) return null;
  if (url.protocol !== 'https:' || url.port || url.username || url.password) throw new Error('請使用有效的 HTTPS Spotify 連結。');
  if (url.hostname === 'spotify.link') {
    if (!/^\/[\w-]{1,100}$/.test(url.pathname)) throw new Error('Spotify 分享連結無效。');
    return `https://spotify.link${url.pathname}`;
  }
  const match = url.pathname.match(/^\/(?:intl-[\w-]+\/)?(track|album|playlist|artist|episode|show)\/([a-zA-Z0-9]{22})\/?$/);
  if (!match) throw new Error('Spotify 連結無效。');
  if (!['track', 'playlist', 'album'].includes(match[1])) throw new Error('請提供 Spotify 歌曲、歌單或專輯連結。');
  return `https://open.spotify.com/${match[1]}/${match[2]}`;
}

function decode(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, key) => {
    if (key[0] === '#') {
      const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[key.toLowerCase()];
  });
}
export function parseSpotifyMetadata(html, page) {
  const tags = new Map();
  for (const meta of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map([...meta[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1].toLowerCase(), decode(m[2] ?? m[3])]));
    const key = attrs.get('property') || attrs.get('name');
    if (key && attrs.has('content')) tags.set(key, [...(tags.get(key) || []), attrs.get('content')]);
  }
  const title = tags.get('og:title')?.[0]?.trim();
  const artists = tags.get('music:musician_description')?.map(s => s.trim()).filter(Boolean);
  const duration = Number(tags.get('music:duration')?.[0]);
  if (tags.get('og:type')?.[0] !== 'music.song' || !title || !artists?.length || title.length > 300 || artists.join(' ').length > 300 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('無法讀取 Spotify 歌曲資料；請改貼歌名或 YouTube 連結。');
  }
  return { title, artists, duration, page };
}

export async function readSpotifyPage(input, { fetchImpl = fetch, signal, embed = false } = {}) {
  let page = spotifyUrl(input);
  if (!page) throw new Error('請提供 Spotify 單曲連結。');
  const timeout = AbortSignal.timeout(12000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (let hop = 0; hop < 5; hop++) {
    const target = embed && page.startsWith('https://open.spotify.com/') ? page.replace('https://open.spotify.com/', 'https://open.spotify.com/embed/') : page;
    const response = await fetchImpl(target, { redirect: 'manual', signal: requestSignal, headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      const next = location && spotifyUrl(new URL(location, page).href);
      if (!next) throw new Error('Spotify 分享連結導向不支援的網址。');
      page = next; continue;
    }
    if (!response.ok || !/^https:\/\/open\.spotify\.com\/(track|playlist|album)\//.test(page)) {
      await response.body?.cancel();
      throw new Error('無法讀取 Spotify 歌曲，請確認連結公開且有效。');
    }
    if (!response.body) throw new Error('Spotify 未回傳歌曲資料。');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) throw new Error('Spotify 頁面資料過大。');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    return { html: Buffer.concat(chunks).toString('utf8'), page };
  }
  throw new Error('Spotify 分享連結重新導向過多。');
}

export async function readSpotifyTrack(input, options = {}) {
  const { html, page } = await readSpotifyPage(input, options);
  if (!page.includes('/track/')) throw new Error('請提供 Spotify 單曲連結。');
  return parseSpotifyMetadata(html, page);
}

export async function readSpotifyInput(input, options = {}) {
  let page = spotifyUrl(input); let document;
  if (!page) return null;
  if (page.startsWith('https://spotify.link/')) {
    document = await readSpotifyPage(page, options); page = document.page;
  }
  const [, kind, id] = new URL(page).pathname.split('/');
  if (kind === 'track') return { kind, page, metadata: document ? parseSpotifyMetadata(document.html, page) : await readSpotifyTrack(page, options) };
  return { kind, id, page };
}

export async function resolveSpotifyTrack(metadata, { signal, resolve = resolveTrack } = {}) {
  const query = `${metadata.artists.join(' ')} ${metadata.title} official audio`;
  // resolveTrack already uses ytsearch1: one search and source lookup, with no
  // separate candidate process, artist-name gate, duration gate or reranking.
  const track = await resolve(query, { signal });
  return { ...track, spotify: metadata };
}
