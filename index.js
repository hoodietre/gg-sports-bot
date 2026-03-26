import { Client, GatewayIntentBits, Events } from 'discord.js';
import pkg from 'pg';

const { Pool } = pkg;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const LEAGUE_ROLE_ID = '1486787668489797843';
const LIVE_CHANNEL_ID = 'PASTE_CHANNEL_ID_HERE'; // ✅ ADD IT HERE

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.app')
    ? { rejectUnauthorized: false }
    : false,
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  console.log(`Interaction received: ${interaction.commandName}`);

  try {
    if (interaction.commandName === 'ping') {
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply('GG Sports is live.');
      console.log('Ping reply sent');
      return;
    }

if (interaction.commandName === 'whogotnext') {
  const extraMessage = interaction.options.getString('message');
  const roleMention = `<@&${LEAGUE_ROLE_ID}>`;
  const userMention = `<@${interaction.user.id}>`;

  let text = `${roleMention} ${userMention} is available to play right now.`;

  if (extraMessage) {
    text += ` ${extraMessage}`;
  }

  await interaction.reply(text);
  console.log('whogotnext reply sent');
  return;
}
if (interaction.commandName === 'linkstream') {
  const url = interaction.options.getString('url');

  streamLinks.set(interaction.user.id, url);

  await interaction.reply({
    content: 'Your stream link has been saved.',
    ephemeral: true
  });

  console.log(`Stream saved for ${interaction.user.id}`);
  return;
}

if (interaction.commandName === 'livestream') {
  const url = streamLinks.get(interaction.user.id);

  if (!url) {
    await interaction.reply({
      content: 'You need to set your stream first using /linkstream',
      ephemeral: true
    });
    return;
  }

await interaction.reply({
  content: `<@&${LEAGUE_ROLE_ID}>  **${interaction.user.username} is LIVE!**\n${url}`,
  allowedMentions: {
    roles: [LEAGUE_ROLE_ID],
    users: []
  }
});
  console.log('Livestream posted');
  return;
}
  } catch (error) {
    console.error('Interaction handler error:', error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('Something went wrong while handling that command.');
      } else {
        await interaction.reply({
          content: 'Something went wrong while handling that command.',
          ephemeral: true,
        });
      }
    } catch (followupError) {
      console.error('Failed to send error reply:', followupError);
    }
  }
});

client.on('error', (error) => {
  console.error('Client error:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

client.login(process.env.DISCORD_TOKEN);
