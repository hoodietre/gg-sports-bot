import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const CLIENT_ID = '1407760487151833200';
const GUILD_ID = '1486545386649686068';

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if bot is working'),

  new SlashCommandBuilder()
    .setName('whogotnext')
    .setDescription('Notify the league you are ready to play')
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Optional extra message')
        .setRequired(false)
    ),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

await rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  { body: commands }
);

console.log('Ping + whogotnext deployed.');
