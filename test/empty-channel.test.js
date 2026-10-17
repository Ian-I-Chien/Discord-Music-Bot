import test from 'node:test';
import assert from 'node:assert/strict';
import { watchEmptyChannel, EMPTY_CHANNEL_TIMEOUT_MS } from '../src/empty-channel.js';

function setup() {
  let now = 0, next = 0, leaves = 0;
  const timers = new Map();
  const session = { current: {title:'Playing'}, queue:[{title:'Next'}], voiceChannel:{members:[{user:{bot:true}}]} };
  const watcher = watchEmptyChannel(session, {
    dispose(s) { assert.equal(s,session); leaves++; s.closed=true; watcher.close(); s.current=null; s.queue=[]; },
    schedule(fn,ms) { const id=++next; timers.set(id,{fn,at:now+ms}); return id; },
    cancel(id) { timers.delete(id); },
  });
  return { session, watcher, timers, get leaves(){return leaves;},
    advance(ms) { now+=ms; for(const [id,timer] of [...timers]) if(timer.at<=now){timers.delete(id);timer.fn();} },
    join() {session.voiceChannel.members.push({user:{bot:false}});},
    empty() {session.voiceChannel.members=[{user:{bot:true}}];},
  };
}
test('empty voice stops playback and queue only after the full three minutes',()=>{
  assert.equal(EMPTY_CHANNEL_TIMEOUT_MS,180000);
  const s=setup();s.watcher.refresh();s.advance(179999);
  assert.equal(s.leaves,0);assert.equal(s.session.current.title,'Playing');assert.equal(s.session.queue.length,1);
  s.advance(1);assert.equal(s.leaves,1);assert.equal(s.session.current,null);assert.equal(s.session.queue.length,0);
});
test('human return cancels the timer and another departure starts a new grace period',()=>{
  const s=setup();s.watcher.refresh();s.advance(120000);s.join();s.watcher.refresh();
  s.advance(180000);assert.equal(s.leaves,0);assert.equal(s.timers.size,0);
  s.empty();s.watcher.refresh();s.advance(179999);assert.equal(s.leaves,0);
  s.advance(1);assert.equal(s.leaves,1);
});
test('bot arrivals and repeated voice updates do not reset the countdown',()=>{
  const s=setup();s.watcher.refresh();s.advance(120000);
  s.session.voiceChannel.members.push({user:{bot:true}});s.watcher.refresh();s.watcher.refresh();
  assert.equal(s.timers.size,1);s.advance(60000);assert.equal(s.leaves,1);
});
test('the timer checks occupancy again and cleanup prevents delayed disposal',()=>{
  const s=setup();s.watcher.refresh();s.join();s.advance(180000);assert.equal(s.leaves,0);
  s.empty();s.watcher.refresh();s.watcher.close();s.watcher.refresh();s.advance(180000);assert.equal(s.leaves,0);
});
test('each guild has its own countdown and occupied channels do not start one',()=>{
  const a=setup(),b=setup();a.watcher.refresh();b.join();b.watcher.refresh();
  assert.equal(b.timers.size,0);a.advance(180000);b.advance(180000);
  assert.equal(a.leaves,1);assert.equal(b.leaves,0);
});
