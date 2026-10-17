import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueTrack, setVolume, MAX_QUEUE } from '../src/controls.js';
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
