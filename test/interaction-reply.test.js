import test from 'node:test';
import assert from 'node:assert/strict';
import { finishQuietReply } from '../src/interaction-reply.js';
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
