import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import opus from '@discordjs/opus';
const { OpusEncoder } = opus;
import { createAudioResource, StreamType } from '@discordjs/voice';
test('volume audio pipeline encodes playable Opus and reduces signal level', async () => {
  const encoder=new OpusEncoder(48000,2);
  const pcm=Buffer.alloc(960*2*2);
  for(let n=0;n<960;n++) for(let c=0;c<2;c++) pcm.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*440*n/48000)),(n*2+c)*2);
  const packets=Array.from({length:20},()=>Buffer.from(encoder.encode(pcm,960)));
  async function level(volume) {
    const r=createAudioResource(Readable.from(packets.map(p=>Buffer.from(p))),{inputType:StreamType.Opus,inlineVolume:true});
    r.volume.setVolume(volume);
    r.encoder.setBitrate(192000);
    const decoder=new OpusEncoder(48000,2);
    let energy=0,count=0,frames=0;
    try {
      for await(const packet of r.playStream) {
        const out=decoder.decode(packet); frames++;
        if(frames>5) for(let i=0;i<out.length;i+=2){energy+=out.readInt16LE(i)**2;count++;}
      }
    } finally {}
    assert.equal(frames,20);
    return Math.sqrt(energy/count);
  }
  const full=await level(1),quiet=await level(0.25);
  assert.ok(full>1000); assert.ok(quiet/full>0.15 && quiet/full<0.4);
});
