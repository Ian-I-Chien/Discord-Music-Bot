import { spawn } from 'node:child_process';
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
export function resolveTrack(query) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.YTDLP_PATH || 'yt-dlp', ['--ignore-config', '--no-playlist', '--no-warnings', '--js-runtimes', 'node', '--socket-timeout', '15', '-f', 'bestaudio[acodec=opus][ext=webm]', '--dump-single-json', '--', normalizeQuery(query)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let settled = false;
    const finish = (error, data) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(data); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('YouTube 解析逾時，請稍後重試。')); }, 60000);
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
