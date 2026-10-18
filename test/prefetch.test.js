import test from 'node:test';
import assert from 'node:assert/strict';
import { prefetchNext, takeNextSource, cancelPrefetch, PREFETCH_COUNT } from '../src/prefetch.js';
const source = { url: 'https://audio.example/song', title: 'Next' };
const session = (count = 7) => ({ current: {}, hasStarted: true, queue: Array.from({ length: count }, (_, n) => ({ query: `song-${n}` })) });

test('five sources prepare serially and window advances without repeating ready lookups', async () => {
  const s = session(); const calls = []; let active = 0; let maximum = 0;
  const resolve = async item => { calls.push(item.query); active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; return source; };
  await prefetchNext(s, resolve); await prefetchNext(s, resolve);
  assert.equal(PREFETCH_COUNT, 5); assert.equal(calls.length, 5); assert.equal(maximum, 1);
  s.current = null;
  const selected = await takeNextSource(s, s.queue.shift(), resolve);
  assert.equal(selected.cached, true); assert.equal(calls.length, 5);
  s.current = {}; await prefetchNext(s, resolve);
  assert.deepEqual(calls, ['song-0', 'song-1', 'song-2', 'song-3', 'song-4', 'song-5']);
  assert.equal(s.prefetch.jobs.size, 5);
});
test('skip during preparation reuses that pending lookup', async () => {
  const s = session(1); let release; let calls = 0;
  prefetchNext(s, async () => { calls++; return new Promise(resolve => { release = resolve; }); });
  await Promise.resolve(); s.current = null;
  const task = takeNextSource(s, s.queue.shift(), () => { throw new Error('duplicate'); });
  release(source); assert.equal((await task).cached, true); assert.equal(calls, 1);
});
test('priority insertion reuses retained entries and removes only the displaced fifth item', async () => {
  const s = session(5); const calls = []; const signals = new Map();
  const resolve = async (item, options) => { calls.push(item.query); signals.set(item.query, options.signal); return source; };
  await prefetchNext(s, resolve);
  const priority = { query: 'priority' }; s.queue.unshift(priority);
  await prefetchNext(s, resolve);
  assert.equal(calls.length, 6); assert.equal(signals.get('song-4').aborted, true);
  assert.deepEqual([...s.prefetch.jobs.keys()].map(item => item.query), ['priority', 'song-0', 'song-1', 'song-2', 'song-3']);
});
test('pending priority playback preempts another background lookup and resumes it later', async () => {
  const s = session(1); let first = true; let started;
  const running = new Promise(resolve => { started = resolve; });
  const resolve = async (item, { signal }) => {
    if (item.query === 'song-0' && first) {
      first = false; started();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('preempted')), { once: true }));
    }
    return { ...source, title: item.query };
  };
  prefetchNext(s, resolve); await running;
  s.queue.unshift({ query: 'priority' }); prefetchNext(s, resolve); s.current = null;
  const selected = await takeNextSource(s, s.queue.shift(), resolve);
  assert.equal(selected.track.title, 'priority');
  s.current = {}; await prefetchNext(s, resolve);
  assert.equal(s.prefetch.jobs.get(s.queue[0]).result.track.title, 'song-0');
});
test('initial playback has priority; hidden boundaries stop the window; leaving cancels all jobs', async () => {
  const s = session(); s.hasStarted = false;
  prefetchNext(s, () => { throw new Error('too early'); }); assert.equal(s.prefetch, undefined);
  s.hasStarted = true; s.queue.splice(2, 0, { playlistPending: true });
  await prefetchNext(s, async () => source); assert.equal(s.prefetch.jobs.size, 2);
  const jobs = [...s.prefetch.jobs.values()]; s.closed = true; prefetchNext(s, async () => source);
  assert.equal(s.prefetch, null); assert.ok(jobs.every(job => job.controller.signal.aborted));
});
test('failed and expired sources fall back without evicting other ready entries', async () => {
  for (const mode of ['failed', 'stale', 'expired']) {
    const s = session(2);
    await prefetchNext(s, async item => {
      if (item === s.queue[0] && mode === 'failed') throw new Error('network');
      return { ...source, url: mode === 'expired' ? 'https://audio.example/song?expire=1' : source.url };
    }, { now: () => 0 });
    const selected = await takeNextSource(s, s.queue.shift(), async () => source, { now: () => mode === 'stale' ? 600001 : 10000 });
    assert.equal(selected.cached, false); assert.equal(s.prefetch.jobs.size, 1);
  }
});
test('aborting foreground consumption cancels its preparation and cannot return stale audio', async () => {
  const s = session(1); let release; let childSignal;
  prefetchNext(s, async (_item, { signal }) => { childSignal = signal; return new Promise(resolve => { release = resolve; }); });
  await Promise.resolve(); s.current = null;
  const abort = new AbortController();
  const task = takeNextSource(s, s.queue.shift(), () => { throw new Error('duplicate'); }, { signal: abort.signal });
  abort.abort(); release(source); await assert.rejects(task); assert.equal(childSignal.aborted, true);
  cancelPrefetch(s);
});
