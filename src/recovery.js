import { entersState, AudioPlayerStatus } from '@discordjs/voice';

export const RECOVERY_ATTEMPTS = 3;
export const RECOVERY_BUDGET_MS = 10000;
export function playbackSeconds(s) {
  return (s.playbackOffset || 0) + (s.resource?.playbackDuration || 0) / 1000;
}
export function endedEarly(s) {
  return s.hasStarted && s.current?.duration > 0 && playbackSeconds(s) < s.current.duration - 2;
}

export function cancelRecovery(s) {
  const recovery = s.recovery;
  if (!recovery) return;
  s.recovery = null;
  recovery.controller.abort();
  recovery.cleanup?.();
}

// A fresh resource must actually reach Playing within the shared deadline.
export async function recoverPlayback(s, { open, finish, update, now = Date.now,
  waitPlaying = (signal) => entersState(s.player, AudioPlayerStatus.Playing, signal),
  budget = RECOVERY_BUDGET_MS, attemptLimit = RECOVERY_ATTEMPTS } = {}) {
  if (s.closed || !s.current || s.recovery) return;
  const offset = playbackSeconds(s), track = s.current;
  const paused = ['paused', 'autopaused'].includes(s.player.state.status);
  const context = { controller: new AbortController(), cleanup: null };
  s.recovery = context;
  const active = () => !s.closed && s.recovery === context;
  const deadline = now() + budget;
  const timeout = setTimeout(() => context.controller.abort(), budget);
  s.abort?.abort(); s.stream?.destroy(); s.audioCleanup?.();
  s.player.stop(true);
  void update();
  console.warn('音源恢復開始：', JSON.stringify({ title: track.title, offset, attempts: attemptLimit, budget }));
  try {
    for (let attempt = 1; active() && attempt <= attemptLimit && now() < deadline; attempt++) {
      const remaining = deadline - now();
      // Reserve time for later attempts instead of spending all ten seconds on one connection.
      const attemptTimeout = Math.max(1, Math.floor(remaining / (attemptLimit - attempt + 1)));
      const signal = AbortSignal.any([context.controller.signal, AbortSignal.timeout(attemptTimeout)]);
      let audio;
      try {
        audio = await open(track, offset, signal, attempt);
        if (!active() || signal.aborted) { audio.cleanup(); break; }
        context.cleanup = audio.cleanup;
        s.playbackOffset = offset;
        s.resource = audio.resource;
        s.audioCleanup = audio.cleanup;
        s.player.play(audio.resource);
        await waitPlaying(signal);
        if (!active() || signal.aborted) throw new Error('Recovery cancelled');
        if (paused) s.player.pause();
        context.cleanup = null;
        console.log('音源恢復成功：', JSON.stringify({ title: track.title, offset, attempt }));
        return;
      } catch (error) {
        audio?.cleanup(); context.cleanup = null;
        if (!active()) return;
        s.player.stop(true);
        console.warn('音源恢復嘗試失敗：', JSON.stringify({ title: track.title, offset, attempt, error: error.code || error.name }));
      }
    }
    if (active()) {
      console.warn('音源恢復失敗，播放下一首：', JSON.stringify({ title: track.title, offset }));
      s.recovery = null;
      finish();
    }
  } finally {
    clearTimeout(timeout);
    if (s.recovery === context) s.recovery = null;
    if (!s.closed) void update();
  }
}
