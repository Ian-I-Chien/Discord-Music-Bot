import { escapeMarkdown } from 'discord.js';
export const PANEL_COLUMNS = 80;
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
  return escapeMarkdown(characters.join(''));
}
export function lyricRows(window, placeholder = '') {
  if (!window?.current) return placeholder;
  return [window.previous && fit(window.previous, PANEL_COLUMNS), `**▶ ${fit(window.current, PANEL_COLUMNS)}**`, window.next && fit(window.next, PANEL_COLUMNS)].filter(Boolean).join('\n');
}
export function progressRow(fraction) {
  const width = 12;
  const position = Math.floor(Math.max(0, Math.min(1, fraction)) * (width - 1));
  return '━'.repeat(position) + '●' + '─'.repeat(width - position - 1);
}
