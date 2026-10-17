import test from 'node:test';
import assert from 'node:assert/strict';
import { sendVoiceLeave } from '../src/voice-state.js';
test('stale voice membership can be cleared without a playback session', async () => {
  let payload,resolve;
  const pending=new Promise(r=>{resolve=r;});
  const call=sendVoiceLeave({id:'guild',shard:{async send(data){payload=data; await pending;}}});
  assert.deepEqual(payload,{op:4,d:{guild_id:'guild',channel_id:null,self_mute:false,self_deaf:false}});
  let complete=false; call.then(()=>{complete=true;});
  await Promise.resolve(); assert.equal(complete,false); resolve(); await call; assert.equal(complete,true);
  await sendVoiceLeave(undefined);
});
