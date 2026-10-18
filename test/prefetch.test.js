import test from 'node:test';
import assert from 'node:assert/strict';
import { prefetchNext, takeNextSource, cancelPrefetch } from '../src/prefetch.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const source = { url: 'https://audio.example/song', title: 'Next' };
const session = () => ({ current: {}, hasStarted: true, queue: [{ query: 'next' }, { query: 'later' }] });

test('only the next source is prepared; repeated updates and skip reuse one lookup', async () => {
  const s = session(); let calls = 0;
  const resolve = async item => { calls++; assert.equal(item, s.queue[0]); return source; };
  await prefetchNext(s, resolve); await prefetchNext(s, resolve);
  assert.equal(calls, 1);
  s.current = null; prefetchNext(s, resolve);
  const item = s.queue.shift();
  assert.deepEqual(await takeNextSource(s, item, resolve), { track: source, cached: true });
  assert.equal(calls, 1); assert.equal(s.prefetch, null);
});
test('skip during preparation waits for the same pending lookup instead of starting another', async () => {
  const s = session(); const gate = deferred(); let calls = 0;
  const resolve = async () => { calls++; return gate.promise; };
  prefetchNext(s, resolve);
  const task = takeNextSource(s, s.queue.shift(), resolve);
  gate.resolve(source); assert.equal((await task).cached, true); assert.equal(calls, 1);
});
test('priority insertion cancels the old preparation and preserves actual queue order', async () => {
  const s = session(); let previousSignal;
  await prefetchNext(s, async (_item, options) => { previousSignal = options.signal; return source; });
  const priority = { query: 'priority' }; s.queue.unshift(priority);
  await prefetchNext(s, async item => { assert.equal(item, priority); return source; });
  assert.equal(previousSignal.aborted, true); assert.equal(s.prefetch.item, priority);
  const selected = await takeNextSource(s, { query: 'previous' }, async item => ({ ...source, title: item.query }));
  assert.equal(selected.cached, false); assert.equal(selected.track.title, 'previous');
});
test('closed sessions and hidden import boundaries cancel preparation; initial playback has priority', async () => {
  const s = session(); let signal;
  const resolve = async (_item, options) => { signal = options.signal; return source; };
  await prefetchNext(s, resolve);
  s.queue.unshift({ playlistPending: true }); prefetchNext(s, resolve); assert.equal(signal.aborted, true);
  s.queue.shift(); s.hasStarted = false; prefetchNext(s, () => { throw new Error('too early'); });
  assert.equal(s.prefetch, null);
  s.hasStarted = true; await prefetchNext(s, resolve); s.closed = true; prefetchNext(s, resolve); assert.equal(signal.aborted, true);
});
test('failed or expired prepared sources fall back to a fresh lookup', async () => {
  for (const mode of ['failed', 'stale', 'expired']) {
    const s = session(); let calls = 0;
    await prefetchNext(s, async () => {
      calls++; if (mode === 'failed') throw new Error('network');
      return { ...source, url: mode === 'expired' ? 'https://audio.example/song?expire=1' : source.url };
    }, { now: () => 0 });
    const selected = await takeNextSource(s, s.queue.shift(), async () => { calls++; return source; }, { now: () => mode === 'stale' ? 600001 : 10000 });
    assert.equal(selected.cached, false); assert.equal(calls, 2);
  }
});
test('leaving or aborting an in-flight source prevents later use', async () => {
  const s = session(); const gate = deferred(); let childSignal;
  prefetchNext(s, async (_item, options) => { childSignal = options.signal; return gate.promise; });
  await Promise.resolve();
  const abort = new AbortController();
  const task = takeNextSource(s, s.queue.shift(), () => { throw new Error('duplicate'); }, { signal: abort.signal });
  abort.abort(); gate.resolve(source); await assert.rejects(task); assert.equal(childSignal.aborted, true);
  await prefetchNext(s, async () => source); cancelPrefetch(s); assert.equal(s.prefetch, null);
});
