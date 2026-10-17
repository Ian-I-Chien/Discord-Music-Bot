import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createAudioResource, StreamType } from '@discordjs/voice';
import { resolveTrack } from './source.js';

export async function openRecoveryAudio(s, track, offset, signal, attempt) {
  // First reconnect to the current URL; later attempts refresh expired source URLs.
  const source = attempt === 1 ? track : await resolveTrack(track.page, { signal });
  signal.throwIfAborted();
  const child = spawn('ffmpeg', ['-nostdin', '-loglevel', 'error', '-rw_timeout', '3000000',
    '-ss', String(offset), '-i', source.url, '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  // FFmpeg errors can contain signed URLs; keep those out of logs.
  child.stderr.resume();
  const cleanup = () => { child.stdout.destroy(); if (child.exitCode === null) child.kill('SIGKILL'); };
  signal.addEventListener('abort', cleanup, { once: true });
  child.once('close', () => signal.removeEventListener('abort', cleanup));
  child.on('error', () => child.stdout.destroy(new Error('Recovery decoder could not start')));
  child.on('exit', code => { if (code && !signal.aborted) child.stdout.destroy(new Error('Recovery decoder failed')); });
  try {
    await once(child.stdout, 'readable', { signal });
    signal.throwIfAborted();
    if (!child.stdout.readableLength) throw new Error('Recovery source returned no audio');
    // Attempt timeout ends once audio is ready; do not abort healthy playback later.
    signal.removeEventListener('abort', cleanup);
    const resource = createAudioResource(child.stdout, { inputType: StreamType.Raw, inlineVolume: true });
    resource.volume.setVolume((s.volume ?? 50) / 100);
    resource.encoder?.setBitrate(192000);
    return { resource, cleanup };
  } catch (error) { cleanup(); throw error; }
}
