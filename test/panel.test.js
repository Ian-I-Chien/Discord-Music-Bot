import test from 'node:test';
import assert from 'node:assert/strict';
import { panelPayload, time } from '../src/panel.js';
function session() { return { player: { state: { status: 'playing' } }, resource: { playbackDuration: 65000 }, current: { title: 'Test song', author: 'Artist', duration: 245, page: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }, queue: Array.from({length:5}, (_, n) => ({title:`Song ${n}`})) }; }
test('panel contains linked track, thumbnail, duration, next tracks and controls', () => {
  const data = panelPayload(session(), 42);
  const now = data.embeds[0].toJSON();
  assert.match(now.description, /01:05/); assert.match(now.description, /04:05/);
  assert.match(now.description, /https:\/\/www.youtube.com/); assert.ok(now.thumbnail.url);
  assert.match(data.embeds[1].toJSON().description, /還有 2 首/);
  assert.equal(data.components[0].toJSON().components[0].custom_id,'music:pause');
  assert.deepEqual(data.allowedMentions.parse, []);
});
test('paused and ended panels reflect state and disable old controls', () => {
  const s=session(); s.player.state.status='paused';
  assert.equal(panelPayload(s).components[0].toJSON().components[0].custom_id,'music:resume');
  s.closed=true;
  assert.ok(panelPayload(s).components[0].toJSON().components.every(c=>c.disabled));
  assert.equal(time(NaN),'--:--'); assert.equal(time(3601),'1:00:01');
});
