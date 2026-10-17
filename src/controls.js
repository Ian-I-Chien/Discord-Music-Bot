export const MAX_QUEUE = 300;
export function enqueueTrack(session, item, next = false) {
  if (session.queue.length >= MAX_QUEUE) throw new Error('佇列已滿，請稍後再試。');
  if (next) { session.queue.unshift(item); session.queuePage = 0; }
  else session.queue.push(item);
}
export function setVolume(session, percent) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('音量請輸入 0–100。');
  session.volume = percent;
  session.resource?.volume?.setVolume(percent / 100);
}

export const MIX_IMPORT_LIMIT = 20;
export function playlistImportLimit(url, queued) {
  const remaining = Math.max(0, MAX_QUEUE - queued);
  const isMix = new URL(url).searchParams.get('list')?.startsWith('RD');
  return isMix ? Math.min(MIX_IMPORT_LIMIT, remaining) : remaining;
}

export async function applyVolumeCommand(session, percent, connect) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('音量請輸入 0–100。');
  const active = session || await connect();
  setVolume(active, percent);
  active.showIdlePanel = !active.current && !active.loading;
  return active;
}

export function togglePause(session, requested) {
  if (session.recovery) throw new Error('正在恢復音源，請稍後再暫停或繼續。');
  const state = session.player.state.status;
  const paused = state === 'paused' || state === 'autopaused';
  const resume = requested === 'resume' || (requested === undefined && paused);
  if (!session.current) throw new Error('目前沒有播放中的歌曲。');
  if (resume) {
    if (paused && !session.player.unpause()) throw new Error('目前無法繼續播放，請稍後重試。');
  } else if (!paused && !session.player.pause()) throw new Error('目前無法暫停播放，請稍後重試。');
}
export function rememberTrack(session) {
  if (session.skipHistoryOnce) { session.skipHistoryOnce = false; return; }
  if (!session.current || !session.hasStarted) return;
  session.history ??= [];
  session.history.push({ ...session.current, query: session.current.page });
  if (session.history.length > 100) session.history.shift();
}
export function previousTrack(session) {
  if (session.loading) throw new Error('正在載入音源，請稍後再回上一首。');
  if (!session.history?.length) throw new Error('目前沒有上一首歌曲。');
  const interrupted = session.current ? { ...session.current, query: session.current.page } : null;
  if (session.queue.length + (interrupted ? 2 : 1) > MAX_QUEUE) throw new Error('佇列已滿，請先移除歌曲再回上一首。');
  const previous = session.history.pop();
  if (interrupted) session.queue.unshift(interrupted);
  session.queue.unshift(previous);
  session.queuePage = 0;
  session.skipHistoryOnce = Boolean(session.current);
  if (session.current) session.player.stop(true);
}
