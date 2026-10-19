import test from 'node:test';
import assert from 'node:assert/strict';
import { spotifyUrl, parseSpotifyMetadata, readSpotifyTrack, resolveSpotifyTrack } from '../src/spotify.js';
import { panelPayload, queuePayload } from '../src/panel.js';

const page = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
const html = `<meta content="music.song" property="og:type"><meta property="og:title" content="Never Gonna Give You Up"><meta name='music:musician_description' content='Rick Astley'><meta name="music:duration" content="214">`;
const metadata = { title: 'Never Gonna Give You Up', artists: ['Rick Astley'], duration: 214, page };
test('Spotify links are canonicalized and unrelated URLs never become fetch targets', () => {
  assert.equal(spotifyUrl(page + '?si=abc'), page);
  assert.equal(spotifyUrl(page.replace('/track/', '/intl-zh/track/')), page);
  assert.equal(spotifyUrl('https://spotify.link/abc123?si=test'), 'https://spotify.link/abc123');
  assert.equal(spotifyUrl('https://open.spotify.com.evil.test/track/abc'), null);
  assert.equal(spotifyUrl('https://127.0.0.1/a'), null);
  assert.equal(spotifyUrl(page.replace('/track/', '/playlist/')), page.replace('/track/', '/playlist/'));
  assert.equal(spotifyUrl(page.replace('/track/', '/album/')), page.replace('/track/', '/album/'));
  for (const input of [page.replace('https:', 'http:'), page.replace('/track/', '/artist/'), page.replace('open.spotify.com', 'user:pass@open.spotify.com'), page.replace('open.spotify.com', 'open.spotify.com:9999')]) assert.throws(() => spotifyUrl(input));
});
test('metadata requires artist, song and duration and decodes HTML entities', () => {
  assert.deepEqual(parseSpotifyMetadata(html, page), metadata);
  assert.equal(parseSpotifyMetadata(html.replace('Rick Astley', 'Rick &amp; Friends'), page).artists[0], 'Rick & Friends');
  assert.throws(() => parseSpotifyMetadata('<meta property="og:title" content="Spotify">', page));
});
test('short links resolve safely; off-site redirects and oversized pages are rejected', async () => {
  const visited = [];
  const result = await readSpotifyTrack('https://spotify.link/abc', { fetchImpl: async (url, options) => {
    visited.push(url); assert.equal(options.redirect, 'manual');
    return url.includes('spotify.link') ? new Response(null, { status: 302, headers: { location: page } }) : new Response(html);
  } });
  assert.deepEqual(result, metadata); assert.equal(visited.length, 2);
  await assert.rejects(readSpotifyTrack('https://spotify.link/abc', { fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }) }), /不支援/);
  await assert.rejects(readSpotifyTrack(page, { fetchImpl: async () => new Response('x'.repeat(2_000_001)) }), /過大/);
  await assert.rejects(readSpotifyTrack(page, { fetchImpl: async () => new Response('', { status: 403 }) }), /無法讀取/);
});
test('Lara Liang / 梁心頤 naming differences do not block the first search result', async () => {
  const signal = new AbortController().signal;
  const metadata = { title: '靠近一點點', artists: ['Lara Liang'], duration: 213.24, page };
  let calls = 0;
  const track = await resolveSpotifyTrack(metadata, { signal, resolve: async (query, options) => {
    calls++; assert.equal(query, 'Lara Liang 靠近一點點 official audio');
    assert.equal(options.signal, signal);
    return { title: '梁心頤 Lara / 靠近一點點【歌詞】', duration: 212, page: 'https://www.youtube.com/watch?v=cvnEqZIRgFk' };
  } });
  assert.equal(calls, 1); assert.equal(track.title, '梁心頤 Lara / 靠近一點點【歌詞】');
  assert.equal(track.spotify, metadata);
});
test('Spotify selection resolves an actual YouTube track with cancellation and attribution', async () => {
  const signal = new AbortController().signal;
  const track = await resolveSpotifyTrack(metadata, {
    signal, resolve: async (query, options) => {
      assert.equal(options.signal, signal); assert.equal(query, 'Rick Astley Never Gonna Give You Up official audio');
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      return { title: 'Actual YouTube title', page: url, duration: 213 };
    },
  });
  const session = { current: track, player: { state: { status: 'playing' } }, queue: [] };
  const panel = panelPayload(session).embeds[0].toJSON();
  assert.ok(panel.description.includes('Actual YouTube title'));
  assert.ok(panel.fields.some(field => field.value === `[Spotify 原曲](${page})`));
  assert.ok(!panel.fields.some(field => field.value.includes('播放音源')));
  session.queue.push({ ...metadata, author: 'Rick Astley' });
  assert.ok(queuePayload(session).embeds[0].toJSON().description.includes(page));
});
