import { MAX_QUEUE } from './controls.js';

export const REPEAT_MODES = ['off', 'track', 'queue'];
export const repeatLabel = session => ({ off: '關閉', track: '單曲', queue: '清單' })[session.repeatMode || 'off'];
export function setRepeat(session, mode) {
  if (!REPEAT_MODES.includes(mode)) throw new Error('無效的重複播放模式。');
  session.repeatMode = mode;
}
export function cycleRepeat(session) {
  setRepeat(session, REPEAT_MODES[(REPEAT_MODES.indexOf(session.repeatMode || 'off') + 1) % REPEAT_MODES.length]);
}
// Preserve an existing song even if all waiting slots were filled during playback.
export function flushRepeatTail(session) {
  if (session.repeatTail && session.queue.length < MAX_QUEUE) {
    session.queue.push(session.repeatTail);
    session.repeatTail = null;
  }
}
export function repeatFinished(session, reason = 'ended') {
  if (session.closed || !session.current || !session.hasStarted || !['ended', 'skip'].includes(reason)) return;
  const item = session.currentItem || { ...session.current, query: session.current.page };
  if (session.repeatMode === 'track' && reason === 'ended') session.queue.unshift(item);
  else if (session.repeatMode === 'queue') {
    if (session.queue.length >= MAX_QUEUE) session.repeatTail = item;
    else session.queue.push(item);
  }
}
export function repeatCandidates(session) {
  const current = session.currentItem;
  if (session.repeatMode === 'track' && current) return [current, ...session.queue];
  return session.repeatMode === 'queue' && current
    ? [...session.queue, ...(session.repeatTail ? [session.repeatTail] : []), current]
    : [...session.queue, ...(session.repeatTail ? [session.repeatTail] : [])];
}
