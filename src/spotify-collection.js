import { spotifyUrl, readSpotifyPage } from './spotify.js';

export function parseSpotifyCollection(html, input) {
  const page = spotifyUrl(input);
  const match = page?.match(/^https:\/\/open\.spotify\.com\/(playlist|album)\/([a-zA-Z0-9]{22})$/);
  if (!match) throw new Error('請提供 Spotify 歌單或專輯連結。');
  const raw = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  let entity;
  try { entity = JSON.parse(raw).props.pageProps.state.data.entity; } catch { throw new Error('暫時無法讀取這份清單，請稍後再試。'); }
  if (!entity || entity.type !== match[1] || entity.id !== match[2] || !Array.isArray(entity.trackList)) throw new Error('Spotify 清單資料無效。');
  const items = entity.trackList.flatMap(track => {
    if (!track || typeof track.uri !== 'string') return [];
    const id = track.uri.match(/^spotify:track:([a-zA-Z0-9]{22})$/)?.[1];
    const title = typeof track.title === 'string' ? track.title.trim() : '';
    const artists = typeof track.subtitle === 'string' ? track.subtitle.split(', ').map(name => name.trim()).filter(Boolean) : [];
    const duration = Number(track.duration) / 1000;
    if (!id || !title || title.length > 300 || !artists.length || artists.join(' ').length > 300 || !Number.isFinite(duration) || duration <= 0) return [];
    const trackPage = `https://open.spotify.com/track/${id}`;
    const metadata = { page: trackPage, title, artists, duration };
    return [{ query: trackPage, page: trackPage, title, author: artists.join(', '), duration, spotify: metadata, spotifyCollectionPage: page }];
  });
  if (!items.length) throw new Error('這份清單目前沒有可讀取的歌曲。');
  return { title: entity.title || entity.name || 'Spotify', page, items, visible: entity.trackList.length };
}

export function publicCollectionTotal(html, input) {
  const page = spotifyUrl(input);
  const [, kind, id] = new URL(page).pathname.split('/');
  const raw = html.match(/<script\b[^>]*\bid=["']initialState["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  try {
    const state = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const entity = state.entities.items[`spotify:${kind}:${id}`];
    const total = kind === 'playlist' ? entity.content.totalCount : entity.tracksV2.totalCount;
    return Number.isInteger(total) && total >= 0 ? total : undefined;
  } catch { return undefined; }
}

export function createSpotifyCollectionReader({ fetchImpl = fetch } = {}) {
  return async function* streamSpotifyCollection(input, limit = 300, { signal, onInfo = () => {}, readTotal = true } = {}) {
    const page = spotifyUrl(input);
    if (!/^https:\/\/open\.spotify\.com\/(playlist|album)\/[a-zA-Z0-9]{22}$/.test(page || '') || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('Spotify 清單或載入數量無效。');
    const document = await readSpotifyPage(page, { fetchImpl, signal, embed: true });
    const collection = parseSpotifyCollection(document.html, page);
    onInfo({ title: collection.title, page, visible: collection.visible });
    let count = 0;
    for (const item of collection.items) {
      signal?.throwIfAborted();
      yield item;
      if (++count >= limit) break;
    }
    // Check total size after yielding entries; this does not unlock hidden tracks.
    if (readTotal && !signal?.aborted) {
      try {
        const source = await readSpotifyPage(page, { fetchImpl, signal });
        const total = publicCollectionTotal(source.html, page);
        if (total !== undefined) onInfo({ title: collection.title, page, visible: collection.visible, total });
      } catch (error) { if (signal?.aborted) throw error; }
    }
  };
}
export const streamSpotifyCollection = createSpotifyCollectionReader();
