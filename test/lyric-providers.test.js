import test from 'node:test';
import assert from 'node:assert/strict';
import { neteaseLyrics, kugouLyrics } from '../src/lyric-providers.js';
import { selectLyrics, findLyrics, lyricMetadata } from '../src/lyrics.js';

const track = { title: '跨來源測試', author: '測試歌手', duration: 200 };
const lrc = '[00:01]第一句\n[00:05]第二句';
test('Chinese subtitles and traditional/simplified metadata match without relaxing recording checks', () => {
  assert.equal(lyricMetadata({ title: '告五人 Accusefive【愛人錯過 Somewhere in time】Official Music Video', author: '告五人' }).title, '愛人錯過');
  const record = { trackName: '跨来源测试', artistName: '测试歌手', duration: 200, syncedLyrics: lrc };
  assert.ok(selectLyrics([record], track));
  assert.equal(selectLyrics([{ ...record, duration: 31 }], track), null);
  assert.equal(selectLyrics([{ ...record, artistName: '不同歌手' }], track), null);
  assert.equal(selectLyrics([{ ...record, trackName: '跨来源测试 现场' }], track), null);
});
test('NetEase verifies metadata before downloading bounded candidate lyrics', async () => {
  const requests = [];
  const result = await neteaseLyrics(track, track.title, track.author, { select: selectLyrics, getJson: async url => {
    requests.push(url);
    assert.equal(url.origin, 'https://music.163.com');
    if (url.pathname.includes('search')) return { code: 200, result: { songs: [
      { id: 1, name: track.title, artists: [{ name: 'wrong' }], duration: 200000 },
      { id: 2, name: track.title, artists: [{ name: track.author }], duration: 200000 },
    ] } };
    assert.equal(url.searchParams.get('id'), '2'); return { lrc: { lyric: lrc } };
  } });
  assert.equal(result.source, '網易雲'); assert.equal(result.length, 2); assert.equal(requests.length, 2);
});
test('Kugou rejects short clips and uses only validated IDs and public candidate keys', async () => {
  const requests = [];
  const result = await kugouLyrics(track, track.title, track.author, { select: selectLyrics, getJson: async url => {
    requests.push(url); assert.equal(url.origin, 'https://lyrics.kugou.com');
    if (url.pathname === '/search') {
      assert.equal(url.searchParams.get('duration'), '200000');
      return { status: 200, candidates: [
        { id: '1', accesskey: 'abc123', song: track.title, singer: track.author, duration: 31000 },
        { id: 'https://bad.example', accesskey: 'abc123', song: track.title, singer: track.author, duration: 200000 },
        { id: '2', accesskey: 'abc123', song: track.title, singer: track.author, duration: 200000 },
      ] };
    }
    assert.equal(url.searchParams.get('id'), '2'); return { content: Buffer.from(lrc).toString('base64') };
  } });
  assert.equal(result.source, '酷狗'); assert.equal(result.length, 2); assert.equal(requests.length, 2);
});
test('provider failures fall through and a successful Chinese source is cached', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url.href);
    if (url.hostname === 'lrclib.net') return new Response('unavailable', { status: 503 });
    if (url.hostname === 'music.163.com') throw new Error('network failure');
    if (url.pathname === '/search') return Response.json({ status: 200, candidates: [{ id: '123', accesskey: 'publickey', song: track.title, singer: track.author, duration: 200000 }] });
    return Response.json({ content: Buffer.from(lrc).toString('base64') });
  };
  const result = await findLyrics(track, { fetchImpl });
  assert.equal(result.source, '酷狗'); assert.equal(calls.length, 4);
  assert.equal(await findLyrics(track, { fetchImpl }), result); assert.equal(calls.length, 4);
});
test('all providers missing lyrics is silent; cancellation prevents further sources', async () => {
  let calls = 0;
  const missing = { ...track, title: '未收錄的測試歌曲' };
  assert.equal(await findLyrics(missing, { fetchImpl: async () => { calls++; return Response.json({}); } }), null);
  assert.equal(calls, 3);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(findLyrics({ ...track, title: 'Cancelled' }, { signal: abort.signal, fetchImpl: async () => { throw new Error('must not fetch'); } }), /abort/i);
});
