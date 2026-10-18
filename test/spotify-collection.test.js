import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpotifyCollection, publicCollectionTotal, createSpotifyCollectionReader } from '../src/spotify-collection.js';
import { readSpotifyInput } from '../src/spotify.js';
import { importPlaylist } from '../src/playlist-import.js';
import { queuePayload } from '../src/panel.js';
const id = '6KTVCDlrTSskE2AdjbYCSX';
const page = `https://open.spotify.com/playlist/${id}`;
const track = n => ({ uri: `spotify:track:${String(n).padStart(22, '0')}`, title: `Song ${n}`, subtitle: 'Artist', duration: 200000 });
const embed = (tracks, type = 'playlist') => `<script type="application/json" id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { id, type, title: 'Ian', trackList: tracks } } } } } })}</script>`;
const source = total => `<script id="initialState">${Buffer.from(JSON.stringify({ entities: { items: { [`spotify:playlist:${id}`]: { content: { totalCount: total } } } } })).toString('base64')}</script>`;

test('collection input recognizes public links without account access', async () => {
  assert.deepEqual(await readSpotifyInput(page, { fetchImpl: () => { throw new Error('must not fetch'); } }), { kind: 'playlist', id, page });
  const result = await readSpotifyInput('https://spotify.link/test', { fetchImpl: async url => url.includes('spotify.link') ? new Response(null, { status: 302, headers: { location: page } }) : new Response('<html>playlist</html>') });
  assert.equal(result.kind, 'playlist'); assert.equal(result.page, page);
});
test('public collection metadata preserves order, duplicates and exact duration', () => {
  const collection = parseSpotifyCollection(embed([track(1), track(1), null, { uri: 'spotify:episode:invalid' }, track(2)]), page);
  assert.deepEqual(collection.items.map(item => item.title), ['Song 1', 'Song 1', 'Song 2']);
  assert.equal(collection.items[0].spotify.duration, 200);
  assert.equal(collection.items[0].spotifyCollectionPage, page);
  assert.throws(() => parseSpotifyCollection(embed([track(1)], 'album'), page));
  assert.throws(() => parseSpotifyCollection('<html>not available</html>', page));
});
test('public metadata is fetched without credentials; first song yields before total-size lookup', async () => {
  const calls = []; const info = [];
  const stream = createSpotifyCollectionReader({ fetchImpl: async (url, options) => {
    calls.push(url); assert.ok(!options.headers.Authorization); assert.ok(!options.headers.Cookie);
    assert.ok(url.startsWith('https://open.spotify.com/'));
    return new Response(url.includes('/embed/') ? embed(Array.from({ length: 100 }, (_, n) => track(n))) : source(580));
  } });
  const iterator = stream(page, 300, { onInfo: value => info.push(value) });
  assert.equal((await iterator.next()).value.title, 'Song 0'); assert.equal(calls.length, 1);
  const items = []; for await (const item of iterator) items.push(item);
  assert.equal(items.length + 1, 100); assert.equal(calls.length, 2);
  assert.equal(info.at(-1).total, 580); assert.equal(info.at(-1).visible, 100);
});
test('queue capacity, album input and cancellation are respected', async () => {
  let calls = 0;
  const stream = createSpotifyCollectionReader({ fetchImpl: async url => {
    calls++; return new Response(url.includes('/embed/') ? embed([track(1), track(2)], url.includes('/album/') ? 'album' : 'playlist') : source(2));
  } });
  const items = []; for await (const item of stream(page, 1)) items.push(item);
  assert.equal(items.length, 1);
  const album = []; for await (const item of stream(page.replace('/playlist/', '/album/'))) album.push(item);
  assert.equal(album.length, 2);
  const abort = new AbortController(); const iterator = stream(page, 300, { signal: abort.signal });
  await iterator.next(); const before = calls; abort.abort(); await assert.rejects(iterator.next()); assert.equal(calls, before);
});
test('source-size failures do not discard readable songs; malformed totals remain unknown', async () => {
  const stream = createSpotifyCollectionReader({ fetchImpl: async url => {
    if (!url.includes('/embed/')) throw new Error('network');
    return new Response(embed([track(1)]));
  } });
  const items = []; for await (const item of stream(page)) items.push(item);
  assert.equal(items.length, 1);
  assert.equal(publicCollectionTotal('<html>missing state</html>', page), undefined);
});
test('playlist insertion retains priority and partial source size is visible only in its queue', async () => {
  const item = parseSpotifyCollection(embed([track(1)]), page).items[0];
  const session = { queue: [{ title: 'existing' }], spotifyCollectionInfo: { page, total: 580, visible: 100 } };
  const job = importPlaylist(session, async function* () { yield item; }, { next: true, advance() {}, update() {} });
  await job.ready; await job.done;
  assert.equal(session.queue[0].title, 'Song 1');
  assert.ok(queuePayload(session).embeds[0].toJSON().footer.text.includes('100/580'));
  session.queue.shift(); assert.ok(!queuePayload(session).embeds[0].toJSON().footer.text.includes('100/580'));
});
