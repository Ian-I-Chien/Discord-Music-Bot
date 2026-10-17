import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
export const commands = [
  new SlashCommandBuilder().setName('play').setDescription('加入你的語音頻道並播放 YouTube')
    .addStringOption(o => o.setName('link').setDescription('YouTube 連結或歌名').setRequired(true)),
  new SlashCommandBuilder().setName('playnext').setDescription('插播單曲：目前歌曲結束後優先播放')
    .addStringOption(o => o.setName('link').setDescription('YouTube 單曲連結或歌名').setRequired(true)),
  new SlashCommandBuilder().setName('volume').setDescription('調整播放音量')
    .addIntegerOption(o => o.setName('percent').setDescription('音量 0–100，0 為靜音').setMinValue(0).setMaxValue(100).setRequired(true)),
  ...[['pause', '暫停'], ['resume', '繼續播放'], ['skip', '跳過目前歌曲'], ['queue', '查看播放佇列'], ['leave', '清空佇列並離開']]
    .map(([name, text]) => new SlashCommandBuilder().setName(name).setDescription(text)),
].map(command => command.setContexts(InteractionContextType.Guild).toJSON());
export async function registerCommands(application) {
  await application.commands.set(commands);
  console.log('全域指令已註冊。');
}
