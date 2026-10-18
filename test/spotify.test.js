import test from 'node:test';
import assert from 'node:assert/strict';
import { spotifyUrl, parseSpotifyMetadata, readSpotifyTrack, matchSpotifyTrack, resolveSpotifyTrack } from '../src/spotify.js';
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
test('matching rejects covers, wrong artist, wrong duration and prefers official audio', () => {
  const base = { id: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up', duration: 214, uploader: 'Rick Astley' };
  const audio = { ...base, id: 'h7MYJghRWt0', title: base.title + ' (Official Audio)', duration: 214 };
  assert.equal(matchSpotifyTrack(metadata, [{ ...base, title: base.title + ' cover' }, { ...base, duration: 400 }, base, audio]).id, audio.id);
  assert.throws(() => matchSpotifyTrack(metadata, [{ ...base, title: 'Other Artist - Never Gonna Give You Up', uploader: 'Other Artist' }]));
  assert.throws(() => matchSpotifyTrack(metadata, [{ ...base, title: base.title + ' Live' }]));
  assert.throws(() => matchSpotifyTrack(metadata, [{ ...base, duration: 200 }]));
  assert.equal(matchSpotifyTrack({ ...metadata, title: metadata.title + ' Live' }, [{ ...base, title: base.title + ' Live' }]).id, base.id);
});
test('Spotify selection resolves an actual YouTube track with cancellation and attribution', async () => {
  const signal = new AbortController().signal;
  const track = await resolveSpotifyTrack(metadata, {
    signal, search: async (query, options) => {
      assert.ok(query.includes('Rick Astley')); assert.equal(options.signal, signal);
      return [{ id: 'dQw4w9WgXcQ', title: metadata.title, uploader: 'Rick Astley', duration: 213 }];
    }, resolve: async (url, options) => {
      assert.equal(options.signal, signal); assert.equal(url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      return { title: 'Actual YouTube title', page: url, duration: 213 };
    },
  });
  const session = { current: track, player: { state: { status: 'playing' } }, queue: [] };
  const panel = panelPayload(session).embeds[0].toJSON();
  assert.ok(panel.description.includes('Actual YouTube title'));
  assert.ok(panel.fields.some(field => field.value.includes(page) && field.value.includes('YouTube')));
  session.queue.push({ ...metadata, author: 'Rick Astley' });
  assert.ok(queuePayload(session).embeds[0].toJSON().description.includes(page));
});
