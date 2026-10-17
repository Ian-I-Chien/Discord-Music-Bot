export const EMPTY_CHANNEL_TIMEOUT_MS = 180000;

export function watchEmptyChannel(session, { dispose, schedule = setTimeout, cancel = clearTimeout }) {
  let timer = null;
  let closed = false;
  const hasListeners = () => session.voiceChannel.members.some(member => !member.user.bot);
  function refresh() {
    if (closed || session.closed || hasListeners()) {
      if (timer !== null) cancel(timer);
      timer = null;
      return;
    }
    // Mute/deafen updates and other bots must not restart the countdown.
    if (timer !== null) return;
    timer = schedule(() => {
      timer = null;
      if (!closed && !session.closed && !hasListeners()) dispose(session);
    }, EMPTY_CHANNEL_TIMEOUT_MS);
  }
  return {
    refresh,
    close() { closed = true; if (timer !== null) cancel(timer); timer = null; },
  };
}
