import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { finishQuietReply, waitForPlayback } from '../src/interaction-reply.js';
test('thinking stays visible until actual playback starts, then listeners are removed', async () => {
  const s = { player: new EventEmitter(), queue: [], loading: true };
  let finished = false;
  const waiting = waitForPlayback(s).then(() => { finished = true; });
  s.current = {}; s.loading = false; s.player.emit('stateChange');
  await Promise.resolve(); assert.equal(finished, false);
  s.hasStarted = true; s.player.emit('stateChange');
  await waiting; assert.equal(finished, true); assert.equal(s.player.listenerCount('stateChange'), 0);
});
test('failed, cancelled and timed out playback settle the deferred request', async () => {
  for (const state of [{ closed: true }, {}]) {
    const s = { player: new EventEmitter(), queue: [], ...state };
    await assert.rejects(waitForPlayback(s));
    assert.equal(s.player.listenerCount('stateChange'), 0);
  }
  const s = { player: new EventEmitter(), queue: [], loading: true };
  await assert.rejects(waitForPlayback(s, 1), /逾時/);
  assert.equal(s.player.listenerCount('stateChange'), 0);
});
test('quiet reply completes deferred response before deletion', async () => {
  const calls=[];let release;
  const i={async editReply(body){calls.push(['edit',body]);await new Promise(r=>release=r);},async deleteReply(){calls.push(['delete']);}};
  const task=finishQuietReply(i);assert.equal(calls.length,1);
  assert.equal(calls[0][1].content,'\u200b');
  assert.deepEqual(calls[0][1].allowedMentions.parse,[]);
  release();await task;assert.deepEqual(calls.map(c=>c[0]),['edit','delete']);
});
test('failed completion is propagated and does not delete an unfinished reply', async () => {
  let deleted=false;
  await assert.rejects(finishQuietReply({async editReply(){throw new Error('network');},async deleteReply(){deleted=true;}}),/network/);
  assert.equal(deleted,false);
});
