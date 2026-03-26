import { Client, GatewayIntentBits, Events } from 'discord.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, () => {
  console.log(`GG Sports is online as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  console.log(
    'Interaction received:',
    interaction.isChatInputCommand() ? interaction.commandName : 'not-chat-command'
  );

  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'testbotreply') {
      await interaction.reply('GG Sports test worked.');
      console.log('Reply sent.');
    }
  } catch (error) {
    console.error('Reply failed:', error);
  }
});

client.login(process.env.DISCORD_TOKEN);
