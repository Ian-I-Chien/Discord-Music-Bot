import test from 'node:test';
import assert from 'node:assert/strict';
import { syncChannelStatus, channelStatusText } from '../src/channel-status.js';
function session(put) { return { channelId: '123', voiceChannel: {client:{rest:{put}}}, current:{title:'Song'}, hasStarted:true, player:{state:{status:'playing'}} }; }
test('channel status follows song, pause, resume and exit without progress edits', async () => {
  const calls=[]; const s=session(async (route, data)=>calls.push([route,data.body.status]));
  await syncChannelStatus(s); await syncChannelStatus(s);
  assert.deepEqual(calls,[['/channels/123/voice-status','🎵 正在播放｜Song']]);
  s.player.state.status='paused'; await syncChannelStatus(s);
  assert.equal(calls.at(-1)[1],'⏸️ 已暫停｜Song');
  s.player.state.status='playing'; await syncChannelStatus(s);
  s.current={title:'Next'};await syncChannelStatus(s);assert.equal(calls.at(-1)[1],'🎵 正在播放｜Next');
  s.closed=true;await syncChannelStatus(s);assert.equal(calls.at(-1)[1],null);
});
test('idle does not overwrite existing status; failures do not break playback or retry each second', async () => {
  let calls=0; const s=session(async()=>{calls++;throw new Error('Missing Permissions');});
  s.hasStarted=false; await syncChannelStatus(s);assert.equal(calls,0);
  s.hasStarted=true;await syncChannelStatus(s);await syncChannelStatus(s);assert.equal(calls,1);
  assert.equal(s.current.title,'Song');
  s.current.title='x'.repeat(600); assert.equal(channelStatusText(s).length,500);
});
test('leaving during a pending status update clears it after the update completes', async () => {
  let release; const calls=[];
  const s=session(async(route,data)=>{calls.push(data.body.status);if(calls.length===1)await new Promise(r=>release=r);});
  const task=syncChannelStatus(s);await Promise.resolve();
  s.closed=true;syncChannelStatus(s);release();await task;
  assert.deepEqual(calls,['🎵 正在播放｜Song',null]);
});
