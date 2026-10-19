import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
export const commands = [
  new SlashCommandBuilder().setName('repeat').setDescription('設定重複播放模式')
    .addStringOption(o => o.setName('mode').setDescription('關閉、單曲或清單重複').setRequired(true)
      .addChoices({ name: '關閉', value: 'off' }, { name: '單曲', value: 'track' }, { name: '清單', value: 'queue' })),
  new SlashCommandBuilder().setName('play').setDescription('播放 YouTube，或用 Spotify 連結配歌')
    .addStringOption(o => o.setName('link').setDescription('YouTube／Spotify 歌曲、歌單、專輯或歌名').setRequired(true)),
  new SlashCommandBuilder().setName('playnext').setDescription('插播單曲：目前歌曲結束後優先播放')
    .addStringOption(o => o.setName('link').setDescription('YouTube 單曲、Spotify 歌曲／清單或歌名').setRequired(true)),
  new SlashCommandBuilder().setName('random-play').setDescription('打亂歌單，從隨機一首開始播放')
    .addStringOption(o => o.setName('link').setDescription('YouTube 歌單／Mix 或 Spotify 歌單／專輯').setRequired(true)),
  new SlashCommandBuilder().setName('volume').setDescription('調整播放音量')
    .addIntegerOption(o => o.setName('percent').setDescription('音量 0–100，0 為靜音').setMinValue(0).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName('now-playing').setDescription('切回目前正在播放的歌曲面板'),
  ...[['pause', '暫停'], ['resume', '繼續播放'], ['previous', '播放上一首歌曲'], ['skip', '跳過目前歌曲'], ['queue', '查看播放佇列'], ['leave', '清空佇列並離開']]
    .map(([name, text]) => new SlashCommandBuilder().setName(name).setDescription(text)),
].map(command => command.setContexts(InteractionContextType.Guild).toJSON());
export async function registerCommands(application) {
  await application.commands.set(commands);
  console.log('全域指令已註冊。');
}
