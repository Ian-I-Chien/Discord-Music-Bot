import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { streamPlaylist } from '../src/source.js';
import { importPlaylist, cancelPlaylistImports } from '../src/playlist-import.js';
import { queuePayload } from '../src/panel.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('first track starts before the rest loads; later requests and playnext retain order', async () => {
  const gate = deferred(); const s = { queue: [], player: { state: { status: 'playing' } } };
  const started = [];
  const job = importPlaylist(s, async function* () {
    yield { title: 'first' }; await gate.promise; yield { title: 'second' };
  }, { advance: () => {
    if (!s.current && s.queue.length && !s.queue[0].playlistPending) {
      s.current = s.queue.shift(); started.push(s.current.title);
    }
  }, update: () => {} });
  await job.ready;
  assert.deepEqual(started, ['first']);
  s.queue.push({ title: 'later request' });
  s.queue.unshift({ title: 'playnext' });
  const view = queuePayload(s).embeds[0].toJSON();
  assert.equal(view.title, '待播清單 · 2 首');
  assert.ok(!view.description.includes('playlistPending'));
  gate.resolve(); await job.done;
  assert.deepEqual(s.queue.map(t => t.title), ['playnext', 'second', 'later request']);
});
test('stop aborts the loader and no late entries are added', async () => {
  const gate = deferred(); const s = { queue: [] }; let signal;
  const job = importPlaylist(s, async function* (abort) {
    signal = abort; yield { title: 'first' }; await gate.promise; yield { title: 'late' };
  }, { advance() {}, update() {} });
  await job.ready;
  s.closed = true; cancelPlaylistImports(s); s.queue = [];
  assert.equal(signal.aborted, true);
  gate.resolve(); await job.done;
  assert.deepEqual(s.queue, []);
});
test('partial import survives later errors, initial errors reject, capacity is enforced', async () => {
  const reports = []; const s = { queue: [] };
  const job = importPlaylist(s, async function* () { yield { title: 'kept' }; throw new Error('network'); }, {
    advance() {}, update() {}, report: (...args) => reports.push(args),
  });
  await job.ready; await job.done;
  assert.equal(s.queue.length, 1); assert.equal(reports.length, 1);
  const bad = importPlaylist(s, async function* () { throw new Error('initial failure'); }, { advance() {}, update() {} });
  await assert.rejects(bad.ready, /initial failure/); await bad.done;
  s.queue = Array.from({ length: 299 }, () => ({ title: 'existing' }));
  const capped = importPlaylist(s, async function* () { yield { title: 'last' }; yield { title: 'overflow' }; }, { advance() {}, update() {} });
  await capped.ready; await capped.done; assert.equal(s.queue.length, 300);
});
test('yt-dlp entries are emitted before process exit and cancellation kills it', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let killed = false; let flags;
  child.kill = () => { killed = true; child.stdout.end(); child.emit('close', null); };
  const abort = new AbortController();
  const iterator = streamPlaylist('https://youtube.com/playlist?list=PLtest', 20, {
    signal: abort.signal, spawnProcess: (_exe, args) => { flags = args; return child; },
  });
  const next = iterator.next();
  child.stdout.write(JSON.stringify({ id: 'h7MYJghRWt0', title: 'first' }) + '\n');
  assert.equal((await next).value.title, 'first');
  assert.ok(flags.includes('--lazy-playlist')); assert.ok(flags.includes('--dump-json'));
  abort.abort();
  await assert.rejects(iterator.next(), /abort/i);
  assert.equal(killed, true);
});
