export function cancelPrefetch(session) {
  session.prefetch?.controller.abort();
  session.prefetch = null;
}

export function prefetchNext(session, resolve, { now = Date.now } = {}) {
  if (session.closed) { cancelPrefetch(session); return; }
  if (session.recovery) { cancelPrefetch(session); return; }
  // Keep the prepared head while advance() clears current and consumes it.
  if (!session.current || !session.hasStarted) return;
  const item = session.queue[0];
  if (!item || item.playlistPending) { cancelPrefetch(session); return; }
  if (session.prefetch?.item === item) return;
  cancelPrefetch(session);
  const job = { item, controller: new AbortController() };
  session.prefetch = job;
  // No media is downloaded or buffered here; hold only one resolved source URL.
  job.promise = Promise.resolve().then(() => resolve(item, { signal: job.controller.signal }))
    .then(track => ({ track, resolvedAt: now() }), error => ({ error }));
  return job.promise;
}

function fresh(result, now) {
  if (!result.track || now - result.resolvedAt > 600000) return false;
  try {
    const expiry = new URL(result.track.url).searchParams.get('expire');
    return !expiry || (Number.isFinite(Number(expiry)) && Number(expiry) * 1000 > now + 30000);
  } catch { return false; }
}

export async function takeNextSource(session, item, resolve, { signal, now = Date.now } = {}) {
  signal?.throwIfAborted();
  const job = session.prefetch;
  if (job?.item !== item) {
    cancelPrefetch(session);
    return { track: await resolve(item, { signal }), cached: false };
  }
  session.prefetch = null;
  const cancel = () => job.controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  let result;
  try { result = await job.promise; } finally { signal?.removeEventListener('abort', cancel); }
  signal?.throwIfAborted();
  if (fresh(result, now())) return { track: result.track, cached: true };
  return { track: await resolve(item, { signal }), cached: false };
}
