import { Routes } from 'discord.js';

export function channelStatusText(s) {
  if (s.closed || !s.current || !s.hasStarted) return null;
  const paused = ['paused', 'autopaused'].includes(s.player.state.status);
  return `${paused ? '⏸️' : '🎵'} ${s.current.title || 'YouTube'}`.replace(/\s+/g, ' ').slice(0, 500);
}

export function syncChannelStatus(s) {
  s.statusDesired = channelStatusText(s);
  if (s.statusWork) return s.statusWork;
  s.statusWork = Promise.resolve().then(async () => {
    while (s.statusDesired !== s.statusAttempted) {
      const status = s.statusDesired;
      s.statusAttempted = status;
      // Do not erase an existing channel status until this session has set one.
      if (status === null && !s.statusOwned) continue;
      try {
        await s.voiceChannel.client.rest.put(Routes.channelVoiceStatus(s.channelId), { body: { status } });
        s.statusOwned = status !== null;
      } catch (error) {
        console.warn('語音頻道狀態更新失敗：', error.code ?? error.name, error.message);
      }
    }
  }).finally(() => { s.statusWork = null; });
  return s.statusWork;
}
