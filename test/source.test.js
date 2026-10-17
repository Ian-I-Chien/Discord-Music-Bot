import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuery, playlistUrl } from '../src/source.js';
test('search and canonical video URLs', () => {
  assert.equal(normalizeQuery('artist song'), 'ytsearch1:artist song');
  assert.equal(normalizeQuery('https://youtu.be/dQw4w9WgXcQ?t=1'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(normalizeQuery('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=abc'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});
test('reject arbitrary fetch targets, unsupported schemes and playlists', () => {
  for (const query of ['https://localhost/a', 'file:///etc/passwd', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com/playlist?list=x', '', '--help']) {
    if (query === '--help') assert.equal(normalizeQuery(query), 'ytsearch1:--help'); else assert.throws(() => normalizeQuery(query));
  }
});

test('playlist links preserve lists instead of silently selecting only one video', () => {
  assert.equal(playlistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123'), 'https://www.youtube.com/playlist?list=PLabc123');
  assert.equal(playlistUrl('https://www.youtube.com/playlist?list=PLabc123'), 'https://www.youtube.com/playlist?list=PLabc123');
  assert.equal(playlistUrl('https://evil.test/?list=PLabc123'),null);
  assert.equal(playlistUrl('https://www.youtube.com/watch?v=9WEYFqCUze8&list=RD9WEYFqCUze8&start_radio=1'), 'https://www.youtube.com/watch?v=9WEYFqCUze8&list=RD9WEYFqCUze8');
});
