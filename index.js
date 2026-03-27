import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
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
const TEAM_OWNERS_CHANNEL_ID = '1486545641537671198';
const TRADE_COUNT_CHANNEL_ID = '1486546310059262042';
const TRADE_BLOCK_CHANNEL_ID = '1486546070077964360';

// === TEAM ROLE NAMES ===
const TEAM_ROLE_NAMES = [
  '76ers',
  'Bucks',
  'Bulls',
  'Celtics',
  'Clippers',
  'Grizzlies',
  'Hawks',
  'Heat',
  'Cavs',
  'Hornets',
  'Jazz',
  'Kings',
  'Knicks',
  'Lakers',
  'Magic',
  'Mavs',
  'Nets',
  'Nuggets',
  'Pacers',
  'Pistons',
  'Raptors',
  'Rockets',
  'Spurs',
  'Suns',
  'Sonics',
  'Wolves',
  'Blazers',
  'Warriors',
  'Wizards'
];

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_panels (
      panel_key TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trade_counts (
      team_name TEXT PRIMARY KEY,
      trade_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  for (const teamName of TEAM_ROLE_NAMES) {
    await pool.query(
      `
      INSERT INTO trade_counts (team_name, trade_count)
      VALUES ($1, 0)
      ON CONFLICT (team_name) DO NOTHING
      `,
      [teamName]
    );
  }

  console.log('Database ready.');
}

// === HELPERS ===
function isTeamRole(roleName) {
  return TEAM_ROLE_NAMES.includes(roleName);
}

async function userCanManage(interaction) {
  const isAdmin = interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );

  if (!interaction.guild) return false;

  const invokerMember = await interaction.guild.members.fetch(interaction.user.id);
  const hasStaffRole = invokerMember.roles.cache.has(STAFF_ROLE_ID);

  return Boolean(isAdmin || hasStaffRole);
}

async function buildTeamOwnersEmbed(guild) {
  const lines = [];

  for (const teamName of TEAM_ROLE_NAMES) {
    const role = guild.roles.cache.find(r => r.name === teamName);

    if (!role) {
      lines.push(`**${teamName}** — Role not found`);
      continue;
    }

    const owners = role.members.filter(member => !member.user.bot);

    if (owners.size === 0) {
      lines.push(`**${teamName}** — Unassigned`);
    } else {
      const ownerMentions = owners.map(member => `<@${member.id}>`).join(', ');
      lines.push(`**${teamName}** — ${ownerMentions}`);
    }
  }

  return new EmbedBuilder()
    .setTitle('Team Owners')
    .setDescription(lines.join('\n'))
    .setColor(0x5865F2)
    .setFooter({ text: 'GG Sports • Team Owner Board' })
    .setTimestamp();
}

async function buildTradeCountEmbed() {
  const result = await pool.query(
    'SELECT team_name, trade_count FROM trade_counts ORDER BY team_name ASC'
  );

  const lines = result.rows.map(
    row => `**${row.team_name}** — ${row.trade_count}`
  );

  return new EmbedBuilder()
    .setTitle('Trade Counts')
    .setDescription(lines.join('\n'))
    .setColor(0x57F287)
    .setFooter({ text: 'GG Sports • Trade Count Board' })
    .setTimestamp();
}

async function updatePanelByKey(guild, panelKey, embedBuilder) {
  const result = await pool.query(
    'SELECT channel_id, message_id FROM bot_panels WHERE panel_key = $1',
    [panelKey]
  );

  if (result.rows.length === 0) {
    console.log(`No saved ${panelKey} panel found yet.`);
    return;
  }

  const { channel_id, message_id } = result.rows[0];
  const channel = await guild.channels.fetch(channel_id);

  if (!channel || !channel.isTextBased()) {
    console.log(`Saved ${panelKey} channel was not found or is not text-based.`);
    return;
  }

  const message = await channel.messages.fetch(message_id);
  await message.edit({ embeds: [embedBuilder] });

  console.log(`${panelKey} panel updated.`);
}

async function updateTeamOwnersPanel(guild) {
  const embed = await buildTeamOwnersEmbed(guild);
  await updatePanelByKey(guild, 'team_owners', embed);
}

async function updateTradeCountPanel(guild) {
  const embed = await buildTradeCountEmbed();
  await updatePanelByKey(guild, 'trade_count', embed);
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

    new SlashCommandBuilder()
      .setName('setupteamowners')
      .setDescription('Create or refresh the Team Owners embed'),

    new SlashCommandBuilder()
      .setName('setuptradecount')
      .setDescription('Create or refresh the Trade Count embed'),

    new SlashCommandBuilder()
      .setName('addtrade')
      .setDescription('Add 1 trade to a team')
      .addRoleOption(option =>
        option
          .setName('team')
          .setDescription('The team role')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('removetrade')
      .setDescription('Remove 1 trade from a team')
      .addRoleOption(option =>
        option
          .setName('team')
          .setDescription('The team role')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('tradeblock')
      .setDescription('Add a player to the trade block'),
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

// === INTERACTION HANDLER ===
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // === MODAL SUBMITS ===
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'tradeblock_modal') {
        if (!interaction.guild) {
          await interaction.reply({
            content: 'This can only be used in a server.',
            ephemeral: true,
          });
          return;
        }

        const team = interaction.fields.getTextInputValue('tradeblock_team');
        const playerName = interaction.fields.getTextInputValue('tradeblock_player_name');
        const position = interaction.fields.getTextInputValue('tradeblock_position');
        const age = interaction.fields.getTextInputValue('tradeblock_age');
        const salary = interaction.fields.getTextInputValue('tradeblock_salary');

        const channel = await interaction.guild.channels.fetch(TRADE_BLOCK_CHANNEL_ID);

        if (!channel || !channel.isTextBased()) {
          await interaction.reply({
            content: 'Trade block channel not found.',
            ephemeral: true,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle('Trade Block Listing')
          .setColor(0xFEE75C)
          .addFields(
            { name: 'Team', value: team, inline: true },
            { name: 'Player Name', value: playerName, inline: true },
            { name: 'Position', value: position, inline: true },
            { name: 'Age', value: age, inline: true },
            { name: 'Current Year Salary', value: salary, inline: true },
            { name: 'Submitted By', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setFooter({ text: 'GG Sports • Trade Block' })
          .setTimestamp();

        await channel.send({
          content: `<@&${LEAGUE_ROLE_ID}>`,
          embeds: [embed],
          allowedMentions: {
            roles: [LEAGUE_ROLE_ID],
            users: [],
          },
        });

        await interaction.reply({
          content: 'Your trade block listing has been posted.',
          ephemeral: true,
        });

        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    console.log(`Interaction received: ${interaction.commandName}`);

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

    // === ASSIGNROLE ===
    if (interaction.commandName === 'assignrole') {
      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const allowed = await userCanManage(interaction);

      if (!allowed) {
        await interaction.reply({
          content: 'You do not have permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      const targetUser = interaction.options.getUser('member');
      const role = interaction.options.getRole('role');

      if (!targetUser) {
        await interaction.reply({
          content: 'That member could not be found.',
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

      const targetMember = await interaction.guild.members.fetch(targetUser.id);
      await targetMember.roles.add(role);

      if (isTeamRole(role.name)) {
        try {
          await updateTeamOwnersPanel(interaction.guild);
        } catch (panelError) {
          console.error('Failed to update team owners panel:', panelError);
        }
      }

      await interaction.reply({
        content: `Assigned ${role} to ${targetMember}.`,
        ephemeral: true,
      });

      return;
    }

    // === SETUPTEAMOWNERS ===
    if (interaction.commandName === 'setupteamowners') {
      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const allowed = await userCanManage(interaction);

      if (!allowed) {
        await interaction.reply({
          content: 'You do not have permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      const channel = await interaction.guild.channels.fetch(TEAM_OWNERS_CHANNEL_ID);

      if (!channel || !channel.isTextBased()) {
        await interaction.reply({
          content: 'Team owners channel not found.',
          ephemeral: true,
        });
        return;
      }

      const embed = await buildTeamOwnersEmbed(interaction.guild);
      const message = await channel.send({ embeds: [embed] });

      await pool.query(
        `
        INSERT INTO bot_panels (panel_key, channel_id, message_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (panel_key)
        DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id
        `,
        ['team_owners', channel.id, message.id]
      );

      await interaction.reply({
        content: 'Team Owners panel has been created.',
        ephemeral: true,
      });

      return;
    }

    // === SETUPTRADECOUNT ===
    if (interaction.commandName === 'setuptradecount') {
      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const allowed = await userCanManage(interaction);

      if (!allowed) {
        await interaction.reply({
          content: 'You do not have permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      const channel = await interaction.guild.channels.fetch(TRADE_COUNT_CHANNEL_ID);

      if (!channel || !channel.isTextBased()) {
        await interaction.reply({
          content: 'Trade count channel not found.',
          ephemeral: true,
        });
        return;
      }

      const embed = await buildTradeCountEmbed();
      const message = await channel.send({ embeds: [embed] });

      await pool.query(
        `
        INSERT INTO bot_panels (panel_key, channel_id, message_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (panel_key)
        DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id
        `,
        ['trade_count', channel.id, message.id]
      );

      await interaction.reply({
        content: 'Trade Count panel has been created.',
        ephemeral: true,
      });

      return;
    }

    // === ADDTRADE ===
    if (interaction.commandName === 'addtrade') {
      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const allowed = await userCanManage(interaction);

      if (!allowed) {
        await interaction.reply({
          content: 'You do not have permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      const teamRole = interaction.options.getRole('team');

      if (!teamRole || !isTeamRole(teamRole.name)) {
        await interaction.reply({
          content: 'That is not a tracked team role.',
          ephemeral: true,
        });
        return;
      }

      await pool.query(
        'UPDATE trade_counts SET trade_count = trade_count + 1 WHERE team_name = $1',
        [teamRole.name]
      );

      try {
        await updateTradeCountPanel(interaction.guild);
      } catch (panelError) {
        console.error('Failed to update trade count panel:', panelError);
      }

      await interaction.reply({
        content: `Added 1 trade to ${teamRole}.`,
        ephemeral: true,
      });

      return;
    }

    // === REMOVETRADE ===
    if (interaction.commandName === 'removetrade') {
      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const allowed = await userCanManage(interaction);

      if (!allowed) {
        await interaction.reply({
          content: 'You do not have permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      const teamRole = interaction.options.getRole('team');

      if (!teamRole || !isTeamRole(teamRole.name)) {
        await interaction.reply({
          content: 'That is not a tracked team role.',
          ephemeral: true,
        });
        return;
      }

      await pool.query(
        `
        UPDATE trade_counts
        SET trade_count = GREATEST(trade_count - 1, 0)
        WHERE team_name = $1
        `,
        [teamRole.name]
      );

      try {
        await updateTradeCountPanel(interaction.guild);
      } catch (panelError) {
        console.error('Failed to update trade count panel:', panelError);
      }

      await interaction.reply({
        content: `Removed 1 trade from ${teamRole}.`,
        ephemeral: true,
      });

      return;
    }

    // === TRADEBLOCK ===
    if (interaction.commandName === 'tradeblock') {
      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      if (interaction.channelId !== TRADE_BLOCK_CHANNEL_ID) {
        await interaction.reply({
          content: 'This command can only be used in the trade block channel.',
          ephemeral: true,
        });
        return;
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const teamRole = member.roles.cache.find(role => TEAM_ROLE_NAMES.includes(role.name));

      const modal = new ModalBuilder()
        .setCustomId('tradeblock_modal')
        .setTitle('Trade Block Submission');

      const teamInput = new TextInputBuilder()
        .setCustomId('tradeblock_team')
        .setLabel('Team')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50);

      if (teamRole) {
        teamInput.setValue(teamRole.name);
      }

      const playerNameInput = new TextInputBuilder()
        .setCustomId('tradeblock_player_name')
        .setLabel('Player Name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const positionInput = new TextInputBuilder()
        .setCustomId('tradeblock_position')
        .setLabel('Position')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20);

      const ageInput = new TextInputBuilder()
        .setCustomId('tradeblock_age')
        .setLabel('Age')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10);

      const salaryInput = new TextInputBuilder()
        .setCustomId('tradeblock_salary')
        .setLabel('Current Year Salary')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(25);

      modal.addComponents(
        new ActionRowBuilder().addComponents(teamInput),
        new ActionRowBuilder().addComponents(playerNameInput),
        new ActionRowBuilder().addComponents(positionInput),
        new ActionRowBuilder().addComponents(ageInput),
        new ActionRowBuilder().addComponents(salaryInput)
      );

      await interaction.showModal(modal);
      return;
    }
  } catch (error) {
    console.error('Interaction error:', error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
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
