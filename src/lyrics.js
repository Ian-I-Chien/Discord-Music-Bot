const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const cache = new Map();
const clean = value => String(value || '').replace(/official\s*(music|lyric)?\s*(video|audio|mv)?|music video|lyrics? video|官方|完整版|歌詞版|中字/gi, '').replace(/\s+/g, ' ').trim();

export function parseLrc(input) {
  if (typeof input !== 'string' || input.length > 200000) return [];
  const lines = []; let offset = 0;
  const declared = input.match(/\[offset:([+-]?\d+)\]/i);
  if (declared) offset = Number(declared[1]) / 1000;
  for (const line of input.split(/\r?\n/)) {
    const text = line.replace(/\[[^\]]*\]/g, '').trim().slice(0, 180);
    if (!text) continue;
    for (const stamp of line.matchAll(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g)) {
      const seconds = Number(stamp[2]);
      if (seconds < 60) lines.push({ time: Math.max(0, Number(stamp[1]) * 60 + seconds - offset), text });
      if (lines.length >= 3000) break;
    }
    if (lines.length >= 3000) break;
  }
  return lines.sort((a, b) => a.time - b.time).filter((line, index, all) => !index || line.time !== all[index - 1].time || line.text !== all[index - 1].text);
}

export function lyricWindow(lines, elapsed) {
  if (!lines?.length || !Number.isFinite(elapsed)) return null;
  let index = -1;
  for (let n = 0; n < lines.length && lines[n].time <= elapsed; n++) index = n;
  if (index < 0) return null;
  return { previous: lines[index - 1]?.text, current: lines[index].text, next: lines[index + 1]?.text };
}

export function selectLyrics(records, track) {
  if (!Array.isArray(records)) return null;
  const title = normalize(track.spotify?.title || track.title);
  const artist = normalize(track.spotify?.artists?.join(' ') || track.author);
  const context = normalize(`${track.title || ''} ${track.author || ''}`);
  const versions = value => ['live', 'remix', 'acoustic', 'karaoke', 'spedup', '現場', '翻唱', '伴奏'].filter(word => normalize(value).includes(word)).join(',');
  let best = null;
  for (const record of records.slice(0, 100)) {
    const candidate = normalize(record.trackName), performer = normalize(record.artistName);
    if (!candidate || !performer || !Number.isFinite(record.duration) || !Number.isFinite(track.duration)) continue;
    if (!(title === candidate || candidate.length >= 2 && title.includes(candidate))) continue;
    if (!(artist.includes(performer) || performer.includes(artist) && artist.length >= 2 || context.includes(performer))) continue;
    if (versions(track.title) !== versions(record.trackName)) continue;
    const difference = Math.abs(record.duration - track.duration);
    if (difference > 5 || record.instrumental) continue;
    const lines = parseLrc(record.syncedLyrics);
    if (!lines.length || lines.at(-1).time > track.duration + 5) continue;
    const score = (title === candidate ? 100 : 0) - difference;
    if (!best || score > best.score) best = { score, lines };
  }
  return best?.lines || null;
}

export async function findLyrics(track, { signal, fetchImpl = fetch, now = Date.now } = {}) {
  const bracket = track.title?.match(/[【《〈]([^】》〉]+)[】》〉]/)?.[1];
  const title = clean(track.spotify?.title || bracket || String(track.title || '').replace(new RegExp('^' + String(track.author || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—:]?\\s*', 'i'), '').split(/\s[-–—]\s/).at(-1));
  const artist = clean(track.spotify?.artists?.join(' ') || track.author);
  if (!title || !artist || !(track.duration > 0)) return null;
  const key = `${title}|${artist}|${Math.round(track.duration)}`;
  signal?.throwIfAborted();
  const cached = cache.get(key);
  if (cached && cached.expiry > now()) return cached.lines;
  const url = new URL('https://lrclib.net/api/search');
  url.searchParams.set('q', (track.spotify ? `${artist} ${title}` : title).slice(0, 400));
  const response = await fetchImpl(url, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(6000)]), redirect: 'error', headers: { 'User-Agent': '1an-Discord-Music-Bot/1.0 (https://github.com/Ian-I-Chien/Discord-Music-Bot)' } });
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2000000) throw new Error('Lyrics response too large');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  signal?.throwIfAborted();
  const lines = selectLyrics(JSON.parse(Buffer.concat(chunks).toString('utf8')), track);
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  cache.set(key, { lines, expiry: now() + (lines ? 21600000 : 600000) });
  return lines;
}

export function cancelLyrics(session) {
  session.lyricsRequest?.controller.abort();
  session.lyricsRequest = null; session.lyrics = null;
}
export function startLyrics(session, { lookup = findLyrics, update = () => {} } = {}) {
  if (session.closed || !session.current || session.lyricsRequest?.track === session.current) return;
  cancelLyrics(session);
  const request = { track: session.current, controller: new AbortController() };
  session.lyricsRequest = request;
  request.task = Promise.resolve().then(() => lookup(request.track, { signal: request.controller.signal })).then(lines => {
    if (session.closed || session.lyricsRequest !== request || request.controller.signal.aborted) return;
    session.lyrics = lines;
    return update();
  }).catch(() => {}); // Missing lyrics must never interrupt music or post notices.
  return request.task;
}
