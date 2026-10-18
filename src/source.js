import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function searchCandidates(query, { signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.YTDLP_PATH || 'yt-dlp', ['--ignore-config', '--flat-playlist', '--no-warnings', '--js-runtimes', 'node', '--socket-timeout', '15', '--dump-single-json', '--', `ytsearch5:${query}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); error ? reject(error) : resolve(result); };
    const cancel = () => { child.kill('SIGKILL'); finish(signal.reason || new Error('搜尋已取消。')); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('YouTube 配歌搜尋逾時。')); }, 30000);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.on('data', chunk => { out += chunk; if (out.length > 2_000_000) { child.kill('SIGKILL'); finish(new Error('配歌搜尋回應過大。')); } });
    child.stderr.resume();
    child.once('error', () => finish(new Error('無法執行 yt-dlp。')));
    child.once('close', code => {
      if (settled) return;
      if (code !== 0) return finish(new Error('YouTube 配歌搜尋失敗。'));
      try { finish(null, JSON.parse(out).entries || []); } catch { finish(new Error('無法解析配歌搜尋結果。')); }
    });
  });
}

// --lazy-playlist avoids collecting the entire list before emitting entries.
export async function* streamPlaylist(input, limit = 300, { signal, spawnProcess = spawn } = {}) {
  const url = playlistUrl(input);
  if (!url) throw new Error('請提供 YouTube 歌單網址。');
  signal?.throwIfAborted();
  const child = spawnProcess(process.env.YTDLP_PATH || 'yt-dlp', ['--ignore-config', '--flat-playlist', '--lazy-playlist', '--yes-playlist', '--no-warnings', '--js-runtimes', 'node', '--ignore-errors', '--socket-timeout', '15', '--playlist-end', String(limit), '--dump-json', '--', url], { stdio: ['ignore', 'pipe', 'pipe'] });
  let failure; let count = 0; let timer; let bytes = 0;
  const stop = error => { failure = error; child.kill('SIGKILL'); };
  const resetTimer = () => { clearTimeout(timer); timer = setTimeout(() => stop(new Error('歌單讀取逾時，請稍後重試。')), 60000); };
  const cancel = () => stop(signal.reason || new Error('歌單載入已取消。'));
  const completion = new Promise(resolve => {
    child.once('error', () => { failure = new Error('無法執行 yt-dlp。'); resolve(-1); });
    child.once('close', resolve);
  });
  child.stderr.resume();
  child.stdout.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 8_000_000) stop(new Error('歌單回應過大。'));
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  signal?.addEventListener('abort', cancel, { once: true });
  resetTimer();
  if (signal?.aborted) cancel();
  try {
    for await (const line of lines) {
      if (failure) throw failure;
      resetTimer();
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!entry || !/^[\w-]{11}$/.test(entry.id) || entry.availability === 'private') continue;
      const page = `https://www.youtube.com/watch?v=${entry.id}`;
      count++;
      yield { query: page, page, title: entry.title || 'YouTube', author: entry.uploader || entry.channel, duration: entry.duration };
      if (count >= limit) return;
    }
    const code = await completion;
    if (failure) throw failure;
    if (code !== 0 || !count) throw new Error('無法完整讀取歌單；請確認歌單公開且包含可播放影片。');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel); lines.close();
    child.kill('SIGKILL');
  }
}
export function normalizeQuery(input) {
  const value = input.trim();
  if (!value || value.length > 500) throw new Error('請輸入 1–500 字的歌名或 YouTube 連結。');
  if (!/^https?:\/\//i.test(value)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error('只接受歌名或 YouTube 網址。');
    return `ytsearch1:${value}`;
  }
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) throw new Error('目前只支援 YouTube 網址。');
  const id = host === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|live)\/([^/]+)$/)?.[1];
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('請提供單一 YouTube 影片網址；暫不支援歌單。');
  return `https://www.youtube.com/watch?v=${id}`;
}
export function resolveTrack(query, { signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.YTDLP_PATH || 'yt-dlp', ['--ignore-config', '--no-playlist', '--no-warnings', '--js-runtimes', 'node', '--socket-timeout', '15', '-f', 'bestaudio[acodec=opus][ext=webm]', '--dump-single-json', '--', normalizeQuery(query)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let settled = false;
    const cancel = () => { child.kill('SIGKILL'); finish(signal.reason || new Error('Source lookup cancelled')); };
    const finish = (error, data) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); error ? reject(error) : resolve(data); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('YouTube 解析逾時，請稍後重試。')); }, 60000);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.on('data', chunk => { out += chunk; if (out.length > 8_000_000) { child.kill('SIGKILL'); finish(new Error('音源回應過大。')); } });
    child.stderr.resume();
    child.on('error', () => finish(new Error('無法執行 yt-dlp，請檢查安裝及 YTDLP_PATH。')));
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) return finish(new Error('無法取得 YouTube 音源；可能受地區、登入限制或解析器版本影響。'));
      try {
        const raw = JSON.parse(out); const data = raw.entries?.[0] ?? raw;
        if (!data.url || data.is_live || data.acodec !== 'opus' || data.ext !== 'webm') throw new Error();
        finish(null, { title: data.title || 'YouTube', url: data.url, page: data.webpage_url, duration: data.duration, author: data.artist || data.uploader || data.channel, thumbnail: data.thumbnail });
      } catch { finish(new Error('找不到可播放的 WebM Opus 音源；目前不支援直播。')); }
    });
  });
}

export function playlistUrl(input) {
  let url;
  try { url = new URL(input.trim()); } catch { return null; }
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname.toLowerCase())) return null;
  const id = url.searchParams.get('list');
  if (!id) return null;
  if (!/^[\w-]{2,150}$/.test(id)) throw new Error('YouTube 歌單網址無效。');
  if (id.startsWith('RD')) {
    const seed = url.searchParams.get('v') || id.slice(2);
    if (/^[\w-]{11}$/.test(seed)) return `https://www.youtube.com/watch?v=${seed}&list=${id}`;
  }
  return `https://www.youtube.com/playlist?list=${id}`;
}
export function expandPlaylist(input, limit = 300) {
  const url = playlistUrl(input);
  if (!url) throw new Error('請提供 YouTube 歌單網址。');
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.YTDLP_PATH || 'yt-dlp', ['--ignore-config', '--flat-playlist', '--yes-playlist', '--js-runtimes', 'node', '--ignore-errors', '--socket-timeout', '15', '--playlist-end', String(limit + 1), '--dump-single-json', '--', url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('歌單讀取逾時，請稍後重試。')); }, 60000);
    child.stdout.on('data', chunk => { out += chunk; if (out.length > 8_000_000) { child.kill('SIGKILL'); finish(new Error('歌單回應過大。')); } });
    child.stderr.resume();
    child.on('error', () => finish(new Error('無法執行 yt-dlp。')));
    child.on('close', () => {
      if (settled) return;
      try {
        const data = JSON.parse(out);
        const entries = (data.entries || []).filter(e => e && /^[\w-]{11}$/.test(e.id) && e.availability !== 'private');
        const items = entries.slice(0, limit).map(e => ({ query: `https://www.youtube.com/watch?v=${e.id}`, page: `https://www.youtube.com/watch?v=${e.id}`, title: e.title || 'YouTube', author: e.uploader || e.channel, duration: e.duration }));
        if (!items.length) throw new Error();
        finish(null, { title: data.title || 'YouTube 歌單', items, truncated: entries.length > limit });
      } catch { finish(new Error('無法讀取歌單；請確認歌單公開且包含可播放影片。')); }
    });
  });
}
