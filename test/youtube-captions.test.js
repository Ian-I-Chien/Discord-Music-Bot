import test from 'node:test';
import assert from 'node:assert/strict';
import { captionUrl, selectCaptionTracks, parseCaptions, youtubeLyrics } from '../src/youtube-captions.js';
import { findLyrics } from '../src/lyrics.js';

const id = 'dQw4w9WgXcQ';
const page = `https://www.youtube.com/watch?v=${id}`;
const caption = (language, kind = 'manual', extra = '') => ({ language, kind, videoId: id, ext: 'json3', url: `https://www.youtube.com/api/timedtext?v=${id}&lang=${language}${extra}` });
const json = JSON.stringify({ events: [{ tStartMs: 1000, segs: [{ utf8: '第一句' }] }, { tStartMs: 5000, segs: [{ utf8: '第二句' }] }] });

test('manual traditional Chinese precedes automatic Chinese and original English', () => {
  const raw = { webpage_url: page, language: 'en', subtitles: {
    en: [{ ...caption('en') }], 'zh-Hant': [{ ...caption('zh-Hant') }],
  }, automatic_captions: { 'zh-Hans': [{ ...caption('zh-Hans', 'auto') }], 'zh-TW': [{ ...caption('zh-TW', 'auto', '&tlang=zh-TW') }] } };
  const selected = selectCaptionTracks(raw);
  assert.deepEqual(selected.map(c => [c.kind, c.language]), [['manual', 'zh-Hant'], ['auto', 'zh-Hans']]);
  assert.equal(selectCaptionTracks({ ...raw, webpage_url: 'https://youtube.com/watch?v=wrong' }).length, 0);
});
test('caption URLs must be HTTPS, for the playing video, and non-translated YouTube timedtext', () => {
  assert.ok(captionUrl(caption('zh').url, id));
  for (const url of ['http://www.youtube.com/api/timedtext?v=' + id, 'https://evil.example/api/timedtext?v=' + id, 'https://youtube.com/redirect?v=' + id, caption('zh').url + '&tlang=en', caption('zh').url.replace(id, '9WEYFqCUze8')]) assert.equal(captionUrl(url, id), null);
});
test('JSON3 combines segment text and removes rolling duplicates and non-speech cues', () => {
  const rows = parseCaptions(JSON.stringify({ events: [
    { tStartMs: 0, segs: [{ utf8: '[Music]' }] },
    { tStartMs: 1000, segs: [{ utf8: 'Hello' }] },
    { tStartMs: 1500, segs: [{ utf8: 'Hello' }, { utf8: ' world' }] },
    { tStartMs: 1800, segs: [{ utf8: 'Hello world' }] },
    { tStartMs: 5000, segs: [{ utf8: '<b>下一句</b> &amp; more' }] },
    { tStartMs: 500000, segs: [{ utf8: 'outside audio' }] },
  ] }), 'json3', 100);
  assert.deepEqual(rows, [{ time: 1, text: 'Hello world' }, { time: 5, text: '下一句 & more' }]);
});
test('VTT supports hours, cue identifiers, tags and duplicate text', () => {
  const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000 align:start\n<c>First line</c>\n\n00:05.500 --> 00:06.000\nSecond line';
  assert.deepEqual(parseCaptions(vtt, 'vtt', 100), [{ time: 1, text: 'First line' }, { time: 5.5, text: 'Second line' }]);
});
test('fetch is bounded, ignores redirects and recovers from an invalid first caption file', async () => {
  const track = { page, duration: 100, captionTracks: [caption('zh-Hant'), { ...caption('en'), ext: 'vtt' }] };
  const calls = [];
  const rows = await youtubeLyrics(track, { fetchImpl: async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'error');
    return new Response(calls.length === 1 ? 'invalid JSON' : 'WEBVTT\n\n00:01.000 --> 00:02.000\nFirst line');
  } });
  assert.equal(rows.source, 'YouTube'); assert.equal(rows[0].time, 1); assert.equal(calls.length, 2);
  assert.equal(await youtubeLyrics({ ...track, captionTracks: [caption('zh')] }, { fetchImpl: async () => new Response('x'.repeat(2000001)) }), null);
});
test('external cancellation prevents requests and captions remain isolated by video', async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(youtubeLyrics({ page, duration: 100, captionTracks: [caption('zh')] }, { signal: abort.signal }), /abort/i);
  let calls = 0;
  assert.equal(await youtubeLyrics({ page: page.replace(id, '9WEYFqCUze8'), duration: 100, captionTracks: [caption('zh')] }, { fetchImpl: async () => { calls++; return new Response(json); } }), null);
  assert.equal(calls, 0);
});
test('captions are the last fallback after lyric providers and do not require another metadata lookup', async () => {
  const track = { title: 'Caption fallback fixture', author: 'Artist', page, duration: 100, captionTracks: [caption('zh')] };
  const calls = [];
  const rows = await findLyrics(track, { fetchImpl: async url => {
    const value = new URL(url); calls.push(value.hostname);
    return value.hostname.includes('youtube.com') ? new Response(json) : Response.json({});
  } });
  assert.equal(rows.source, 'YouTube'); assert.equal(rows.length, 2);
  assert.deepEqual(calls, ['lrclib.net', 'music.163.com', 'lyrics.kugou.com', 'www.youtube.com']);
});
