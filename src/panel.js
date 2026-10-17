import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
export function time(seconds = 0) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const n = Math.floor(seconds);
  return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
function title(track, limit = 120) {
  const label = escapeMarkdown(String(track.title || track.query || 'YouTube').replace(/\s+/g, ' ').slice(0, limit));
  return /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]{11}$/.test(track.page || '') ? `[${label}](${track.page})` : label;
}
export const QUEUE_PAGE_SIZE = 8;
export function queuePagination(s, delta = 0) {
  const pages = Math.max(1, Math.ceil(s.queue.length / QUEUE_PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, (s.queuePage || 0) + delta));
  s.queuePage = page;
  return { page, pages, start: page * QUEUE_PAGE_SIZE };
}
export function panelPayload(s, ping = 0, disabled = false) {
  const ended = s.closed || disabled;
  const paused = s.player.state.status === 'paused' || s.player.state.status === 'autopaused';
  const track = s.current;
  const elapsed = (s.resource?.playbackDuration || 0) / 1000;
  const fraction = track?.duration > 0 ? Math.min(1, elapsed / track.duration) : 0;
  const position = Math.floor(fraction * 12);
  const bar = '━'.repeat(position) + '●' + '─'.repeat(12 - position);
  const now = new EmbedBuilder().setColor(ended ? 0x747f8d : 0xc87941)
    .setTitle(ended ? '播放結束' : paused ? '已暫停' : '正在播放');
  if (track) {
    now.setDescription(`**${title(track)}**\n${escapeMarkdown(String(track.author || 'YouTube').replace(/\s+/g, ' ').slice(0,100))}\n\n\`${bar}\`\n\`${time(elapsed)} / ${time(track.duration ?? NaN)}\``);
    if (/^https:\/\//.test(track.thumbnail || '')) now.setThumbnail(track.thumbnail);
  } else now.setDescription(ended ? '播放已結束，使用 /play 再次點歌。' : s.loading ? '⏳ 正在取得 YouTube 音源…' : '佇列已播完，等待下一首歌曲。');
  now.setFooter({ text: `音量 ${s.volume ?? 100}%` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(paused ? 'music:resume' : 'music:pause').setLabel(paused ? '繼續' : '暫停').setEmoji(paused ? '▶️' : '⏸️').setStyle(ButtonStyle.Primary).setDisabled(ended || !track),
    new ButtonBuilder().setCustomId('music:skip').setLabel('下一首').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(ended || !track || s.loading),
    new ButtonBuilder().setCustomId('music:queue').setLabel('待播清單').setEmoji('📋').setStyle(ButtonStyle.Secondary).setDisabled(ended),
    new ButtonBuilder().setCustomId('music:leave').setLabel('停止並離開').setStyle(ButtonStyle.Danger).setDisabled(ended),
  );
  return { content: '', embeds: [now], components: [row], allowedMentions: { parse: [] } };
}
export function queuePayload(session, requestedPage = 0) {
  // Each private queue view has its own page; never change shared playback state.
  const s = { ...session, queuePage: requestedPage };
  const ended = Boolean(s.closed);
  const { page, pages, start } = queuePagination(s);
  const queue = new EmbedBuilder().setColor(0xc87941).setTitle(`待播清單 · ${s.queue.length} 首`)
    .setDescription(s.queue.length ? s.queue.slice(start, start + QUEUE_PAGE_SIZE).map((t, n) => {
      const author = escapeMarkdown(String(t.author || 'YouTube').replace(/\s+/g, ' ').slice(0,50));
      const duration = t.duration > 0 ? ` · ${time(t.duration)}` : '';
      return `**${String(start + n + 1).padStart(2, '0')}**  ${title(t, 70)}\n　 ${author}${duration}`;
    }).join('\n\n') : '目前沒有待播歌曲。')
    .setFooter({ text: `第 ${page + 1} / ${pages} 頁${s.queue.length ? ` · ${start + 1}–${Math.min(start + QUEUE_PAGE_SIZE, s.queue.length)}` : ''}` });
  const pagination = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`music:queue-page:${Math.max(0, page - 1)}`).setLabel('上一頁').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(ended || page === 0),
    new ButtonBuilder().setCustomId('music:page-info').setLabel(`${page + 1} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`music:queue-page:${Math.min(pages - 1, page + 1)}`).setLabel('下一頁').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(ended || page >= pages - 1),
  );
  return { content: '', embeds: [queue], components: [pagination], allowedMentions: { parse: [] } };
}
export async function queueMetadata(query) {
  if (!query.startsWith('https://www.youtube.com/watch?v=')) return { query };
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return { query, page: query };
    const data = await response.json();
    return { query, page: query, title: data.title, author: data.author_name, thumbnail: data.thumbnail_url };
  } catch { return { query, page: query }; }
}

export function syncPanel(s, ping = 0) {
  s.panelDirty = true;
  if (s.panelWork) return s.panelWork;
  s.panelWork = Promise.resolve().then(async () => {
    // Keep at most one in-flight edit and coalesce updates during API rate limits.
    while (s.panelDirty) {
      s.panelDirty = false;
      if (!s.closed && !s.hasStarted) continue;
      const payload = panelPayload(s, ping);
      if (s.panel) await s.panel.edit(payload).catch(() => {});
      else if (!s.closed) {
        const message = await s.text.send(payload).catch(() => null);
        s.panel = message;
        if (message && s.closed) await message.edit(panelPayload(s, ping)).catch(() => {});
      }
    }
  }).finally(() => { s.panelWork = null; });
  return s.panelWork;
}
