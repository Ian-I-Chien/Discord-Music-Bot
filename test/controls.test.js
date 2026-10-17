import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueTrack, setVolume, MAX_QUEUE, playlistImportLimit, applyVolumeCommand } from '../src/controls.js';
import { commands } from '../src/commands.js';
test('playnext prioritizes one track without interrupting current playback', () => {
  const s={queue:[{title:'A'},{title:'B'}],current:{title:'Playing'},queuePage:3};
  enqueueTrack(s,{title:'Next'},true);
  assert.deepEqual(s.queue.map(t=>t.title),['Next','A','B']);
  assert.equal(s.current.title,'Playing'); assert.equal(s.queuePage,0);
  s.queue=Array.from({length:MAX_QUEUE},()=>({}));
  assert.throws(()=>enqueueTrack(s,{},true)); assert.equal(s.queue.length,MAX_QUEUE);
});
test('volume applies live and persists for subsequent resources', () => {
  let value;
  const s={resource:{volume:{setVolume(v){value=v;}}}};
  setVolume(s,35); assert.equal(s.volume,35); assert.equal(value,0.35);
  setVolume(s,0); assert.equal(value,0);
  setVolume(s,100); assert.equal(value,1);
  for(const invalid of [-1,101,1.5,NaN]) assert.throws(()=>setVolume(s,invalid));
  assert.equal(s.volume,100);
});
test('volume and playnext slash commands have required bounded options', () => {
  const option=commands.find(c=>c.name==='volume').options[0];
  assert.equal(option.min_value,0); assert.equal(option.max_value,100); assert.equal(option.required,true);
  assert.equal(commands.find(c=>c.name==='playnext').options[0].name,'link');
});

test('Mix imports only twenty recommendations within the shared queue capacity',()=>{
 const mix='https://www.youtube.com/watch?v=h7MYJghRWt0&list=RDh7MYJghRWt0';
 assert.equal(playlistImportLimit(mix,0),20);
 assert.equal(playlistImportLimit(mix,295),5);
 assert.equal(playlistImportLimit(mix,300),0);
 assert.equal(playlistImportLimit('https://www.youtube.com/playlist?list=PLabc',0),300);
});

test('volume joins once when disconnected and applies before playback', async()=>{
 let joins=0; const state={queue:[],current:null,loading:false};
 const connect=async()=>{joins++;return state;};
 assert.equal(await applyVolumeCommand(null,30,connect),state);
 assert.equal(joins,1);assert.equal(state.volume,30);assert.equal(state.showIdlePanel,true);
 let applied;state.current={title:'Playing'};state.resource={volume:{setVolume(v){applied=v;}}};
 await applyVolumeCommand(state,55,connect);assert.equal(joins,1);assert.equal(applied,0.55);
 assert.equal(state.showIdlePanel,false);
 await assert.rejects(()=>applyVolumeCommand(null,101,connect));assert.equal(joins,1);
});

test('pause button toggles actual state even before the panel refreshes', async () => {
  const { togglePause } = await import('../src/controls.js');
  const s = { current: {}, player: { state: { status: 'playing' }, pause() { this.state.status = 'paused'; return true; }, unpause() { this.state.status = 'playing'; return true; } } };
  togglePause(s); assert.equal(s.player.state.status, 'paused');
  togglePause(s); assert.equal(s.player.state.status, 'playing');
  s.player.state.status = 'autopaused'; togglePause(s); assert.equal(s.player.state.status, 'playing');
  s.player.state.status = 'idle'; s.player.pause = () => false;
  assert.throws(() => togglePause(s, 'pause'), /無法暫停/);
});

test('previous replays history and preserves interrupted song and queue order', async () => {
  const { rememberTrack, previousTrack } = await import('../src/controls.js');
  const a = { title: 'A', page: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' };
  const b = { title: 'B', page: 'https://www.youtube.com/watch?v=9WEYFqCUze8' };
  const s = { current: a, hasStarted: true, queue: [{title:'C'}] };
  rememberTrack(s); s.current = b;
  s.player = { stop() { rememberTrack(s); s.current = null; } };
  previousTrack(s);
  assert.deepEqual(s.queue.map(t => t.title), ['A', 'B', 'C']);
  assert.equal(s.queue[0].query, a.page); assert.equal(s.history.length, 0);
  assert.throws(() => previousTrack(s), /沒有上一首/);
  s.history = [a]; s.loading = true;
  assert.throws(() => previousTrack(s), /正在載入/); assert.equal(s.history.length, 1);
  s.loading = false; s.queue = Array.from({length:MAX_QUEUE},()=>({}));
  assert.throws(() => previousTrack(s), /佇列已滿/); assert.equal(s.history.length, 1);
});
