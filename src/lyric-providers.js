function url(base, params) {
  const value = new URL(base);
  for (const [key, item] of Object.entries(params)) value.searchParams.set(key, item);
  return value;
}

// Only fetch lyrics for candidates whose public metadata already matches.
function compatible(record, track, select) {
  return Boolean(select([{ ...record, syncedLyrics: '[00:00]candidate' }], track));
}

export async function neteaseLyrics(track, title, artist, { getJson, select }) {
  const data = await getJson(url('https://music.163.com/api/search/get/web', { s: `${artist} ${title}`, type: 1, offset: 0, limit: 10 }));
  const songs = data?.code === 200 && Array.isArray(data.result?.songs) ? data.result.songs : [];
  let attempts = 0;
  for (const song of songs.slice(0, 10)) {
    if (!Number.isSafeInteger(song.id) || song.id <= 0) continue;
    const record = { trackName: song.name, artistName: song.artists?.map(item => item.name).join(' '), duration: song.duration / 1000 };
    if (!compatible(record, track, select)) continue;
    if (++attempts > 2) break;
    const result = await getJson(url('https://music.163.com/api/song/lyric', { id: song.id, lv: -1, kv: -1, tv: -1 }));
    const lines = select([{ ...record, syncedLyrics: result?.lrc?.lyric }], track);
    if (lines) return Object.assign(lines, { source: '網易雲' });
  }
  return null;
}

export async function kugouLyrics(track, title, artist, { getJson, select }) {
  const data = await getJson(url('https://lyrics.kugou.com/search', { ver: 1, man: 'yes', client: 'pc', keyword: `${artist} - ${title}`, duration: Math.round(track.duration * 1000) }));
  const candidates = data?.status === 200 && Array.isArray(data.candidates) ? data.candidates : [];
  let attempts = 0;
  for (const item of candidates.slice(0, 10)) {
    if (!/^\d{1,20}$/.test(String(item.id)) || !/^[a-zA-Z0-9]{1,128}$/.test(item.accesskey || '')) continue;
    const record = { trackName: item.song, artistName: item.singer, duration: item.duration / 1000 };
    if (!compatible(record, track, select)) continue;
    if (++attempts > 2) break;
    const result = await getJson(url('https://lyrics.kugou.com/download', { ver: 1, client: 'pc', id: item.id, accesskey: item.accesskey, fmt: 'lrc', charset: 'utf8' }));
    const content = typeof result?.content === 'string' && result.content.length <= 270000 ? Buffer.from(result.content, 'base64').toString('utf8') : null;
    const lines = select([{ ...record, syncedLyrics: content }], track);
    if (lines) return Object.assign(lines, { source: '酷狗' });
  }
  return null;
}
