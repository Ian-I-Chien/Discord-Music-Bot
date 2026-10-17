import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';
if (!process.env.DISCORD_TOKEN?.trim()) throw new Error('請設定 DISCORD_TOKEN。');
const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const application = await rest.get(Routes.oauth2CurrentApplication());
await rest.put(Routes.applicationCommands(application.id), { body: commands });
console.log('全域指令註冊成功。平常直接啟動 Bot 即會自動註冊。');
