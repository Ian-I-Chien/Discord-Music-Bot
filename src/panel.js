import { repeatLabel } from './repeat.js';
import { lyricWindow } from './lyrics.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
export function time(seconds = 0) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const n = Math.floor(seconds);
  return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
function title(track, limit = 120) {
  const label = escapeMarkdown(String(track.title || track.query || 'YouTube').replace(/\s+/g, ' ').slice(0, limit));
  return /^(?:https:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]{11}|https:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]{22})$/.test(track.page || '') ? `[${label}](${track.page})` : label;
}
function repeatButton(s, ended) {
  return new ButtonBuilder().setCustomId('music:cycle-repeat').setLabel(`重複：${repeatLabel(s)}`).setEmoji('🔁').setStyle(ButtonStyle.Secondary).setDisabled(ended);
}
export const QUEUE_PAGE_SIZE = 8;
export function queuePagination(s, delta = 0) {
  const pages = Math.max(1, Math.ceil(s.queue.filter(item => !item.playlistPending).length / QUEUE_PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, (s.queuePage || 0) + delta));
  s.queuePage = page;
  return { page, pages, start: page * QUEUE_PAGE_SIZE };
}
export function panelPayload(s, ping = 0, disabled = false) {
  const ended = s.closed || disabled;
  const paused = s.player.state.status === 'paused' || s.player.state.status === 'autopaused';
  const track = s.current;
  const elapsed = (s.playbackOffset || 0) + (s.resource?.playbackDuration || 0) / 1000;
  const fraction = track?.duration > 0 ? Math.min(1, elapsed / track.duration) : 0;
  const position = Math.floor(fraction * 12);
  const bar = '━'.repeat(position) + '●' + '─'.repeat(12 - position);
  const now = new EmbedBuilder().setColor(ended ? 0x747f8d : 0xc87941)
    .setTitle(ended ? '播放結束' : !track ? '音樂播放器' : paused ? '已暫停' : '正在播放');
  if (track) {
    now.setDescription(`**${title(track)}**\n${escapeMarkdown(String(track.author || 'YouTube').replace(/\s+/g, ' ').slice(0,100))}\n\n\`${bar}\`\n\`${time(elapsed)} / ${time(track.duration ?? NaN)}\``);
    if (/^https:\/\//.test(track.thumbnail || '')) now.setThumbnail(track.thumbnail);
  } else now.setDescription(ended ? '播放已結束，使用 /play 再次點歌。' : s.loading ? '⏳ 正在取得 YouTube 音源…' : '使用 /play 點歌。');
  now.setDescription(`${now.toJSON().description}\n\n🔊 音量 **${s.volume ?? 50}%** · 🔁 重複：${repeatLabel(s)}`);
  if (/^https:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]{22}$/.test(track?.spotify?.page || '')) {
    now.addFields({ name: '點歌來源', value: `[Spotify 原曲](${track.spotify.page})` });
  }
  const lyrics = !ended && track && lyricWindow(s.lyrics, elapsed);
  if (lyrics) {
    const safe = text => escapeMarkdown(String(text || '').replace(/@/g, '@\u200b')).slice(0, 300);
    now.addFields(
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '🎤 歌詞 · LRCLIB', value: [lyrics.previous && safe(lyrics.previous), `**▶ ${safe(lyrics.current)}**`, lyrics.next && safe(lyrics.next)].filter(Boolean).join('\n'), inline: true },
    );
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music:previous').setLabel('上一首').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(ended || s.loading || Boolean(s.recovery) || !s.history?.length),
    new ButtonBuilder().setCustomId('music:toggle-pause').setLabel(paused ? '繼續' : '暫停').setEmoji(paused ? '▶️' : '⏸️').setStyle(ButtonStyle.Primary).setDisabled(ended || !track || Boolean(s.recovery)),
    new ButtonBuilder().setCustomId('music:skip').setLabel('下一首').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(ended || !track || s.loading),
    new ButtonBuilder().setCustomId('music:queue').setLabel('待播清單').setEmoji('📋').setStyle(ButtonStyle.Secondary).setDisabled(ended),
    repeatButton(s, ended),
  );
  const settings = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music:volume-down').setLabel('音量 −5%').setEmoji('🔉').setStyle(ButtonStyle.Secondary).setDisabled(ended || (s.volume ?? 50) <= 0),
    new ButtonBuilder().setCustomId('music:volume-up').setLabel('音量 +5%').setEmoji('🔊').setStyle(ButtonStyle.Secondary).setDisabled(ended || (s.volume ?? 50) >= 100),
    new ButtonBuilder().setCustomId('music:leave').setLabel('停止並離開').setStyle(ButtonStyle.Danger).setDisabled(ended),
  );
  return { content: '', embeds: [now], components: [row, settings], allowedMentions: { parse: [] } };
}
export function queuePayload(session, requestedPage = 0) {
  // Each private queue view has its own page; never change shared playback state.
  const s = { ...session, queue: session.queue.filter(item => !item.playlistPending), queuePage: requestedPage };
  const ended = Boolean(s.closed);
  const { page, pages, start } = queuePagination(s);
  const source = s.spotifyCollectionInfo;
  const partial = source?.total > source?.visible && s.queue.some(item => item.spotifyCollectionPage === source.page) ? ` · Spotify 公開可見 ${source.visible}/${source.total} 首` : '';
  const queue = new EmbedBuilder().setColor(0xc87941).setTitle(`待播清單 · ${s.queue.length} 首`)
    .setDescription(s.queue.length ? s.queue.slice(start, start + QUEUE_PAGE_SIZE).map((t, n) => {
      const author = escapeMarkdown(String(t.author || 'YouTube').replace(/\s+/g, ' ').slice(0,50));
      const duration = t.duration > 0 ? ` · ${time(t.duration)}` : '';
      return `**${String(start + n + 1).padStart(2, '0')}**  ${title(t, 70)}\n　 ${author}${duration}`;
    }).join('\n\n') : '目前沒有待播歌曲。')
    .setFooter({ text: `第 ${page + 1} / ${pages} 頁${s.queue.length ? ` · ${start + 1}–${Math.min(start + QUEUE_PAGE_SIZE, s.queue.length)}` : ''}${partial}` });
  queue.setDescription(`${queue.toJSON().description}\n\n🔊 音量 **${s.volume ?? 50}%** · 🔁 重複：${repeatLabel(s)}`);
  const pagination = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(page === 0 ? 'music:queue-start' : `music:queue-page:${page - 1}`).setLabel('上一頁').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(ended || page === 0),
    new ButtonBuilder().setCustomId('music:page-info').setLabel(`${page + 1} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(page >= pages - 1 ? 'music:queue-end' : `music:queue-page:${page + 1}`).setLabel('下一頁').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(ended || page >= pages - 1),
    repeatButton(s, ended),
    new ButtonBuilder().setCustomId('music:player-view').setLabel('回到播放').setEmoji('🎵').setStyle(ButtonStyle.Primary).setDisabled(ended),
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
      if (!s.closed && !s.hasStarted && !s.showIdlePanel && s.panelView !== 'queue' && !s.panelRepost) continue;
      const payload = !s.closed && s.panelView === 'queue' ? queuePayload(s, s.queuePage || 0) : panelPayload(s, ping);
      const signature = JSON.stringify(payload);
      if (signature === s.panelSignature && !s.panelRepost) continue;
      if (s.panel && !s.panelRepost) {
        const edited = await s.panel.edit(payload).then(() => true).catch(error => {
          console.error('面板更新失敗：', error.code ?? error.name, error.message);
          s.panelError = new Error([50001, 50013].includes(error.code) ? '無法更新播放面板，請確認機器人的檢視頻道、傳送訊息與嵌入連結權限。' : '播放面板更新失敗，請稍後重試。');
          return false;
        });
        if (edited) { s.panelSignature = signature; s.panelError = null; }
      }
      else if (!s.closed) {
        const previous = s.panel;
        const removePrevious = s.panelRemovePrevious;
        const message = await s.text.send(payload).catch(error => {
          console.error('面板傳送失敗：', error.code ?? error.name, error.message);
          s.panelError = new Error([50001, 50013].includes(error.code) ? '無法顯示播放面板，請確認機器人的檢視頻道、傳送訊息與嵌入連結權限。' : '播放面板顯示失敗，請稍後重試。');
          return null;
        });
        if (message) {
          s.panel = message;
          s.panelRepost = false;
          s.panelRemovePrevious = false;
          s.panelSignature = signature;
          s.panelError = null;
          // Keep the original usable until the replacement has been sent.
          if (previous) {
            if (removePrevious) {
              await previous.delete().catch(async error => {
                console.warn('舊播放面板刪除失敗：', error.code ?? error.name, error.message);
                await previous.edit({ components: [] }).catch(() => {});
              });
            } else await previous.edit({ components: [] }).catch(error => {
              console.warn('舊面板控制項清除失敗：', error.code ?? error.name, error.message);
            });
          }
        } else { s.panelRepost = false; s.panelRemovePrevious = false; }
        if (message && s.closed) await message.edit(panelPayload(s, ping)).catch(() => {});
      }
    }
  }).finally(() => { s.panelWork = null; });
  return s.panelWork;
}

export async function repostPanel(s, ping = 0, { removePrevious = false, track } = {}) {
  // Finish the existing edit before replacing the active message reference.
  if (s.panelWork) await s.panelWork;
  if (s.closed) throw new Error('播放已結束，請使用 /play 再次點歌。');
  if (track && s.current !== track) return;
  s.panelView = 'now';
  s.panelRepost = true;
  s.panelRemovePrevious = removePrevious;
  await syncPanel(s, ping);
  if (s.panelError) throw s.panelError;
}

export function syncStartedTrackPanel(s, ping = 0) {
  const firstStart = !s.hasStarted;
  s.hasStarted = true;
  return firstStart ? repostPanel(s, ping, { removePrevious: true, track: s.current }) : syncPanel(s, ping);
}

export function refreshPlaybackProgress(s, ping = 0) {
  // Automatic ticks must not keep a slow REST worker alive indefinitely.
  // Explicit user actions can still mark that worker dirty and update the view.
  if (s.closed || !s.current || s.player.state.status !== 'playing' || s.panelWork) return Promise.resolve();
  return syncPanel(s, ping);
}

export async function isActivePanel(s, messageId) {
  if (!s) return false;
  // Discord can display a sent message before its REST response updates s.panel.
  // A queued replacement may start another worker as the current one finishes.
  while (s.panelWork) await s.panelWork;
  return !s.closed && s.panel?.id === messageId;
}

export function syncQueue(s, requestedPage) {
  if (requestedPage === undefined) return Promise.resolve();
  s.panelView = 'queue';
  s.queuePage = queuePagination({ ...s, queuePage: requestedPage }).page;
  return syncPanel(s).then(() => { if (s.panelError) throw s.panelError; });
}
