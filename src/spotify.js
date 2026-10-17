import { searchCandidates, resolveTrack } from './source.js';

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
  if (match[1] !== 'track') throw new Error('目前先支援 Spotify 單曲；歌單與專輯尚未支援。');
  return `https://open.spotify.com/track/${match[2]}`;
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

export async function readSpotifyTrack(input, { fetchImpl = fetch, signal } = {}) {
  let page = spotifyUrl(input);
  if (!page) throw new Error('請提供 Spotify 單曲連結。');
  const timeout = AbortSignal.timeout(12000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetchImpl(page, { redirect: 'manual', signal: requestSignal, headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      const next = location && spotifyUrl(new URL(location, page).href);
      if (!next) throw new Error('Spotify 分享連結導向不支援的網址。');
      page = next; continue;
    }
    if (!response.ok || !page.startsWith('https://open.spotify.com/track/')) {
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
    return parseSpotifyMetadata(Buffer.concat(chunks).toString('utf8'), page);
  }
  throw new Error('Spotify 分享連結重新導向過多。');
}

const normalized = text => String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const compact = text => normalized(text).replaceAll(' ', '');
const variants = [/\bcover\b|翻唱/i, /\blive\b|現場|演唱會/i, /\bremix\b/i, /\bsped\s*up\b|\bnightcore\b|加速/i, /\bslowed\b|慢速/i, /\bkaraoke\b|伴奏/i];
export function matchSpotifyTrack(track, candidates) {
  const requested = `${track.title} ${track.artists.join(' ')}`;
  const title = normalized(track.title); const words = title.split(' ').filter(Boolean);
  const ranked = candidates.flatMap(candidate => {
    if (!/^[\w-]{11}$/.test(candidate.id) || candidate.is_live) return [];
    const text = `${candidate.title || ''} ${candidate.uploader || candidate.channel || ''}`;
    if (variants.some(pattern => pattern.test(text) && !pattern.test(requested))) return [];
    const candidateTitle = normalized(candidate.title);
    const titleMatch = compact(candidate.title).includes(compact(track.title));
    const coverage = words.filter(word => candidateTitle.includes(word)).length / words.length;
    const artistMatch = track.artists.some(artist => compact(text).includes(compact(artist)));
    const distance = Math.abs(Number(candidate.duration) - track.duration);
    // Reject uncertain matches instead of silently taking the first search hit.
    if ((!titleMatch && coverage < 0.8) || !artistMatch || !Number.isFinite(distance) || distance > Math.min(15, Math.max(8, track.duration * 0.04))) return [];
    return [{ candidate, score: (titleMatch ? 50 : coverage * 40) + 30 - distance + (/official audio|官方音源|\btopic\b/i.test(text) ? 8 : /official|官方/i.test(text) ? 4 : 0) }];
  }).sort((a, b) => b.score - a.score);
  if (!ranked.length) throw new Error('找不到可靠的 YouTube 對應版本，請改貼 YouTube 連結。');
  return ranked[0].candidate;
}

export async function resolveSpotifyTrack(metadata, { signal, search = searchCandidates, resolve = resolveTrack } = {}) {
  const candidates = await search(`${metadata.artists.join(' ')} ${metadata.title} official audio`, { signal });
  const match = matchSpotifyTrack(metadata, candidates);
  const track = await resolve(`https://www.youtube.com/watch?v=${match.id}`, { signal });
  return { ...track, spotify: metadata };
}
