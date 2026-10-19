import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, lyricWindow, selectLyrics, findLyrics, startLyrics, cancelLyrics } from '../src/lyrics.js';
import { panelPayload } from '../src/panel.js';

const track = { title: 'Test Artist - Test Song Official Music Video', author: 'Test Artist', duration: 100 };
const record = { trackName: 'Test Song', artistName: 'Test Artist', duration: 100, syncedLyrics: '[00:02.00]First line\n[00:05.00]Second line\n[00:08.00]Third line' };
const session = () => ({ current: track, hasStarted: true, queue: [], player: { state: { status: 'playing' } }, resource: { playbackDuration: 5000 } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('LRC timestamps, repeated lines, offsets, malformed rows and bounds', () => {
  const lines = parseLrc('[ar:Artist]\n[offset:1000]\n[00:05.5][00:12.500]Repeated\n[00:02.00]Start\n[00:99.00]Bad\n[00:05.5]Repeated');
  assert.deepEqual(lines, [{ time: 1, text: 'Start' }, { time: 4.5, text: 'Repeated' }, { time: 11.5, text: 'Repeated' }]);
  assert.deepEqual(parseLrc(null), []); assert.deepEqual(parseLrc('x'.repeat(200001)), []);
  assert.equal(parseLrc('[00:00.00]' + 'x'.repeat(1000))[0].text.length, 180);
});
test('lyrics follow exact playback boundaries and recovery offsets', () => {
  const lines = parseLrc(record.syncedLyrics);
  assert.equal(lyricWindow(lines, 1), null);
  assert.equal(lyricWindow(lines, 2).current, 'First line');
  assert.deepEqual(lyricWindow(lines, 5), { previous: 'First line', current: 'Second line', next: 'Third line' });
  const s = session(); s.lyrics = lines;
  const lyrics = () => panelPayload(s).embeds[0].toJSON().fields.find(f => f.name.includes('歌詞')).value;
  assert.match(lyrics(), /▶ Second line/);
  s.player.state.status = 'paused'; assert.match(lyrics(), /▶ Second line/);
  s.playbackOffset = 7; s.resource.playbackDuration = 1000; assert.match(lyrics(), /▶ Third line/);
});
test('matching rejects wrong artists, versions, durations and unsynchronized lyrics', () => {
  assert.ok(selectLyrics([record], track));
  for (const bad of [{ artistName: 'Someone Else' }, { trackName: 'Different Song' }, { trackName: 'Test Song Live' }, { duration: 110 }, { instrumental: true }, { syncedLyrics: null }, { syncedLyrics: '[02:00]Too late' }]) {
    assert.equal(selectLyrics([{ ...record, ...bad }], track), null);
  }
  const spotify = { ...track, spotify: { title: 'Test Song', artists: ['Test Artist'] } };
  assert.ok(selectLyrics([record], spotify));
});
test('lookup uses the fixed LRCLIB endpoint, bounded responses and a metadata cache', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++; assert.equal(url.origin + url.pathname, 'https://lrclib.net/api/search');
    assert.equal(url.searchParams.get('q'), 'Test Song'); assert.ok(options.signal); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify([record]));
  };
  const lines = await findLyrics(track, { fetchImpl, now: () => 1 });
  assert.equal(lines.length, 3);
  assert.equal(await findLyrics(track, { fetchImpl, now: () => 2 }), lines); assert.equal(calls, 1);
  assert.equal(await findLyrics({ ...track, title: 'Too large' }, { fetchImpl: async () => new Response('x'.repeat(2000001)) }), null);
});
test('late lyrics cannot overwrite the next song or a stopped session', async () => {
  const s = session(); const gate = deferred(); let signal; let updates = 0;
  const old = startLyrics(s, { lookup: (_track, options) => { signal = options.signal; return gate.promise; }, update: () => updates++ });
  await Promise.resolve(); s.current = { ...track, title: 'Next song' };
  await startLyrics(s, { lookup: async () => [{ time: 0, text: 'Next' }], update: () => updates++ });
  assert.equal(signal.aborted, true); gate.resolve(parseLrc(record.syncedLyrics)); await old;
  assert.equal(s.lyrics[0].text, 'Next'); assert.equal(updates, 1);
  cancelLyrics(s); s.closed = true;
  assert.equal(s.lyrics, null); assert.equal(startLyrics(s), undefined);
});
test('pause/resume only requests once and network failures are silent', async () => {
  const s = session(); let calls = 0;
  const options = { lookup: async () => { calls++; throw new Error('unavailable'); }, update: () => { throw new Error('must not publish failure'); } };
  await startLyrics(s, options); await startLyrics(s, options);
  assert.equal(calls, 1); assert.equal(s.lyrics, null);
  const other = session(); assert.equal(other.lyrics, undefined);
});
test('single-line status and inline lyrics escape untrusted text and disappear on stop', () => {
  const s = session(); s.repeatMode = 'track'; s.volume = 50;
  s.lyrics = [{ time: 0, text: '@everyone **hello** [link](https://example.com)' }];
  const embed = panelPayload(s).embeds[0].toJSON();
  assert.match(embed.description, /🔊 音量 \*\*50%\*\* · 🔁 重複：單曲/);
  const field = embed.fields.find(f => f.name.includes('歌詞'));
  assert.equal(field.inline, false); assert.ok(field.value.includes('@\u200beveryone')); assert.ok(field.value.includes('**hello**'));
  assert.ok(field.value.length <= 1024);
  s.closed = true; assert.ok(!panelPayload(s).embeds[0].toJSON().fields.find(f => f.name.includes('歌詞')).value.includes('hello'));
});
