import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import opus from '@discordjs/opus';
import { openRecoveryAudio } from '../src/recovery-audio.js';

test('reconnection seeks to the saved time and keeps the requested volume', async () => {
  // Four-second WAV: silence for two seconds, then a tone. Seeking must skip the silence.
  const pcm = Buffer.alloc(4 * 48000 * 4), header = Buffer.alloc(44);
  for (let n = 2 * 48000; n < 4 * 48000; n++) {
    const value = Math.round(8000 * Math.sin(2 * Math.PI * 440 * n / 48000));
    pcm.writeInt16LE(value, n * 4); pcm.writeInt16LE(value, n * 4 + 2);
  }
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48000, 24); header.writeUInt32LE(192000, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40); const wav = Buffer.concat([header, pcm]);
  const server = http.createServer((request, response) => {
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    response.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1, ...(range ? {'Content-Range': `bytes ${start}-${end}/${wav.length}`} : {}) });
    response.end(wav.subarray(start, end + 1));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let audio;
  try {
    audio = await openRecoveryAudio({volume:50}, {url:`http://127.0.0.1:${server.address().port}/audio.wav`}, 2, AbortSignal.timeout(5000), 1);
    const decoder = new opus.OpusEncoder(48000, 2);
    let frames = 0, energy = 0, count = 0;
    for await (const packet of audio.resource.playStream) {
      const decoded = decoder.decode(packet); frames++;
      if (frames <= 10) for (let i=0; i<decoded.length; i+=2) { energy += decoded.readInt16LE(i) ** 2; count++; }
    }
    assert.ok(frames >= 95 && frames <= 105, `Expected two seconds, got ${frames} frames`);
    const rms = Math.sqrt(energy / count);
    assert.ok(rms > 2000 && rms < 3500, `Expected audible half-volume tone immediately, got ${rms}`);
  } finally { audio?.cleanup(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
