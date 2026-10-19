import test from 'node:test';
import assert from 'node:assert/strict';
import { repeatFinished, setRepeat, cycleRepeat, flushRepeatTail } from '../src/repeat.js';
import { rememberTrack, previousTrack } from '../src/controls.js';
import { prefetchNext, takeNextSource, cancelPrefetch } from '../src/prefetch.js';
import { panelPayload, queuePayload } from '../src/panel.js';
import { commands } from '../src/commands.js';

const song = name => ({ title: name, query: name, page: `https://audio.example/${name}` });
const session = () => {
  const currentItem = song('A');
  return { currentItem, current: currentItem, hasStarted: true, volume: 50, queue: [song('B'), song('C')], player: { state: { status: 'paused' } } };
};
test('off is default; mode changes are per-session and preserve playback, pause and volume', () => {
  const s = session(), other = session(), current = s.current;
  repeatFinished(s); assert.deepEqual(s.queue.map(t => t.title), ['B', 'C']);
  for (const expected of ['track', 'queue', 'off']) { cycleRepeat(s); assert.equal(s.repeatMode, expected); }
  assert.equal(s.current, current); assert.equal(s.player.state.status, 'paused'); assert.equal(s.volume, 50);
  assert.equal(other.repeatMode, undefined); assert.throws(() => setRepeat(s, 'invalid'));
});
test('track loops without consuming waiting songs; skip, failures and previous bypass it', () => {
  const s = session(); setRepeat(s, 'track'); repeatFinished(s);
  assert.equal(s.queue.shift(), s.currentItem); assert.deepEqual(s.queue.map(t => t.title), ['B', 'C']);
  for (const reason of ['skip', 'failed', 'previous']) repeatFinished(s, reason);
  assert.deepEqual(s.queue.map(t => t.title), ['B', 'C']);
});
test('queue cycles active entries including duplicates, additions, priority and a single song', () => {
  const s = session(); setRepeat(s, 'queue'); s.queue.unshift(song('priority')); s.queue.push(song('B'));
  repeatFinished(s); assert.deepEqual(s.queue.map(t => t.title), ['priority', 'B', 'C', 'B', 'A']);
  s.current = s.currentItem = s.queue.shift(); repeatFinished(s, 'skip');
  assert.deepEqual(s.queue.map(t => t.title), ['B', 'C', 'B', 'A', 'priority']);
  s.queue = []; repeatFinished(s); assert.equal(s.queue[0], s.currentItem);
});
test('failed, unstarted and closed tracks cannot loop, even in queue mode', () => {
  const s = session(); setRepeat(s, 'queue'); repeatFinished(s, 'failed');
  s.hasStarted = false; repeatFinished(s); s.hasStarted = true; s.closed = true; repeatFinished(s);
  assert.deepEqual(s.queue.map(t => t.title), ['B', 'C']);
});
test('previous preserves interrupted song exactly once in repeat mode', () => {
  const s = session(); setRepeat(s, 'queue'); s.history = [song('previous')];
  s.player.stop = () => { repeatFinished(s, 'previous'); rememberTrack(s); return true; };
  previousTrack(s);
  assert.deepEqual(s.queue.map(t => t.title), ['previous', 'A', 'B', 'C']);
  assert.deepEqual(s.history, []);
});
test('a full queue preserves its repeated tail until one slot becomes available', () => {
  const s = session(); setRepeat(s, 'queue'); s.queue = Array.from({ length: 300 }, (_, n) => song(String(n)));
  repeatFinished(s); assert.equal(s.queue.length, 300); assert.equal(s.repeatTail, s.currentItem);
  s.queue.shift(); flushRepeatTail(s); assert.equal(s.queue.length, 300); assert.equal(s.queue.at(-1), s.currentItem);
  flushRepeatTail(s); assert.equal(s.queue.length, 300); assert.equal(s.repeatTail, null);
});
test('repeat controls are registered and both panels expose the mode without extra messages', () => {
  const command = commands.find(c => c.name === 'repeat');
  assert.deepEqual(command.options[0].choices.map(c => c.value), ['off', 'track', 'queue']);
  const s = session(); setRepeat(s, 'track');
  for (const payload of [panelPayload(s), queuePayload(s)]) {
    assert.ok(payload.embeds[0].toJSON().fields.some(f => f.name === '重複' && f.value === '單曲'));
    assert.ok(payload.components.flatMap(row => row.toJSON().components).some(c => c.custom_id === 'music:cycle-repeat'));
    for (const row of payload.components) assert.ok(row.toJSON().components.length <= 5);
  }
});
test('prefetch prepares repeat order, reuses valid work, and remains bounded to five', async () => {
  const s = session(); const calls = [];
  const resolve = async item => { calls.push(item.title); return { url: 'https://audio.example/fresh', title: item.title }; };
  setRepeat(s, 'queue'); await prefetchNext(s, resolve);
  assert.deepEqual(calls, ['B', 'C', 'A']);
  setRepeat(s, 'track'); await prefetchNext(s, resolve);
  assert.deepEqual([...s.prefetch.jobs.keys()].map(t => t.title), ['A', 'B', 'C']);
  repeatFinished(s); s.current = null;
  assert.equal((await takeNextSource(s, s.queue.shift(), resolve)).cached, true);
  assert.deepEqual(calls, ['B', 'C', 'A']);
  s.current = s.currentItem; s.queue.push(...Array.from({ length: 10 }, (_, n) => song(String(n))));
  await prefetchNext(s, resolve); assert.ok(s.prefetch.jobs.size <= 5);
  s.closed = true; prefetchNext(s, resolve); assert.equal(s.prefetch, null);
  cancelPrefetch(s);
});
