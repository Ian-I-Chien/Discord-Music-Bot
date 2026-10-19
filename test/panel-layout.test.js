import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricRows, progressRow, displayWidth, PANEL_COLUMNS } from '../src/panel-layout.js';
import { panelPayload } from '../src/panel.js';

const session = () => ({ current: { title: 'Track', duration: 200 }, queue: [], resource: { playbackDuration: 5000 }, player: { state: { status: 'playing' } } });
test('lyrics contain only available lines without padding or code blocks', () => {
  assert.equal(lyricRows(null), '');
  assert.equal(lyricRows(null, '目前沒有同步歌詞'), '目前沒有同步歌詞');
  assert.equal(lyricRows({ current: 'one line' }), '**▶ one line**');
  const long = lyricRows({ current: '測試中文歌詞'.repeat(50), previous: 'Short', next: 'next' });
  assert.equal(long.split('\n').length, 3); assert.ok(long.includes('…'));
  assert.ok(!long.includes('   ')); assert.ok(!long.includes('```'));
  assert.ok(displayWidth(long.split('\n')[1]) <= PANEL_COLUMNS + 6);
  assert.ok(!lyricRows({ current: '```\n@everyone' }).includes('```'));
});
test('short progress and clock use adjacent inline fields instead of a wrapping padded line', () => {
  for (const fraction of [0, 0.5, 1]) {
    const row = progressRow(fraction);
    assert.equal(row.length, 12); assert.ok(!row.includes(' '));
    assert.equal([...row].filter(char => char === '●').length, 1);
  }
  assert.ok(progressRow(1).endsWith('●'));
  const data = panelPayload(session()).embeds[0].toJSON();
  assert.equal(data.fields[0].inline, true); assert.equal(data.fields[1].inline, true);
  assert.ok(data.fields[1].value.includes('00:05 / 03:20'));
  assert.ok(!JSON.stringify(data).includes('```'));
});
test('no empty lyric area; missing lyrics is one line and real lyrics use the same player', () => {
  const s = session(); const field = () => panelPayload(s).embeds[0].toJSON().fields?.find(item => item.name === '🎤 歌詞');
  s.lyricsStatus = 'loading'; assert.equal(field(), undefined);
  s.lyricsStatus = 'missing'; assert.equal(field().value, '目前沒有同步歌詞');
  s.lyricsStatus = 'unavailable'; assert.equal(field().value, '暫時無法取得歌詞');
  s.lyricsStatus = 'ready'; s.lyrics = Object.assign([{ time: 10, text: 'Later' }], { source: 'LRCLIB' });
  assert.equal(field().value, '**▶ Later**');
  s.resource.playbackDuration = 10000;
  assert.equal(field().value, '**▶ Later**'); assert.equal(field().inline, false);
  assert.equal(field().name, '🎤 歌詞');
  const embed = panelPayload(s).embeds[0].toJSON();
  assert.match(embed.fields.at(-1).value, /音量.*重複.*待播/);
  assert.equal(embed.fields.at(-2).name, '🎤 歌詞');
  assert.ok(!embed.description.includes('音量'));
});
test('stop and leave retains its explicit text while transport stays compact', () => {
  const payload = panelPayload(session());
  const rows = payload.components.map(row => row.toJSON().components);
  assert.equal(rows[0].length, 5);
  const stop = rows.flat().find(button => button.custom_id === 'music:leave');
  assert.equal(stop.label, '停止並離開');
  assert.equal(stop.style, 4);
});
