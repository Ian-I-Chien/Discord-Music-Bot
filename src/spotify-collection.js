import { spotifyUrl } from './spotify.js';
import { createSpotifyTokenProvider } from './spotify-auth.js';

export function spotifyQueueItem(track) {
  if (!track || track.is_local || (track.type && track.type !== 'track') || !/^[a-zA-Z0-9]{22}$/.test(track.id || '') || !track.name || !(track.duration_ms > 0)) return null;
  const artists = track.artists?.map(artist => artist.name).filter(Boolean);
  if (!artists?.length) return null;
  const page = `https://open.spotify.com/track/${track.id}`;
  const metadata = { page, title: track.name, artists, duration: track.duration_ms / 1000 };
  return { query: page, page, title: track.name, author: artists.join(', '), duration: metadata.duration, spotify: metadata };
}

export function createSpotifyCollectionReader({ fetchImpl = fetch, token = createSpotifyTokenProvider() } = {}) {
  async function get(url, signal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const access = await token({ force: attempt === 1, signal });
      signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(15000);
      const response = await fetchImpl(url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { Authorization: `Bearer ${access}` } });
      if (response.status === 401 && attempt === 0) { await response.body?.cancel(); continue; }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 403) throw new Error('Spotify 無法讀取這份歌單，請確認連結帳號是歌單擁有者或共同編輯者。');
        if (response.status === 429) throw new Error('Spotify 暫時繁忙，請稍後再試。');
        throw new Error('Spotify 暫時無法讀取這份清單，請稍後再試。');
      }
      return response.json();
    }
  }
  return async function* streamSpotifyCollection(input, limit = 300, { signal } = {}) {
    const page = spotifyUrl(input);
    const match = page?.match(/^https:\/\/open\.spotify\.com\/(playlist|album)\/([a-zA-Z0-9]{22})$/);
    if (!match || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('Spotify 清單或載入數量無效。');
    const [kind, id] = match.slice(1);
    const path = `/v1/${kind === 'playlist' ? 'playlists' : 'albums'}/${id}/${kind === 'playlist' ? 'items' : 'tracks'}`;
    let next = `https://api.spotify.com${path}?limit=50&offset=0`; let count = 0;
    const visited = new Set();
    // Pagination URLs are untrusted: never send a bearer token off this endpoint.
    while (next && count < limit) {
      signal?.throwIfAborted();
      const url = new URL(next);
      if (url.origin !== 'https://api.spotify.com' || url.username || url.password || url.pathname !== path || visited.has(url.href)) throw new Error('Spotify 清單分頁資料無效。');
      visited.add(url.href);
      if (visited.size > 200) throw new Error('Spotify 清單分頁過多。');
      const data = await get(url.href, signal);
      if (!Array.isArray(data.items)) throw new Error('Spotify 清單資料無效。');
      for (const row of data.items) {
        signal?.throwIfAborted();
        const item = spotifyQueueItem(kind === 'playlist' ? (row?.item ?? row?.track) : row);
        if (!item) continue;
        yield item;
        if (++count >= limit) return;
      }
      next = data.next;
    }
  };
}
export const streamSpotifyCollection = createSpotifyCollectionReader();
