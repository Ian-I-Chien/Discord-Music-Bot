import test from 'node:test';
import assert from 'node:assert/strict';
import { panelPayload, time, syncPanel, queuePagination } from '../src/panel.js';
function session() { return { hasStarted: true, player: { state: { status: 'playing' } }, resource: { playbackDuration: 65000 }, current: { title: 'Test song', author: 'Artist', duration: 245, page: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }, queue: Array.from({length:5}, (_, n) => ({title:`Song ${n}`})) }; }
test('panel contains linked track, thumbnail, duration, next tracks and controls', () => {
  const data = panelPayload(session(), 42);
  const now = data.embeds[0].toJSON();
  assert.match(now.description, /01:05/); assert.match(now.description, /04:05/);
  assert.match(now.description, /https:\/\/www.youtube.com/); assert.ok(now.thumbnail.url);
  assert.match(data.embeds[1].toJSON().description, /Song 4/);
  assert.match(data.embeds[1].toJSON().footer.text, /第 1 \/ 1 頁/);
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

test('loading publishes no prompts; playback publishes only one clean panel', async () => {
  const s=session(); s.hasStarted=false; s.loading=true; s.notice='internal import details';
  let sends=0, edits=0;
  const message={ async edit(data) { edits++; assert.equal(data.content,''); } };
  s.text={ async send(data) { sends++; assert.equal(data.content,''); assert.match(data.embeds[0].toJSON().footer.text,/音量 100%/); return message; } };
  await syncPanel(s); assert.equal(sends,0);
  s.hasStarted=true; s.loading=false;
  await syncPanel(s); assert.equal(sends,1);
  await syncPanel(s); assert.equal(sends,1); assert.equal(edits,1);
});

test('queue pagination covers all tracks and clamps when queue shrinks', () => {
  const s=session(); s.queue=Array.from({length:300},(_,n)=>({title:`Track ${n+1}`,author:'Artist',duration:245}));
  let data=panelPayload(s);
  assert.match(data.embeds[1].toJSON().description,/Track 8/);
  assert.doesNotMatch(data.embeds[1].toJSON().description,/Track 9/);
  assert.equal(data.components[1].toJSON().components[0].disabled,true);
  queuePagination(s,1); data=panelPayload(s);
  assert.match(data.embeds[1].toJSON().description,/Track 9/);
  assert.match(data.embeds[1].toJSON().footer.text,/第 2 \/ 38 頁/);
  queuePagination(s,1000); data=panelPayload(s);
  assert.match(data.embeds[1].toJSON().description,/Track 300/);
  assert.equal(data.components[1].toJSON().components[2].disabled,true);
  s.queue=s.queue.slice(0,2); panelPayload(s); assert.equal(s.queuePage,0);
  s.closed=true; assert.ok(panelPayload(s).components.flatMap(r=>r.toJSON().components).every(c=>c.disabled));
});
test('long queue titles and authors remain within Discord embed limits', () => {
  const s=session(); s.queue=Array.from({length:300},()=>({title:'_*'.repeat(200),author:'_*'.repeat(200),page:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}));
  const data=panelPayload(s); assert.ok(data.embeds[1].toJSON().description.length<=4096);
});

test('rapid panel refreshes coalesce while a Discord edit is pending', async () => {
  const s=session(); let edits=0, release;
  s.panel={ async edit() { edits++; if(edits===1) await new Promise(resolve=>{release=resolve;}); } };
  const first=syncPanel(s); await Promise.resolve();
  for(let n=0;n<50;n++) syncPanel(s);
  assert.equal(edits,1); release(); await first;
  assert.equal(edits,2); assert.equal(s.panelWork,null);
});
