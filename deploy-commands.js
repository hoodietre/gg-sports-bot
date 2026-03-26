import { REST, Routes } from 'discord.js';

const CLIENT_ID = '1407760487151833200';
const GUILD_ID = '1486545386649686068';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

await rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  { body: [] }
);

console.log('Commands cleared.');
