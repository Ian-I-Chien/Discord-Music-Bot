import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuery } from '../src/source.js';
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
