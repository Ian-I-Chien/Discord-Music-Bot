import { Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { AudioPlayerStatus, VoiceConnectionStatus, getVoiceConnection, StreamType, createAudioPlayer, createAudioResource, joinVoiceChannel, entersState, demuxProbe } from '@discordjs/voice';
import { Readable } from 'node:stream';
import { resolveTrack, normalizeQuery, playlistUrl, expandPlaylist } from './source.js';
import { syncChannelStatus } from './channel-status.js';
import { sendVoiceLeave } from './voice-state.js';
import { registerCommands } from './commands.js';
import { MAX_QUEUE, enqueueTrack, applyVolumeCommand, playlistImportLimit, togglePause, rememberTrack, previousTrack } from './controls.js';
import { syncPanel, queueMetadata, syncQueue } from './panel.js';
if (!process.env.DISCORD_TOKEN?.trim()) throw new Error('請設定 DISCORD_TOKEN。');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const sessions = new Map();
const options = { allowedMentions: { parse: [] } };
function updatePanel(s) { return Promise.all([syncPanel(s, client.ws.ping), syncQueue(s), syncChannelStatus(s)]); }
function dispose(s) {
  if (s.closed) return;
  s.closed = true; s.queue = []; clearInterval(s.panelTimer); clearTimeout(s.idleTimer); s.abort?.abort(); s.stream?.destroy(); s.player.stop();
  if (sessions.get(s.guildId) === s) sessions.delete(s.guildId);
  void updatePanel(s);
  s.leaveTask = syncChannelStatus(s).finally(() => { s.connection.destroy(); }).then(() => sendVoiceLeave(client.guilds.cache.get(s.guildId))).catch(() => {});
  return s.leaveTask;
}
function idle(s) { clearTimeout(s.idleTimer); s.idleTimer = setTimeout(() => { if (!s.current && !s.loading && !s.queue.length) dispose(s); }, 180000); }
async function advance(s) {
  if (s.closed || s.loading || s.current) return;
  s.loading = true; s.showIdlePanel = false; clearTimeout(s.idleTimer); void updatePanel(s);
  try {
    while (!s.closed && s.queue.length) {
      const item = s.queue.shift(); const abort = new AbortController(); s.abort = abort;
      const timer = setTimeout(() => abort.abort(), 90000);
      try {
        const track = await resolveTrack(item.query);
        if (s.closed) return;
        const response = await fetch(track.url, { signal: abort.signal });
        if (!response.ok || !response.body) throw new Error('音訊下載失敗。');
        s.stream = Readable.fromWeb(response.body);
        s.stream.on('error', () => {});
        const probe = await demuxProbe(s.stream);
        if (s.closed) { probe.stream.destroy(); return; }
        if (probe.type !== StreamType.WebmOpus && probe.type !== StreamType.OggOpus) throw new Error('音訊格式不符。');
        clearTimeout(timer);
        s.current = track; s.hasStarted = false;
        s.resource = createAudioResource(probe.stream, { inputType: probe.type, inlineVolume: true });
        s.resource.volume.setVolume((s.volume ?? 50) / 100);
        s.resource.encoder?.setBitrate(192000);
        s.player.play(s.resource);
        void updatePanel(s);
        return;
      } catch (error) {
        abort.abort(); s.stream?.destroy();
        if (!s.closed) console.warn('音源播放失敗：', error.message);
      } finally { clearTimeout(timer); }
    }
  } finally { s.loading = false; void updatePanel(s); if (!s.closed && !s.current) { if (s.queue.length) void advance(s); else idle(s); } }
}
async function createSession(interaction, channel) {
  const connection = joinVoiceChannel({ guildId: interaction.guildId, channelId: channel.id, adapterCreator: interaction.guild.voiceAdapterCreator, selfDeaf: false });
  const s = { guildId: interaction.guildId, voiceChannel: channel, channelId: channel.id, connection, player: createAudioPlayer(), queue: [], volume: 50, current: null, loading: false, closed: false, text: interaction.channel };
  sessions.set(s.guildId, s); connection.subscribe(s.player);
  s.panelTimer = setInterval(() => { if (s.current && s.player.state.status === AudioPlayerStatus.Playing) void updatePanel(s); }, 1000);
  s.player.on(AudioPlayerStatus.Idle, () => { rememberTrack(s); s.current = null; s.hasStarted = false; s.resource = null; s.abort?.abort(); s.stream?.destroy(); void advance(s); });
  s.player.on(AudioPlayerStatus.Playing, () => { if (!s.hasStarted) s.panelView = 'now'; s.hasStarted = true; void updatePanel(s); });
  s.player.on('error', error => { console.error('播放器錯誤：', error.message); s.player.stop(true); });
  connection.on('error', () => dispose(s));
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try { await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]); await entersState(connection, VoiceConnectionStatus.Ready, 20000); } catch { dispose(s); }
  });
  try { await entersState(connection, VoiceConnectionStatus.Ready, 20000); return s; } catch { dispose(s); throw new Error('加入語音頻道失敗，請檢查權限與 UDP 網路。'); }
}
// Serialize guild commands so simultaneous play requests retain arrival order.
const locks = new Map();
async function handle(i, action = i.commandName) {
  const member = await i.guild.members.fetch(i.user.id); const channel = member.voice.channel;
  if (!channel || channel.type !== 2) throw new Error('請先加入一般語音頻道。');
  let s = sessions.get(i.guildId);
  if (s && s.channelId !== channel.id) throw new Error('請加入機器人所在的語音頻道再操作。');
  if (s && !s.current && !s.loading && !s.queue.length) idle(s);
  if (action === 'play' || action === 'playnext') {
    const me = await i.guild.members.fetchMe();
    if (!i.channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) throw new Error('播放面板需要檢視頻道、傳送訊息與嵌入連結（Embed Links）權限。');
    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) throw new Error('機器人需要連線及說話權限。');
    const query = (i.options.getString('link') ?? i.options.getString('query', true));
    const list = action === 'playnext' ? null : playlistUrl(query);
    const normalized = list || normalizeQuery(query);
    const input = normalized.startsWith('ytsearch1:') ? query : normalized;
    if (!s) s = await createSession(i, channel);
    if (s.queue.length >= MAX_QUEUE) throw new Error('佇列已滿，請稍後再試。');
    if (list) {
      const playlist = await expandPlaylist(list, playlistImportLimit(list, s.queue.length));
      s.queue.push(...playlist.items);
    } else {
      const item = { query: input };
      enqueueTrack(s, item, action === 'playnext');
      void queueMetadata(input).then(metadata => { Object.assign(item, metadata); void updatePanel(s); });
    }
    void advance(s);
    return { session: s };
  }
  if (action === 'volume') {
    if (!s) {
      const me = await i.guild.members.fetchMe();
      if (!i.channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) throw new Error('播放面板需要檢視頻道、傳送訊息與嵌入連結（Embed Links）權限。');
      if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) throw new Error('機器人需要連線及說話權限。');
    }
    s = await applyVolumeCommand(s, i.options.getInteger('percent', true), () => createSession(i, channel));
    if (!s.current && !s.loading && !s.queue.length) idle(s);
    return { session: s };
  }
  if (!s && action === 'leave') {
    const connectedChannel = i.guild.members.me?.voice.channelId;
    if (connectedChannel && connectedChannel !== channel.id) throw new Error('請加入機器人所在的語音頻道再操作。');
    getVoiceConnection(i.guildId)?.destroy();
    await sendVoiceLeave(i.guild);
    return;
  }
  if (!s) throw new Error('目前沒有播放工作階段。');
  if (action.startsWith('queue-page:')) {
    const page = Number(action.slice('queue-page:'.length));
    if (!Number.isInteger(page) || page < 0) throw new Error('頁碼無效。');
    return { queueSession: s, page };
  }
  switch (action) {
    case 'now-playing': s.panelView = 'now'; return { session: s };
    case 'toggle-pause': togglePause(s); return { session: s };
    case 'pause': togglePause(s, 'pause'); return { session: s };
    case 'resume': togglePause(s, 'resume'); return { session: s };
    case 'previous': previousTrack(s); if (!s.current) void advance(s); return { session: s };
    case 'skip': if (s.loading) throw new Error('正在載入音源，請稍後再跳歌；或用 /leave 取消。'); s.player.stop(true); return '⏭️ 已跳歌。';
    case 'leave': dispose(s); return '👋 已清空並離開。';
    case 'queue': return { queueSession: s, page: 0 };
    default: throw new Error('未知指令。');
  }
}
client.on('interactionCreate', async i => {
  const button = i.isButton() && i.customId.startsWith('music:');
  if ((!i.isChatInputCommand() && !button) || !i.inCachedGuild()) return;
  const queuePageButton = button && i.customId.startsWith('music:queue-page:');
  try {
    await i.deferReply({ flags: 64 });
    const previous = locks.get(i.guildId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      if (button) {
        const session = sessions.get(i.guildId);
        const expected = session?.panel?.id;
        if (expected !== i.message.id) throw new Error('這個面板已過期，請使用最新的播放面板。');
      }
      const result = await handle(i, button && ['music:pause', 'music:resume'].includes(i.customId) ? 'toggle-pause' : button ? i.customId.slice(6) : i.commandName);
      if (result?.queueSession) {
        await syncQueue(result.queueSession, result.page);
      }
      if (result?.session) {
        await updatePanel(result.session);
      }
      await i.deleteReply().catch(() => {});
    });
    locks.set(i.guildId, task);
    try { await task; } finally { if (locks.get(i.guildId) === task) locks.delete(i.guildId); }
  } catch (error) { if (i.deferred) await i.editReply({ content: error.message.slice(0,1900), ...options }).catch(() => {}); }
});
client.once('clientReady', async c => {
  try {
    await Promise.allSettled([...c.guilds.cache.values()].filter(g => g.members.me?.voice.channelId).map(sendVoiceLeave));
    await registerCommands(c.application);
    // Remove guild-scoped commands from the previous deployment, if configured.
    const legacyGuild = process.env.DISCORD_GUILD_ID;
    if (legacyGuild && c.guilds.cache.has(legacyGuild)) {
      await c.application.commands.set([], legacyGuild);
      console.log('已清除舊版單伺服器指令。');
    }
    console.log(`已登入 ${c.user.tag}，可在已邀請的伺服器使用 /play。`);
  } catch (error) {
    console.error('註冊指令失敗：', error.message);
    c.destroy(); process.exitCode = 1;
  }
});
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.allSettled([...sessions.values()].map(dispose));
  client.destroy(); process.exit(0);
});
await client.login(process.env.DISCORD_TOKEN);
