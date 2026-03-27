import { Client, GatewayIntentBits, Events } from 'discord.js';
import pkg from 'pg';

const { Pool } = pkg;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const LEAGUE_ROLE_ID = '1486787668489797843';
const LIVE_CHANNEL_ID = '1486546017053573223';
const STAFF_ROLE_ID = '1486850276202778795';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.app')
    ? { rejectUnauthorized: false }
    : false,
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stream_links (
      user_id TEXT PRIMARY KEY,
      stream_url TEXT NOT NULL
    )
  `);

  console.log('Database ready.');
}

client.once(Events.ClientReady, async () => {
  console.log(`GG Sports is online as ${client.user.tag}`);

  try {
    await initDatabase();
  } catch (error) {
    console.error('Database init failed:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  console.log(`Interaction received: ${interaction.commandName}`);

  try {
    if (interaction.commandName === 'ping') {
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply('GG Sports is live.');
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
      return;
    }

    if (interaction.commandName === 'linkstream') {
      const url = interaction.options.getString('url');

      await pool.query(
        `
        INSERT INTO stream_links (user_id, stream_url)
        VALUES ($1, $2)
        ON CONFLICT (user_id)
        DO UPDATE SET stream_url = EXCLUDED.stream_url
        `,
        [interaction.user.id, url]
      );

      await interaction.reply({
        content: 'Your stream link has been saved permanently.',
        ephemeral: true,
      });

      console.log(`Stream saved for ${interaction.user.id}`);
      return;
    }

    if (interaction.commandName === 'livestream') {
      const result = await pool.query(
        'SELECT stream_url FROM stream_links WHERE user_id = $1',
        [interaction.user.id]
      );

      if (result.rows.length === 0) {
        await interaction.reply({
          content: 'You need to set your stream first using /linkstream',
          ephemeral: true,
        });
        return;
      }

      const url = result.rows[0].stream_url;
      const channel = await client.channels.fetch(LIVE_CHANNEL_ID);

      if (!channel || !channel.isTextBased()) {
        await interaction.reply({
          content: 'Live channel not found or is not a text channel.',
          ephemeral: true,
        });
        return;
      }

      await channel.send({
        content: `<@&${LEAGUE_ROLE_ID}> **${interaction.user.username} is LIVE!**\n${url}`,
        allowedMentions: {
          roles: [LEAGUE_ROLE_ID],
          users: [],
        },
      });

      await interaction.reply({
        content: 'Your stream has been posted.',
        ephemeral: true,
      });

      console.log('Livestream posted');
      return;

    if (interaction.commandName === 'assignrole') {
      const targetUser = interaction.options.getUser('member');
      const role = interaction.options.getRole('role');

      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id);

      const isAdmin = interaction.memberPermissions?.has('Administrator');
      const hasStaffRole = interaction.member?.roles?.cache?.has?.(STAFF_ROLE_ID);

      if (!isAdmin && !hasStaffRole) {
        await interaction.reply({
          content: 'You do not have permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      if (!role) {
        await interaction.reply({
          content: 'That role could not be found.',
          ephemeral: true,
        });
        return;
      }

      await targetMember.roles.add(role);

      await interaction.reply({
        content: `Assigned ${role} to ${targetMember}.`,
        ephemeral: true,
      });

      console.log(`Assigned role ${role.id} to member ${targetMember.id}`);
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
