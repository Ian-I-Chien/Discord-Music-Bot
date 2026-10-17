import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverPlayback, cancelRecovery, endedEarly, playbackSeconds } from '../src/recovery.js';
function session() {
  return { current: {title:'Song', duration:200}, hasStarted:true,
    playbackOffset:10, resource:{playbackDuration:25000}, queue:[{title:'Next'}], volume:50,
    player:{state:{status:'playing'}, stop(){this.state.status='idle';}, play(resource){this.state={status:'playing',resource};}, pause(){this.state.status='paused';}} };
}
test('recovery retries the same track at its offset and leaves the queue intact', async () => {
  const s=session(), queue=s.queue, track=s.current;let tries=0,finished=0;
  await recoverPlayback(s,{open:async(t,offset,signal,n)=>{
    assert.equal(t,track);assert.equal(offset,35);assert.equal(n,++tries);
    if(n<3)throw new Error('network');return {resource:{playbackDuration:0},cleanup(){}};
  },finish(){finished++;},update(){},waitPlaying:async()=>{}});
  assert.equal(tries,3);assert.equal(finished,0);assert.equal(s.queue,queue);
  assert.equal(playbackSeconds(s),35);assert.equal(s.recovery,null);
});
test('three failed attempts advance exactly once', async()=>{
  const s=session();let attempts=0,finished=0;
  await recoverPlayback(s,{open:async()=>{attempts++;throw new Error('network');},finish(){finished++;},update(){}});
  assert.equal(attempts,3);assert.equal(finished,1);
});
test('the whole recovery budget bounds blocked connections', async()=>{
  const s=session();let finished=0, attempts=0;const start=Date.now();
  await recoverPlayback(s,{budget:90,open:async(t,o,signal)=>{attempts++;await new Promise((r,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  });},finish(){finished++;},update(){}});
  assert.ok(Date.now()-start<500);assert.ok(attempts<=3);assert.equal(finished,1);
});
test('skip or leave cancels pending recovery without advancing a second time',async()=>{
  const s=session();let finished=0,started;
  const ready=new Promise(r=>started=r);
  const task=recoverPlayback(s,{open:async(t,o,signal)=>{
    started();await new Promise((r,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  },finish(){finished++;},update(){}});
  await ready;cancelRecovery(s);await task;assert.equal(finished,0);assert.equal(s.recovery,null);
});
test('resource must actually start; failed resources are cleaned before retry',async()=>{
  const s=session();let tries=0,cleaned=0,waits=0;
  await recoverPlayback(s,{open:async()=>{tries++;return {resource:{playbackDuration:0},cleanup(){cleaned++;}};},
    waitPlaying:async()=>{if(++waits<3)throw new Error('decoder');},finish(){assert.fail('should recover');},update(){}});
  assert.equal(tries,3);assert.equal(cleaned,2);
});
test('normal endings do not look premature and paused recovery stays paused',async()=>{
  const s=session();assert.equal(endedEarly(s),true);
  s.resource.playbackDuration=189000;assert.equal(endedEarly(s),false);
  s.player.state.status='paused';
  await recoverPlayback(s,{open:async()=>({resource:{playbackDuration:0},cleanup(){}}),waitPlaying:async()=>{},finish(){},update(){}});
  assert.equal(s.player.state.status,'paused');
});
