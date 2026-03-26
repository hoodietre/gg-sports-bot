import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const CLIENT_ID = '1407760487151833200';
const GUILD_ID = '1486545386649686068';

const commands = [
  new SlashCommandBuilder()
    .setName('testbotreply')
    .setDescription('Fresh test command')
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

await rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  { body: commands }
);

console.log('Fresh guild command deployed.');
