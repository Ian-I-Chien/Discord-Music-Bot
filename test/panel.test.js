import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createAudioPlayer, createAudioResource, StreamType, NoSubscriberBehavior, AudioPlayerStatus, entersState } from '@discordjs/voice';
import { togglePause } from '../src/controls.js';
import { panelPayload, time, syncPanel, queuePagination, queuePayload, syncQueue, repostPanel, syncStartedTrackPanel, isActivePanel, refreshPlaybackProgress } from '../src/panel.js';
function session() { return { hasStarted: true, player: { state: { status: 'playing' } }, resource: { playbackDuration: 65000 }, current: { title: 'Test song', author: 'Artist', duration: 245, page: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }, queue: Array.from({length:5}, (_, n) => ({title:`Song ${n}`})) }; }
test('panel contains linked track, thumbnail, duration, next tracks and controls', () => {
  const data = panelPayload(session(), 42);
  const now = data.embeds[0].toJSON();
  assert.match(JSON.stringify(now), /01:05/); assert.match(JSON.stringify(now), /04:05/);
  assert.match(now.description, /https:\/\/www.youtube.com/); assert.ok(now.thumbnail.url);
  assert.equal(data.embeds.length,1);
  assert.equal(data.components.length,3);
  assert.ok(data.components[1].toJSON().components.some(c=>c.custom_id==='music:queue'));
  assert.doesNotMatch(now.description,/Song 4/);
  assert.equal(data.components[0].toJSON().components[2].custom_id,'music:toggle-pause');
  assert.deepEqual(data.allowedMentions.parse, []);
});
test('paused and ended panels reflect state and disable old controls', () => {
  const s=session(); s.player.state.status='paused';
  assert.equal(panelPayload(s).components[0].toJSON().components[2].custom_id,'music:toggle-pause');
  s.closed=true;
  assert.ok(panelPayload(s).components[0].toJSON().components.every(c=>c.disabled));
  assert.equal(time(NaN),'--:--'); assert.equal(time(3601),'1:00:01');
});

test('loading publishes no prompts; playback publishes only one clean panel', async () => {
  const s=session(); s.hasStarted=false; s.loading=true; s.notice='internal import details';
  let sends=0, edits=0;
  const message={ async edit(data) { edits++; assert.equal(data.content,''); } };
  s.text={ async send(data) { sends++; assert.equal(data.content,''); assert.match(data.embeds[0].toJSON().fields.at(-1).value,/音量 \*\*50%\*\* · 🔁 重複：關閉/); return message; } };
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
  assert.ok(last.components[0].toJSON().components.some(c=>c.custom_id==='music:player-view'));
  await syncPanel(s);assert.equal(edits,1);
  s.queue.shift();await syncPanel(s);assert.equal(edits,2);
  s.panelView='now';await syncPanel(s);assert.equal(edits,3);assert.equal(sends,1);
  assert.match(last.embeds[0].toJSON().title,/正在播放/);
  s.closed=true;await syncPanel(s);assert.ok(last.components[0].toJSON().components.every(c=>c.disabled));
});

test('volume is visible by default in player, idle and queue views', async () => {
  const s=session(); s.volume=30;
  for(const payload of [panelPayload(s),queuePayload(s)]) {
    assert.match(JSON.stringify(payload.embeds[0].toJSON()),/音量 \*\*30%\*\* · 🔁 重複：關閉/);
  }
  s.current=null;s.hasStarted=false;s.showIdlePanel=true;
  let posted;
  s.text={async send(p){posted=p;return {async edit(){}};}};
  await syncPanel(s);assert.equal(posted.embeds[0].toJSON().title,'音樂播放器');
  assert.match(posted.embeds[0].toJSON().fields.at(-1).value,/30%/);
});

test('slow progress edits do not starve queue button validation or view changes', async () => {
  const s=session();let release,edits=0,last;
  s.panel={id:'active',async edit(payload){edits++;last=payload;if(edits===1)await new Promise(r=>release=r);}};
  const pending=refreshPlaybackProgress(s);await Promise.resolve();
  const button=isActivePanel(s,'active').then(valid=>{assert.equal(valid,true);return syncQueue(s,0);});
  for(let n=0;n<20;n++){s.resource.playbackDuration+=1000;await refreshPlaybackProgress(s);}
  assert.equal(s.panelDirty,false);assert.equal(edits,1);
  release();await pending;await button;
  assert.equal(edits,2);assert.match(last.embeds[0].toJSON().title,/待播清單/);assert.equal(s.panelWork,null);
});

test('busy progress ticks do not delay switching a replacement to the active panel',async()=>{
  const s=session();let release,edits=0;
  s.panel={id:'old',async edit(){if(++edits===1)await new Promise(r=>release=r);}};
  s.text={async send(){return {id:'new',async edit(){}};}};
  const pending=refreshPlaybackProgress(s);await Promise.resolve();
  const posting=repostPanel(s);const button=isActivePanel(s,'new');
  for(let n=0;n<20;n++){s.resource.playbackDuration+=1000;await refreshPlaybackProgress(s);}
  release();await pending;await posting;
  assert.equal(await button,true);assert.equal(s.panel.id,'new');
});

test('progress refresh skips paused, idle and closed sessions',async()=>{
  const s=session();let edits=0;s.panel={async edit(){edits++;}};
  s.player.state.status='paused';await refreshPlaybackProgress(s);
  s.player.state.status='playing';s.current=null;await refreshPlaybackProgress(s);
  s.current={title:'Song'};s.closed=true;await refreshPlaybackProgress(s);
  assert.equal(edits,0);
});

test('real audio player pause and resume remain usable after a slow progress edit',async()=>{
  const s=session();let release,edits=0,last;
  s.player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Play}});
  s.resource=createAudioResource(Readable.from(Array.from({length:500},()=>Buffer.from([0xf8,0xff,0xfe]))),{inputType:StreamType.Opus});
  s.panel={id:'active',async edit(payload){last=payload;if(++edits===1)await new Promise(r=>release=r);}};
  try {
    s.player.play(s.resource);await entersState(s.player,AudioPlayerStatus.Playing,1000);
    const pending=refreshPlaybackProgress(s);await Promise.resolve();
    const pause=isActivePanel(s,'active').then(async valid=>{
      assert.equal(valid,true);togglePause(s);await syncPanel(s);
    });
    for(let n=0;n<20;n++)await refreshPlaybackProgress(s);
    release();await pending;await pause;
    assert.equal(s.player.state.status,AudioPlayerStatus.Paused);
    assert.equal(last.embeds[0].toJSON().title,'已暫停');
    assert.equal(last.components[0].toJSON().components[2].emoji.name,'▶️');
    assert.equal(await isActivePanel(s,'active'),true);
    togglePause(s);await entersState(s.player,AudioPlayerStatus.Playing,1000);await syncStartedTrackPanel(s);
    assert.equal(last.embeds[0].toJSON().title,'正在播放');
    assert.equal(last.components[0].toJSON().components[2].emoji.name,'⏸️');
    assert.equal(s.panel.id,'active');
  } finally {s.closed=true;s.player.stop(true);s.resource.playStream.destroy();}
});

test('a newly visible panel is valid after the pending send response arrives', async () => {
  const s=session();let release;
  const old={id:'old',async edit(){}};const fresh={id:'new',async edit(){}};
  s.panel=old;s.text={async send(){await new Promise(resolve=>release=resolve);return fresh;}};
  const posting=repostPanel(s);await Promise.resolve();
  assert.equal(s.panel.id,'old');
  let checked=false;
  const validation=isActivePanel(s,'new').then(value=>{checked=true;return value;});
  await Promise.resolve();assert.equal(checked,false);
  release();await posting;assert.equal(await validation,true);
  assert.equal(await isActivePanel(s,'old'),false);
});

test('panel validation waits through an already queued replacement', async () => {
  const s=session();let release,edits=0;
  s.panel={id:'old',async edit(){if (++edits === 1) await new Promise(resolve=>release=resolve);}};
  s.text={async send(){return {id:'new',async edit(){}};}};
  const editing=syncPanel(s);await Promise.resolve();
  const posting=repostPanel(s);
  const validation=isActivePanel(s,'new');
  release();await editing;await posting;
  assert.equal(await validation,true);
  s.closed=true;assert.equal(await isActivePanel(s,'new'),false);
  assert.equal(await isActivePanel(undefined,'new'),false);
});

test('a new track sends a replacement before deleting the active queue panel', async () => {
  const s=session();s.hasStarted=false;s.panelView='queue';const calls=[];
  const old={async delete(){calls.push('delete');}};
  const fresh={async edit(){calls.push('edit-new');}};
  s.panel=old;s.text={async send(payload){calls.push('send');assert.equal(payload.embeds[0].toJSON().title,'正在播放');return fresh;}};
  await syncStartedTrackPanel(s);
  assert.deepEqual(calls,['send','delete']);assert.equal(s.panel,fresh);assert.equal(s.hasStarted,true);
  // Resume and stream recovery do not create another message for the same track.
  await syncStartedTrackPanel(s);assert.deepEqual(calls,['send','delete']);
  s.current={...s.current,title:'Next song'};s.hasStarted=false;
  fresh.delete=async()=>calls.push('delete-new');
  await syncStartedTrackPanel(s);assert.deepEqual(calls,['send','delete','send','delete-new']);
});

test('track replacement send failures leave the original panel intact', async () => {
  const s=session();s.hasStarted=false;let deleted=false;
  const old={async delete(){deleted=true;}};s.panel=old;
  s.text={async send(){throw new Error('Network failure');}};
  await assert.rejects(syncStartedTrackPanel(s),/播放面板顯示失敗/);
  assert.equal(deleted,false);assert.equal(s.panel,old);assert.equal(s.panelRemovePrevious,false);
});

test('failed deletion disables stale controls without losing the replacement', async () => {
  const s=session();s.hasStarted=false;let retired;
  s.panel={async delete(){throw new Error('Missing access');},async edit(payload){retired=payload;}};
  const fresh={};s.text={async send(){return fresh;}};
  await syncStartedTrackPanel(s);
  assert.equal(s.panel,fresh);assert.deepEqual(retired,{components:[]});
});

test('a delayed transition does not repost a song that has already been replaced', async () => {
  const s=session();s.hasStarted=false;let release,sends=0;
  s.panelWork=new Promise(resolve=>release=resolve);
  s.text={async send(){sends++;return {};}};
  const task=syncStartedTrackPanel(s);
  s.current={title:'Newer song'};release();await task;
  assert.equal(sends,0);
});

test('now-playing posts a fresh panel, retires old controls and preserves playback', async () => {
  const s = session();
  const resource = s.resource, current = s.current, queue = s.queue;
  const calls = [];
  const old = { async edit(payload) { calls.push(['retire', payload]); } };
  const fresh = { async edit(payload) { calls.push(['update', payload]); } };
  s.panel = old; s.panelView = 'queue';
  s.text = { async send(payload) { calls.push(['send', payload]); return fresh; } };
  await repostPanel(s);
  assert.equal(s.panel, fresh);
  assert.equal(s.panelView, 'now');
  assert.deepEqual(calls.map(c => c[0]), ['send', 'retire']);
  assert.deepEqual(calls[1][1], { components: [] });
  assert.match(JSON.stringify(calls[0][1].embeds[0].toJSON()), /01:05/);
  assert.equal(s.resource, resource); assert.equal(s.current, current); assert.equal(s.queue, queue);
  s.resource.playbackDuration += 1000;
  await syncPanel(s);
  assert.equal(calls.at(-1)[0], 'update');
  await repostPanel(s);
  assert.equal(calls.filter(c => c[0] === 'send').length, 2);
});

test('failed replacement retains the existing panel and controls', async () => {
  const s = session(); let retired = false;
  const old = { async edit() { retired = true; } }; s.panel = old;
  s.text = { async send() { throw new Error('Network error'); } };
  await assert.rejects(repostPanel(s), /播放面板顯示失敗/);
  assert.equal(s.panel, old); assert.equal(retired, false); assert.equal(s.panelRepost, false);
});

test('replacement waits for pending edits and can show the current loading state', async () => {
  const s = session(); let release; const calls = [];
  s.panel = { async edit(payload) { calls.push(payload.components.length ? 'edit' : 'retire'); if (calls.length === 1) await new Promise(r => release = r); } };
  s.text = { async send() { calls.push('send'); return { async edit() {} }; } };
  const pending = syncPanel(s); await Promise.resolve();
  const replacement = repostPanel(s); assert.deepEqual(calls, ['edit']);
  release(); await pending; await replacement;
  assert.deepEqual(calls, ['edit', 'send', 'retire']);
  s.hasStarted = false; s.current = null; s.loading = true;
  await repostPanel(s); assert.equal(calls.filter(c => c === 'send').length, 2);
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
  s.panel = { async edit() { throw Object.assign(new Error('Missing Permissions'), {code:50013}); } };
  await assert.rejects(syncQueue(s, 0), /無法更新播放面板/);
  s.panel = { async edit() {} };
  await syncQueue(s, 0);
  assert.equal(s.panelError, null);
});


test('queue buttons have unique IDs even for empty and single-page queues', () => {
  for (const count of [0, 1, 8, 9, 16, 17]) {
    const s = session(); s.queue = Array.from({length:count},(_,n)=>({title:`Song ${n}`}));
    for (let page=0; page<Math.max(1, Math.ceil(count/8)); page++) {
      const buttons = queuePayload(s,page).components.flatMap(row=>row.toJSON().components);
      const ids=buttons.map(button=>button.custom_id);
      assert.equal(new Set(ids).size, ids.length, `count=${count} page=${page}`);
    }
  }
});

test('invalid panel payload errors do not falsely blame permissions', async () => {
  const s=session();
  s.panel={async edit(){throw Object.assign(new Error('Invalid Form Body'),{code:50035});}};
  await assert.rejects(syncQueue(s,0),error=> !error.message.includes('權限') && error.message.includes('更新失敗'));
});
