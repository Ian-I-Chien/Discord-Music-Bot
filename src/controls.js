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
