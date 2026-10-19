const chinese = /^(zh|cmn|yue)(-|$)/i;
export function captionUrl(input, videoId) {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.searchParams.has('tlang')) return null;
    if (!['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname) || url.pathname !== '/api/timedtext') return null;
    if (url.searchParams.get('v') !== videoId) return null;
    return url.href;
  } catch { return null; }
}
export function selectCaptionTracks(data) {
  let videoId;
  try { videoId = new URL(data.webpage_url).searchParams.get('v'); } catch { return []; }
  if (!/^[\w-]{11}$/.test(videoId || '')) return [];
  const choices = [];
  for (const [kind, entries] of [['manual', data.subtitles], ['auto', data.automatic_captions]]) {
    if (!entries || typeof entries !== 'object') continue;
    for (const [language, formats] of Object.entries(entries).slice(0, 400)) {
      if (!chinese.test(language) && language !== data.language && !/^en(-|$)/i.test(language)) continue;
      if (!Array.isArray(formats)) continue;
      const format = ['json3', 'vtt'].map(ext => formats.find(item => item.ext === ext && captionUrl(item.url, videoId))).find(Boolean);
      if (!format) continue;
      const score = (chinese.test(language) ? 0 : 20) + (kind === 'auto' ? 10 : 0) + (/^zh-(Hant|TW)/i.test(language) ? 0 : 1);
      choices.push({ url: format.url, ext: format.ext, language, kind, videoId, score });
    }
  }
  return choices.sort((a, b) => a.score - b.score).slice(0, 2);
}

function text(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" })[entity]).replace(/[♪♫]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
}
export function parseCaptions(body, ext, duration) {
  if (typeof body !== 'string' || body.length > 2000000) return [];
  const rows = [];
  if (ext === 'json3') {
    const data = JSON.parse(body);
    for (const event of (Array.isArray(data.events) ? data.events : []).slice(0, 6000)) {
      const content = text(event.segs?.map(segment => segment.utf8 || '').join(''));
      if (content && Number.isFinite(event.tStartMs)) rows.push({ time: event.tStartMs / 1000, text: content });
    }
  } else if (ext === 'vtt') {
    for (const block of body.replace(/\r/g, '').split(/\n\s*\n/).slice(0, 6000)) {
      const lines = block.split('\n'); const index = lines.findIndex(line => line.includes('-->'));
      if (index < 0) continue;
      const stamp = lines[index].match(/^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})\s+-->/);
      if (!stamp) continue;
      const content = text(lines.slice(index + 1).join(' '));
      if (content) rows.push({ time: Number(stamp[1] || 0) * 3600 + Number(stamp[2]) * 60 + Number(stamp[3]) + Number(stamp[4]) / 1000, text: content });
    }
  }
  const result = [];
  for (const row of rows.sort((a, b) => a.time - b.time)) {
    if (row.time < 0 || row.time > duration + 5 || /^\[(?:music|applause|音樂|掌聲)\]$/i.test(row.text)) continue;
    const previous = result.at(-1);
    if (previous?.text === row.text) continue;
    // Auto captions progressively expand the same sentence. Keep its first time.
    if (previous && row.time - previous.time < 3 && row.text.startsWith(previous.text)) previous.text = row.text;
    else result.push(row);
    if (result.length >= 3000) break;
  }
  return result;
}

export async function youtubeLyrics(track, { signal, fetchImpl = fetch } = {}) {
  let videoId;
  try { videoId = new URL(track.page).searchParams.get('v'); } catch { return null; }
  if (!/^[\w-]{11}$/.test(videoId || '')) return null;
  for (const caption of (track.captionTracks || []).slice(0, 2)) {
    signal?.throwIfAborted();
    const url = captionUrl(caption.url, videoId);
    if (!url || !['json3', 'vtt'].includes(caption.ext)) continue;
    try {
      const response = await fetchImpl(url, { signal, redirect: 'error' });
      if (!response.ok || !response.body) continue;
      const reader = response.body.getReader(); let size = 0; const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 2000000) throw new Error('Captions too large');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      signal?.throwIfAborted();
      const rows = parseCaptions(Buffer.concat(chunks).toString('utf8'), caption.ext, track.duration);
      if (rows.length) return Object.assign(rows, { source: 'YouTube', automatic: caption.kind === 'auto' });
    } catch { signal?.throwIfAborted(); }
  }
  return null;
}
