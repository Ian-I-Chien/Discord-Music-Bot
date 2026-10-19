// Shuffle metadata only. Audio resolution remains in playback and prefetch.
export async function* shuffledPlaylist(entries, limit, { signal, random = Math.random, report = console.warn } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('無效的歌單載入上限。');
  const items = [];
  signal?.throwIfAborted();
  try {
    for await (const item of entries(signal)) {
      signal?.throwIfAborted();
      items.push(item);
      if (items.length >= limit) break;
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (!items.length) throw error;
    report('隨機歌單部分載入失敗：', error.message);
  }
  signal?.throwIfAborted();
  // Fisher–Yates preserves each entry, including intentional duplicates.
  for (let index = items.length - 1; index > 0; index--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('無效的隨機值。');
    const chosen = Math.floor(value * (index + 1));
    [items[index], items[chosen]] = [items[chosen], items[index]];
  }
  for (const item of items) {
    signal?.throwIfAborted();
    yield item;
  }
}
