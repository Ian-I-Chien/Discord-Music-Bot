import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
export const commands = [
  new SlashCommandBuilder().setName('play').setDescription('加入你的語音頻道並播放 YouTube')
    .addStringOption(o => o.setName('link').setDescription('YouTube 連結或歌名').setRequired(true)),
  ...[['pause', '暫停'], ['resume', '繼續播放'], ['skip', '跳過目前歌曲'], ['queue', '查看播放佇列'], ['leave', '清空佇列並離開']]
    .map(([name, text]) => new SlashCommandBuilder().setName(name).setDescription(text)),
].map(command => command.setContexts(InteractionContextType.Guild).toJSON());
export async function registerCommands(application) {
  await application.commands.set(commands);
  console.log('全域指令已註冊。');
}
