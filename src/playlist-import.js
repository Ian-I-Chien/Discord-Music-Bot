import { MAX_QUEUE } from './controls.js';

// A hidden boundary keeps later /play requests behind this playlist while
// allowing /playnext to insert before it. It is never passed to the player.
export function importPlaylist(session, entries, { advance, update, report = console.warn } = {}) {
  const controller = new AbortController();
  const boundary = { playlistPending: true };
  session.queue.push(boundary);
  session.playlistImports ??= new Set();
  session.playlistImports.add(controller);
  let resolveFirst; let rejectFirst; let received = false; let lastUpdate = 0;
  const ready = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
  const done = (async () => {
    try {
      for await (const item of entries(controller.signal)) {
        if (session.closed || controller.signal.aborted) break;
        const index = session.queue.indexOf(boundary);
        if (index < 0 || session.queue.filter(track => !track.playlistPending).length >= MAX_QUEUE) break;
        session.queue.splice(index, 0, item);
        if (!received) { received = true; resolveFirst(); }
        advance();
        if (Date.now() - lastUpdate >= 1000) { lastUpdate = Date.now(); update(); }
      }
      if (!received && !session.closed) throw new Error('歌單沒有可播放歌曲。');
    } catch (error) {
      if (!received) rejectFirst(error);
      else if (!session.closed && !controller.signal.aborted) report('背景歌單載入失敗：', error.message);
    } finally {
      const index = session.queue.indexOf(boundary);
      if (index >= 0) session.queue.splice(index, 1);
      session.playlistImports.delete(controller);
      if (!received) rejectFirst(new Error('歌單載入已取消。'));
      if (!session.closed) { advance(); update(); }
    }
  })();
  return { ready, done };
}

export function cancelPlaylistImports(session) {
  for (const controller of session.playlistImports || []) controller.abort();
}
