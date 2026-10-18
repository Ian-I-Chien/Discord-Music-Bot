import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { createSpotifyAuthorization, createSpotifyTokenProvider, saveSpotifyAuthorization, REDIRECT_URI, spotifyTokenRequest } from '../src/spotify-auth.js';
import { createSpotifyCollectionReader } from '../src/spotify-collection.js';
import { readSpotifyInput } from '../src/spotify.js';
import { importPlaylist } from '../src/playlist-import.js';

const id = '6KTVCDlrTSskE2AdjbYCSX';
const page = `https://open.spotify.com/playlist/${id}`;
const api = `https://api.spotify.com/v1/playlists/${id}/items`;
const track = n => ({ type: 'track', id: String(n).padStart(22, '0'), name: `Song ${n}`, artists: [{ name: 'Artist' }], duration_ms: 200000 });
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('collection input does not download or parse a single-track page', async () => {
  assert.deepEqual(await readSpotifyInput(page, { fetchImpl: () => { throw new Error('must not fetch'); } }), { kind: 'playlist', id, page });
  const result = await readSpotifyInput('https://spotify.link/test', { fetchImpl: async url => url.includes('spotify.link') ? new Response(null, { status: 302, headers: { location: page } }) : new Response('<html>playlist</html>') });
  assert.equal(result.kind, 'playlist'); assert.equal(result.page, page);
});

test('first page yields immediately; a 580-track list stops at 300 in six requests', async () => {
  const calls = [];
  const stream = createSpotifyCollectionReader({ token: async () => 'test-token', fetchImpl: async (url, options) => {
    calls.push(url); assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.redirect, 'error');
    const offset = Number(new URL(url).searchParams.get('offset'));
    return json({ total: 580, items: Array.from({ length: 50 }, (_, n) => ({ item: track(offset + n) })), next: `${api}?limit=50&offset=${offset + 50}` });
  } });
  const iterator = stream(page, 300);
  const first = await iterator.next(); assert.equal(first.value.title, 'Song 0'); assert.equal(calls.length, 1);
  const items = [first.value]; for await (const item of iterator) items.push(item);
  assert.equal(calls.length, 6); assert.equal(items.length, 300); assert.equal(items.at(-1).title, 'Song 299');
  assert.equal(items[0].spotify.duration, 200);
});

test('actual list size, duplicates and album order are retained; local and podcast items are skipped', async () => {
  const stream = createSpotifyCollectionReader({ token: async () => 'test', fetchImpl: async () => json({ items: [
    { track: track(1) }, { item: null }, { item: { ...track(2), is_local: true } },
    { item: { ...track(3), type: 'episode' } }, { item: track(1) }, { item: track(4) },
  ], next: null }) });
  const items = []; for await (const item of stream(page)) items.push(item);
  assert.deepEqual(items.map(item => item.title), ['Song 1', 'Song 1', 'Song 4']);
  const album = createSpotifyCollectionReader({ token: async () => 'test', fetchImpl: async url => {
    assert.ok(url.includes(`/albums/${id}/tracks`)); return json({ items: [track(8), track(9)], next: null });
  } });
  const titles = []; for await (const item of album(page.replace('/playlist/', '/album/'))) titles.push(item.title);
  assert.deepEqual(titles, ['Song 8', 'Song 9']);
});

test('cancelled imports never request another page; next-page bearer destinations are validated', async () => {
  const abort = new AbortController(); let calls = 0;
  const stream = createSpotifyCollectionReader({ token: async () => 'test', fetchImpl: async () => {
    calls++; return json({ items: [{ item: track(1) }], next: 'https://evil.test/token' });
  } });
  const iterator = stream(page, 300, { signal: abort.signal });
  await iterator.next(); abort.abort(); await assert.rejects(iterator.next()); assert.equal(calls, 1);
  const bad = stream(page); await bad.next(); await assert.rejects(bad.next(), /分頁/); assert.equal(calls, 2);
});

test('401 refreshes once; forbidden and rate-limited calls do not loop', async () => {
  const force = []; let calls = 0;
  const stream = createSpotifyCollectionReader({ token: async options => { force.push(options.force); return 'test'; }, fetchImpl: async () => ++calls === 1 ? new Response(null, { status: 401 }) : json({ items: [{ item: track(1) }], next: null }) });
  for await (const _ of stream(page)) {}
  assert.deepEqual(force, [false, true]);
  for (const status of [403, 429]) {
    let count = 0;
    const denied = createSpotifyCollectionReader({ token: async () => 'test', fetchImpl: async () => { count++; return new Response(null, { status }); } });
    await assert.rejects(denied(page).next(), status === 403 ? /共同編輯/ : /繁忙/); assert.equal(count, 1);
  }
});

test('playlist insertion keeps all inserted songs ahead of the existing queue', async () => {
  const session = { queue: [{ title: 'existing' }] };
  const job = importPlaylist(session, async function* () { yield { title: 'one' }; yield { title: 'two' }; }, { next: true, advance() {}, update() {} });
  await job.ready; await job.done;
  assert.deepEqual(session.queue.map(item => item.title), ['one', 'two', 'existing']);
});

test('PKCE uses a random verifier and state; only playlist read permissions are requested', () => {
  const auth = createSpotifyAuthorization('a'.repeat(32)); const url = new URL(auth.url);
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(auth.verifier).digest('base64url'));
  assert.ok(!auth.url.includes(auth.verifier)); assert.ok(!url.searchParams.get('scope').includes('modify'));
  assert.notEqual(createSpotifyAuthorization('a'.repeat(32)).state, auth.state);
});

test('concurrent expired tokens refresh once and rotated authorization is persisted', async () => {
  let calls = 0; let saved;
  const token = createSpotifyTokenProvider({ now: () => 100000, load: async () => ({ clientId: 'a'.repeat(32), refreshToken: 'old', expiresAt: 1 }),
    save: async data => { saved = data; }, fetchImpl: async (url, options) => {
      calls++; assert.equal(url, 'https://accounts.spotify.com/api/token');
      assert.equal(options.body.get('refresh_token'), 'old'); assert.equal(options.body.get('grant_type'), 'refresh_token');
      return json({ access_token: 'new-access', refresh_token: 'rotated', expires_in: 3600 });
    },
  });
  assert.deepEqual(await Promise.all([token(), token()]), ['new-access', 'new-access']);
  assert.equal(calls, 1); assert.equal(saved.refreshToken, 'rotated'); assert.equal(await token(), 'new-access'); assert.equal(calls, 1);
});

test('authorization files use owner-only permissions; malformed token responses do not leak secrets', async () => {
  await mkdir('node_modules/.cache', { recursive: true });
  const directory = await mkdtemp('node_modules/.cache/spotify-auth-test-'); const file = `${directory}/auth.json`;
  try {
    await saveSpotifyAuthorization({ refreshToken: 'test-only' }, file);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).refreshToken, 'test-only');
  } finally { await rm(directory, { recursive: true, force: true }); }
  await assert.rejects(spotifyTokenRequest({}, { fetchImpl: async () => new Response('{ secret-token') }), error => !error.message.includes('secret-token'));
});
