import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffledPlaylist } from '../src/shuffle.js';
import { importPlaylist, cancelPlaylistImports } from '../src/playlist-import.js';
import { playlistImportLimit } from '../src/controls.js';
import { prefetchNext } from '../src/prefetch.js';
import { queuePayload } from '../src/panel.js';
import { commands } from '../src/commands.js';
import { createSpotifyCollectionReader } from '../src/spotify-collection.js';

const song = n => ({ title: String(n), query: String(n) });
const entries = items => async function* () { yield* items; };
async function collect(iterator) { const items = []; for await (const item of iterator) items.push(item); return items; }
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('the first song is chosen from the complete bounded snapshot before any playback', async () => {
  const gate = defer(); let complete = false;
  const source = async function* () { yield song(0); await gate.promise; yield song(1); yield song(2); complete = true; };
  const iterator = shuffledPlaylist(source, 300, { random: () => 0 });
  let emitted = false; const first = iterator.next().then(result => { emitted = true; return result; });
  await Promise.resolve(); assert.equal(emitted, false);
  gate.resolve(); const selected = await first;
  assert.equal(complete, true); assert.equal(selected.value.title, '1');
  assert.deepEqual([selected.value, ...await collect(iterator)].map(t => t.title), ['1', '2', '0']);
});
test('each entry can be first and shuffle preserves distinct entries including duplicate songs', async () => {
  const original = [song('A'), song('A'), song('B')];
  const firsts = new Set();
  for (const value of [0, 0.5, 0.999]) for (const second of [0, 0.999]) {
    const values = [value, second];
    const output = await collect(shuffledPlaylist(entries(original), 300, { random: () => values.shift() }));
    firsts.add(output[0]); assert.equal(output.length, original.length);
    assert.equal(new Set(output).size, original.length);
    for (const item of original) assert.ok(output.includes(item));
  }
  assert.equal(firsts.size, 3); assert.deepEqual(original.map(t => t.title), ['A', 'A', 'B']);
});
test('limits bound collection, close its iterator, and respect Mix capacity', async () => {
  let closed = false; let count = 0;
  const source = async function* () { try { while (true) yield song(count++); } finally { closed = true; } };
  const mix = playlistImportLimit('https://youtube.com/watch?v=h7MYJghRWt0&list=RDh7MYJghRWt0', 0);
  assert.equal((await collect(shuffledPlaylist(source, mix))).length, 20); assert.equal(count, 20); assert.ok(closed);
  assert.equal((await collect(shuffledPlaylist(source, playlistImportLimit('https://youtube.com/playlist?list=PLtest', 299)))).length, 1);
  await assert.rejects(collect(shuffledPlaylist(source, 301)));
});
test('empty, single, partial source failures and invalid randomness are explicit', async () => {
  assert.deepEqual(await collect(shuffledPlaylist(entries([]), 300)), []);
  const single = song(1); assert.deepEqual(await collect(shuffledPlaylist(entries([single]), 300)), [single]);
  const reports = [];
  const partial = async function* () { yield single; throw new Error('metadata failed'); };
  assert.deepEqual(await collect(shuffledPlaylist(partial, 300, { report: (...args) => reports.push(args) })), [single]);
  assert.equal(reports.length, 1);
  await assert.rejects(collect(shuffledPlaylist(async function* () { throw new Error('unavailable'); }, 300)), /unavailable/);
  await assert.rejects(collect(shuffledPlaylist(entries([song(1), song(2)]), 300, { random: () => 1 })), /隨機/);
});
test('an existing song and queue stay intact; actual shuffled order drives panel and next-five prefetch', async () => {
  const current = song('current'); const s = { current, hasStarted: true, queue: [song('existing')], player: { state: { status: 'playing' } } };
  const untouched = { current: song('other'), queue: [] };
  const job = importPlaylist(s, signal => shuffledPlaylist(entries(Array.from({ length: 7 }, (_, n) => song(n))), 300, { signal, random: () => 0 }), { advance() {}, update() {} });
  await job.ready; await job.done;
  assert.equal(s.current, current); assert.equal(s.queue[0].title, 'existing');
  assert.deepEqual(s.queue.slice(1).map(t => t.title), ['1', '2', '3', '4', '5', '6', '0']);
  s.queue.push(song('later')); const calls = [];
  await prefetchNext(s, async item => { calls.push(item.title); return { url: 'https://audio.example/song' }; });
  assert.deepEqual(calls, ['existing', '1', '2', '3', '4']);
  const description = queuePayload(s).embeds[0].toJSON().description;
  assert.ok(description.indexOf('1') < description.indexOf('2'));
  assert.equal(s.repeatMode, undefined); assert.deepEqual(untouched.queue, []);
});
test('stop during snapshot cancels metadata and cannot append late entries', async () => {
  const gate = defer(); const s = { queue: [] }; let aborted;
  const job = importPlaylist(s, signal => shuffledPlaylist(async function* (signal) {
    aborted = signal; yield song(0); await gate.promise; yield song(1);
  }, 300, { signal }), { advance() {}, update() {} });
  const rejected = assert.rejects(job.ready, /abort|取消/i);
  await Promise.resolve(); s.closed = true; cancelPlaylistImports(s); s.queue = [];
  gate.resolve(); await rejected; await job.done;
  assert.equal(aborted.aborted, true); assert.deepEqual(s.queue, []);
});
test('Spotify random snapshots use only public metadata without waiting for optional total lookup', async () => {
  const id = '6KTVCDlrTSskE2AdjbYCSX'; const calls = [];
  const reader = createSpotifyCollectionReader({ fetchImpl: async url => {
    calls.push(url);
    assert.ok(url.includes('/embed/'));
    return new Response(`<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { state: { data: { entity: {
      id, type: 'playlist', title: 'Public subset', trackList: Array.from({ length: 100 }, (_, n) => ({ uri: `spotify:track:${String(n).padStart(22, '0')}`, title: `Song ${n}`, subtitle: 'Artist', duration: 200000 })),
    } } } } } })}</script>`);
  } });
  const output = await collect(shuffledPlaylist(signal => reader(`https://open.spotify.com/playlist/${id}`, 300, { signal, readTotal: false }), 300, { random: () => 0 }));
  assert.equal(output.length, 100); assert.equal(output[0].title, 'Song 1'); assert.equal(calls.length, 1);
  const command = commands.find(c => c.name === 'random-play');
  assert.equal(command.options[0].name, 'link'); assert.equal(command.options[0].required, true);
});
