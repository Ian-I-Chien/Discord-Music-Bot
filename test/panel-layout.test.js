import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricRows, progressRow, displayWidth, PANEL_COLUMNS } from '../src/panel-layout.js';
import { panelPayload } from '../src/panel.js';

test('lyrics retain the same three rows and display width, including CJK and absent lyrics', () => {
  for (const window of [null, { current: '測試中文歌詞'.repeat(50), previous: 'Short', next: 'next' }, { current: 'one line' }]) {
    const lines = lyricRows(window).split('\n');
    assert.equal(lines.length, 3);
    assert.ok(lines.every(line => displayWidth(line) === PANEL_COLUMNS));
    assert.ok(lines.every(line => line.length));
  }
  assert.ok(!lyricRows({ current: '```\n@everyone' }).includes('```'));
});
test('the progress bar and right-aligned clock share one constant-width line', () => {
  for (const fraction of [0, 0.5, 1]) {
    const row = progressRow(fraction, '01:05 / 04:05');
    assert.equal(displayWidth(row), PANEL_COLUMNS); assert.equal(row.split('\n').length, 1);
    assert.ok(row.endsWith('01:05 / 04:05')); assert.equal([...row].filter(char => char === '●').length, 1);
  }
  assert.ok(progressRow(1, '04:05 / 04:05').startsWith('━'.repeat(32) + '●'));
});
test('one player always reserves a full-width lyric block before, during and after lyrics', () => {
  const s = { current: { title: 'Track', duration: 200 }, queue: [], resource: { playbackDuration: 5000 }, player: { state: { status: 'playing' } } };
  const before = panelPayload(s).embeds[0].toJSON();
  s.lyrics = Object.assign([{ time: 0, text: '中文歌詞' }], { source: '酷狗' });
  const after = panelPayload(s).embeds[0].toJSON();
  assert.equal(before.description, after.description); assert.equal(before.fields.length, after.fields.length);
  const field = embed => embed.fields.find(item => item.name.includes('歌詞'));
  assert.equal(field(before).value.split('\n').length, field(after).value.split('\n').length);
  assert.equal(field(before).inline, false); assert.equal(field(after).inline, false);
  assert.equal(field(after).name, '🎤 歌詞');
});

test('missing lyrics is explicit without mislabeling an intro or unfinished lookup', () => {
  const s = { current: { title: 'Track', duration: 200 }, queue: [], resource: { playbackDuration: 1000 }, player: { state: { status: 'playing' } } };
  const field = () => panelPayload(s).embeds[0].toJSON().fields.find(item => item.name === '🎤 歌詞');
  s.lyricsStatus = 'loading'; assert.ok(!field().value.includes('沒有'));
  s.lyricsStatus = 'missing'; const missing = field().value; assert.match(missing, /目前沒有同步歌詞/);
  s.lyricsStatus = 'ready'; s.lyrics = Object.assign([{ time: 10, text: 'Later' }], { source: 'LRCLIB' });
  assert.ok(!field().value.includes('沒有')); assert.equal(field().value.split('\n').length, missing.split('\n').length);
  assert.equal(field().name, '🎤 歌詞');
  s.lyrics = null; s.lyricsStatus = 'unavailable'; assert.match(field().value, /暫時無法取得歌詞/);
});
