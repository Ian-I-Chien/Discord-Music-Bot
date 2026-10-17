import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
export function time(seconds = 0) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const n = Math.floor(seconds);
  return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
function title(track) {
  const label = escapeMarkdown(String(track.title || track.query || 'YouTube').slice(0, 150));
  return /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]{11}$/.test(track.page || '') ? `[${label}](${track.page})` : label;
}
export function panelPayload(s, ping = 0, disabled = false) {
  const ended = s.closed || disabled;
  const paused = s.player.state.status === 'paused' || s.player.state.status === 'autopaused';
  const track = s.current;
  const elapsed = (s.resource?.playbackDuration || 0) / 1000;
  const fraction = track?.duration > 0 ? Math.min(1, elapsed / track.duration) : 0;
  const position = Math.floor(fraction * 14);
  const bar = '━'.repeat(position) + '🔘' + '━'.repeat(14 - position);
  const now = new EmbedBuilder().setColor(ended ? 0x747f8d : 0x287cff)
    .setTitle(ended ? 'Session Ended' : paused ? 'Paused' : 'Now Playing');
  if (track) {
    now.setDescription(`${paused ? '⏸' : '♫'} │ ${title(track)}\nby ${escapeMarkdown(String(track.author || 'YouTube').slice(0,100))}\n\n\`${time(elapsed)}\` ${bar} \`${time(track.duration ?? NaN)}\``);
    if (/^https:\/\//.test(track.thumbnail || '')) now.setThumbnail(track.thumbnail);
  } else now.setDescription(ended ? '播放已結束，使用 /play 再次點歌。' : s.loading ? '⏳ 正在取得 YouTube 音源…' : '佇列已播完，等待下一首歌曲。');
  const queue = new EmbedBuilder().setColor(0x287cff).setTitle('Up Next')
    .setDescription(s.queue.length ? s.queue.slice(0, 3).map((t, n) => `**${n + 1}.** ${title(t)}${t.author ? ` by ${escapeMarkdown(t.author.slice(0,80))}` : ''}`).join('\n') + (s.queue.length > 3 ? `\n… 還有 ${s.queue.length - 3} 首` : '') : '目前沒有待播歌曲。');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(paused ? 'music:resume' : 'music:pause').setLabel(paused ? '繼續' : '暫停').setEmoji(paused ? '▶️' : '⏸️').setStyle(ButtonStyle.Primary).setDisabled(ended || !track),
    new ButtonBuilder().setCustomId('music:skip').setLabel('下一首').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(ended || !track || s.loading),
    new ButtonBuilder().setCustomId('music:leave').setLabel('停止並離開').setStyle(ButtonStyle.Danger).setDisabled(ended),
  );
  return { content: '', embeds: [now, queue], components: [row], allowedMentions: { parse: [] } };
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
  s.panelWork = (s.panelWork || Promise.resolve()).catch(() => {}).then(async () => {
    // Publish only after audio actually starts; keep loading and diagnostics private.
    if (!s.closed && !s.hasStarted) return;
    const payload = panelPayload(s, ping);
    if (s.panel) await s.panel.edit(payload).catch(() => {});
    else if (!s.closed) {
      const message = await s.text.send(payload).catch(() => null);
      s.panel = message;
      if (message && s.closed) await message.edit(panelPayload(s, ping)).catch(() => {});
    }
  });
  return s.panelWork;
}
