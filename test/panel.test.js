import test from 'node:test';
import assert from 'node:assert/strict';
import { panelPayload, time, syncPanel, queuePagination, queuePayload, syncQueue } from '../src/panel.js';
function session() { return { hasStarted: true, player: { state: { status: 'playing' } }, resource: { playbackDuration: 65000 }, current: { title: 'Test song', author: 'Artist', duration: 245, page: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }, queue: Array.from({length:5}, (_, n) => ({title:`Song ${n}`})) }; }
test('panel contains linked track, thumbnail, duration, next tracks and controls', () => {
  const data = panelPayload(session(), 42);
  const now = data.embeds[0].toJSON();
  assert.match(now.description, /01:05/); assert.match(now.description, /04:05/);
  assert.match(now.description, /https:\/\/www.youtube.com/); assert.ok(now.thumbnail.url);
  assert.equal(data.embeds.length,1);
  assert.equal(data.components.length,1);
  assert.ok(data.components[0].toJSON().components.some(c=>c.custom_id==='music:queue'));
  assert.doesNotMatch(now.description,/Song 4/);
  assert.equal(data.components[0].toJSON().components[1].custom_id,'music:toggle-pause');
  assert.deepEqual(data.allowedMentions.parse, []);
});
test('paused and ended panels reflect state and disable old controls', () => {
  const s=session(); s.player.state.status='paused';
  assert.equal(panelPayload(s).components[0].toJSON().components[1].custom_id,'music:toggle-pause');
  s.closed=true;
  assert.ok(panelPayload(s).components[0].toJSON().components.every(c=>c.disabled));
  assert.equal(time(NaN),'--:--'); assert.equal(time(3601),'1:00:01');
});

test('loading publishes no prompts; playback publishes only one clean panel', async () => {
  const s=session(); s.hasStarted=false; s.loading=true; s.notice='internal import details';
  let sends=0, edits=0;
  const message={ async edit(data) { edits++; assert.equal(data.content,''); } };
  s.text={ async send(data) { sends++; assert.equal(data.content,''); assert.equal(data.embeds[0].toJSON().fields[0].value,'🔊 **50%**'); return message; } };
  await syncPanel(s); assert.equal(sends,0);
  s.hasStarted=true; s.loading=false;
  await syncPanel(s); assert.equal(sends,1);
  await syncPanel(s); assert.equal(sends,1); assert.equal(edits,0);
});

test('private queue pages cover all tracks without affecting the public player', () => {
  const s=session(); s.queue=Array.from({length:300},(_,n)=>({title:`Track ${n+1}`,author:'Artist',duration:245}));
  let data=queuePayload(s,0);
  assert.equal(data.embeds.length,1);
  assert.match(data.embeds[0].toJSON().description,/Track 8/);
  assert.doesNotMatch(data.embeds[0].toJSON().description,/Track 9/);
  assert.equal(data.components[0].toJSON().components[0].disabled,true);
  assert.equal(data.components[0].toJSON().components[2].custom_id,'music:queue-page:1');
  data=queuePayload(s,1);
  assert.match(data.embeds[0].toJSON().description,/Track 9/);
  assert.match(data.embeds[0].toJSON().footer.text,/第 2 \/ 38 頁/);
  data=queuePayload(s,1000);
  assert.match(data.embeds[0].toJSON().description,/Track 300/);
  assert.equal(data.components[0].toJSON().components[2].disabled,true);
  assert.equal(s.queuePage,undefined);
  s.queue=s.queue.slice(0,2); data=queuePayload(s,20);
  assert.match(data.embeds[0].toJSON().footer.text,/第 1 \/ 1 頁/);
  s.closed=true; assert.ok(queuePayload(s).components.flatMap(r=>r.toJSON().components).every(c=>c.disabled));
  assert.equal(panelPayload(s).embeds.length,1);
});
test('long queue titles and authors remain within Discord embed limits', () => {
  const s=session(); s.queue=Array.from({length:300},()=>({title:'_*'.repeat(200),author:'_*'.repeat(200),page:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}));
  assert.ok(queuePayload(s).embeds[0].toJSON().description.length<=4096);
});

test('rapid panel refreshes coalesce while a Discord edit is pending', async () => {
  const s=session(); let edits=0, release;
  s.panel={ async edit() { edits++; if(edits===1) await new Promise(resolve=>{release=resolve;}); } };
  const first=syncPanel(s); await Promise.resolve();
  for(let n=0;n<50;n++) { s.resource.playbackDuration+=1000; syncPanel(s); }
  assert.equal(edits,1); release(); await first;
  assert.equal(edits,2); assert.equal(s.panelWork,null);
});

test('queue and now-playing replace the same message without duplicate cards', async () => {
  const s=session(); let sends=0,edits=0,last;
  s.text={async send(payload){sends++;last=payload;return {async edit(payload){edits++;last=payload;return this;}};}};
  await syncQueue(s); assert.equal(sends,0);
  await syncPanel(s); assert.equal(sends,1);
  await syncQueue(s,0); assert.equal(sends,1);assert.equal(edits,1);
  assert.match(last.embeds[0].toJSON().title,/待播清單/);
  assert.ok(last.components[0].toJSON().components.some(c=>c.custom_id==='music:now-playing'));
  await syncPanel(s);assert.equal(edits,1);
  s.queue.shift();await syncPanel(s);assert.equal(edits,2);
  s.panelView='now';await syncPanel(s);assert.equal(edits,3);assert.equal(sends,1);
  assert.match(last.embeds[0].toJSON().title,/正在播放/);
  s.closed=true;await syncPanel(s);assert.ok(last.components[0].toJSON().components.every(c=>c.disabled));
});

test('volume is visible by default in player, idle and queue views', async () => {
  const s=session(); s.volume=30;
  for(const payload of [panelPayload(s),queuePayload(s)]) {
    assert.equal(payload.embeds[0].toJSON().fields[0].name,'音量');
    assert.match(payload.embeds[0].toJSON().fields[0].value,/30%/);
  }
  s.current=null;s.hasStarted=false;s.showIdlePanel=true;
  let posted;
  s.text={async send(p){posted=p;return {async edit(){}};}};
  await syncPanel(s);assert.equal(posted.embeds[0].toJSON().title,'音樂播放器');
  assert.match(posted.embeds[0].toJSON().fields[0].value,/30%/);
});


test('explicit queue opens while the next audio source is loading', async () => {
  const s = session(); s.hasStarted = false; s.current = null; s.loading = true;
  let payload;
  s.panel = { async edit(value) { payload = value; } };
  await syncQueue(s, 0);
  assert.match(payload.embeds[0].toJSON().title, /待播清單/);
  assert.match(payload.embeds[0].toJSON().description, /Song 0/);
});

test('queue reports failed edits instead of silently acknowledging success', async () => {
  const s = session();
  s.panel = { async edit() { throw new Error('Missing Permissions'); } };
  await assert.rejects(syncQueue(s, 0), /無法更新播放面板/);
  s.panel = { async edit() {} };
  await syncQueue(s, 0);
  assert.equal(s.panelError, null);
});
