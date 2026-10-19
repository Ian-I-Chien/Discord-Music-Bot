import { repeatCandidates } from './repeat.js';
export const PREFETCH_COUNT = 5;

function fresh(result, now) {
  if (!result?.track || now - result.resolvedAt > 600000) return false;
  try {
    const expiry = new URL(result.track.url).searchParams.get('expire');
    return !expiry || (Number.isFinite(Number(expiry)) && Number(expiry) * 1000 > now + 30000);
  } catch { return false; }
}

function jobFor(item) {
  let settle;
  const promise = new Promise(resolve => { settle = resolve; });
  return { item, controller: new AbortController(), promise, settle, started: false };
}
function cancel(job) {
  job.cancelled = true; job.controller.abort();
  job.settle({ error: new Error('Source preparation cancelled') });
}
export function cancelPrefetch(session) {
  if (session.prefetch) for (const job of session.prefetch.jobs.values()) cancel(job);
  session.prefetch = null;
}

function nextJob(session, state) {
  const pending = [...state.jobs.values()].filter(job => !job.started && !job.cancelled);
  return pending.find(job => job.claimed) || (session.current && session.hasStarted ? pending[0] : undefined);
}
function pump(session, state) {
  if (state.worker) return state.worker;
  state.worker = Promise.resolve().then(async () => {
    while (session.prefetch === state && !session.closed && !session.recovery) {
      const job = nextJob(session, state);
      if (!job) break;
      job.started = true; state.running = job;
      let result;
      try {
        const track = await state.resolve(job.item, { signal: job.controller.signal });
        result = { track, resolvedAt: state.now() };
      } catch (error) { result = { error }; }
      state.running = null;
      if (job.preempted && !job.cancelled) {
        job.preempted = false; job.started = false; job.controller = new AbortController();
        continue;
      }
      job.result = result; job.settle(result);
    }
  }).finally(() => {
    state.worker = null;
    if (session.prefetch === state && !session.closed && !session.recovery && nextJob(session, state)) void pump(session, state);
  });
  return state.worker;
}

export function prefetchNext(session, resolve, { now = Date.now } = {}) {
  if (session.closed || session.recovery) { cancelPrefetch(session); return; }
  // advance() clears current before consuming a ready or in-flight source.
  if (!session.current || !session.hasStarted) return;
  const desired = [];
  for (const item of repeatCandidates(session)) {
    if (item.playlistPending || desired.length >= PREFETCH_COUNT) break;
    desired.push(item);
  }
  const state = session.prefetch ||= { jobs: new Map() };
  state.resolve = resolve; state.now = now;
  for (const [item, job] of state.jobs) {
    if (!desired.includes(item) && !job.claimed) { cancel(job); state.jobs.delete(item); }
  }
  const ordered = new Map();
  for (const item of desired) {
    let job = state.jobs.get(item);
    if (job?.result?.track && !fresh(job.result, now())) { cancel(job); job = null; }
    ordered.set(item, job || jobFor(item));
  }
  for (const [item, job] of state.jobs) if (job.claimed) ordered.set(item, job);
  state.jobs = ordered;
  void pump(session, state);
  return Promise.all(desired.map(item => state.jobs.get(item).promise));
}

export async function takeNextSource(session, item, resolve, { signal, now = Date.now } = {}) {
  signal?.throwIfAborted();
  const state = session.prefetch; const job = state?.jobs.get(item);
  if (!job) {
    cancelPrefetch(session);
    return { track: await resolve(item, { signal }), cached: false };
  }
  job.claimed = true;
  // If a newly inserted priority track is still queued behind another lookup,
  // pause that background lookup and prepare the requested track first.
  if (!job.started && state.running && state.running !== job) {
    state.running.preempted = true; state.running.controller.abort();
  }
  void pump(session, state);
  const abort = () => cancel(job);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let result;
  try { result = await job.promise; } finally {
    signal?.removeEventListener('abort', abort);
    state.jobs.delete(item);
  }
  signal?.throwIfAborted();
  if (fresh(result, now())) return { track: result.track, cached: true };
  return { track: await resolve(item, { signal }), cached: false };
}
