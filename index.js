import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import pkg from 'pg';

const { Pool } = pkg;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// === IDs ===
const CLIENT_ID = '1407760487151833200';
const GUILD_ID = '1486545386649686068';
const LEAGUE_ROLE_ID = '1486787668489797843';
const LIVE_CHANNEL_ID = '1486546017053573223';
const STAFF_ROLE_ID = '1486850276202778795';

// === DATABASE ===
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

// === COMMAND REGISTRATION ===
async function registerCommands() {
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

    new SlashCommandBuilder()
      .setName('linkstream')
      .setDescription('Save your stream link')
      .addStringOption(option =>
        option
          .setName('url')
          .setDescription('Your stream link (Twitch, YouTube, etc)')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('livestream')
      .setDescription('Post your saved stream link'),

    new SlashCommandBuilder()
      .setName('assignrole')
      .setDescription('Assign a role to a member')
      .addUserOption(option =>
        option
          .setName('member')
          .setDescription('The member to give the role to')
          .setRequired(true)
      )
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('The role to assign')
          .setRequired(true)
      ),
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log('Commands synced.');
}

// === READY ===
client.once(Events.ClientReady, async () => {
  console.log(`GG Sports is online as ${client.user.tag}`);

  try {
    await initDatabase();
    await registerCommands();
  } catch (error) {
    console.error('Startup failed:', error);
  }
});

// === COMMAND HANDLER ===
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  console.log(`Interaction received: ${interaction.commandName}`);

  try {
    // === PING ===
    if (interaction.commandName === 'ping') {
      await interaction.reply({
        content: 'GG Sports is live.',
        ephemeral: true,
      });
      return;
    }

    // === WHOGOTNEXT ===
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

    // === LINKSTREAM ===
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

      return;
    }

    // === LIVESTREAM ===
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
          content: 'Live channel not found.',
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

      return;
    }

    // === ASSIGN ROLE ===
    if (interaction.commandName === 'assignrole') {
      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const targetUser = interaction.options.getUser('member');
      const role = interaction.options.getRole('role');

      const isAdmin = interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
      );

      const invokerMember = await interaction.guild.members.fetch(interaction.user.id);
      const hasStaffRole = invokerMember.roles.cache.has(STAFF_ROLE_ID);

      if (!isAdmin && !hasStaffRole) {
        await interaction.reply({
          content: 'You do not have permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id);
      await targetMember.roles.add(role);

      await interaction.reply({
        content: `Assigned ${role} to ${targetMember}.`,
        ephemeral: true,
      });

      return;
    }

  } catch (error) {
    console.error('Interaction error:', error);

    if (!interaction.replied) {
      await interaction.reply({
        content: 'Something went wrong.',
        ephemeral: true,
      });
    }
  }
});

// === ERRORS ===
client.on('error', console.error);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// === LOGIN ===
client.login(process.env.DISCORD_TOKEN);
