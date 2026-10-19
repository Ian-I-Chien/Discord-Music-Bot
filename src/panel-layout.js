export const PANEL_COLUMNS = 54;
const wide = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}]/u;
export function displayWidth(text) {
  return [...text].reduce((width, char) => width + (char === '\u200b' ? 0 : wide.test(char) ? 2 : 1), 0);
}
function fit(text, columns) {
  const characters = []; let width = 0;
  const clean = String(text || '').replace(/[\r\n\x00-\x1f]/g, ' ').replace(/`/g, 'ˋ').replace(/@/g, '@\u200b');
  for (const char of clean) {
    const size = displayWidth(char);
    if (width + size > columns) {
      while (width >= columns) width -= displayWidth(characters.pop());
      characters.push('…'); width++;
      break;
    }
    characters.push(char); width += size;
  }
  return characters.join('') + ' '.repeat(Math.max(0, columns - width)) + '\u200b';
}
export function lyricRows(window) {
  // Non-empty invisible markers preserve three rows even during an instrumental.
  return [fit(window?.previous ? `  ${window.previous}` : '', PANEL_COLUMNS), fit(window?.current ? `▶ ${window.current}` : '', PANEL_COLUMNS), fit(window?.next ? `  ${window.next}` : '', PANEL_COLUMNS)].join('\n');
}
export function progressRow(fraction, clock) {
  const right = String(clock).padStart(19);
  const width = Math.max(1, PANEL_COLUMNS - 2 - right.length);
  const position = Math.floor(Math.max(0, Math.min(1, fraction)) * (width - 1));
  return '━'.repeat(position) + '●' + '─'.repeat(width - position - 1) + '  ' + right;
}
