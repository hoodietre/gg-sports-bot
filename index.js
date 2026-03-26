client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'ping') {
      await interaction.reply({
        content: 'GG Sports is live.',
        ephemeral: true
      });
      console.log('Ping reply sent');
    }

    if (interaction.commandName === 'testbotreply') {
      await interaction.reply({
        content: 'GG Sports test worked.',
        ephemeral: true
      });
      console.log('Test reply sent');
    }

  } catch (error) {
    console.error('Reply failed:', error);
  }
});
