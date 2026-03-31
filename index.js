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
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import pkg from 'pg';
import { randomUUID } from 'crypto';

const { Pool } = pkg;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
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
const OFFER_A_TRADE_CHANNEL_ID = '1486546108179284148';

const COMMITTEE_CHANNEL_ID = '1486546187111628891';
const TRADE_APPROVED_CHANNEL_ID = '1486546234029379714';
const TRADE_DENIED_CHANNEL_ID = '1486546264404263065';
const COMMITTEE_ROLE_ID = '1487214037266727003';

// === TEAM ROLE NAMES ===
const TEAM_ROLE_NAMES = [
  '76ers',
  'Bucks',
  'Bulls',
  'Cavs',
  'Celtics',
  'Clippers',
  'Grizzlies',
  'Hawks',
  'Heat',
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

// user_id => { targetTeam, createdAt }
const pendingOfferTargets = new Map();

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trade_block_posts (
      id TEXT PRIMARY KEY,
      posted_team TEXT NOT NULL,
      player_name TEXT NOT NULL,
      position TEXT NOT NULL,
      age TEXT NOT NULL,
      ovr TEXT,
      salary TEXT NOT NULL,
      submitted_by TEXT NOT NULL
    )
  `);

  await pool.query(`
    ALTER TABLE trade_block_posts
    ADD COLUMN IF NOT EXISTS ovr TEXT
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trade_offers (
      id TEXT PRIMARY KEY,
      sender_user_id TEXT NOT NULL,
      sender_team TEXT,
      target_team TEXT NOT NULL,
      target_owner_user_id TEXT NOT NULL,
      screenshot_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending_owner',
      committee_message_id TEXT,
      owner_decision_by TEXT,
      offer_details TEXT
    )
  `);

  await pool.query(`
    ALTER TABLE trade_offers
    ADD COLUMN IF NOT EXISTS screenshot_url TEXT
  `);

  await pool.query(`
    ALTER TABLE trade_offers
    ADD COLUMN IF NOT EXISTS committee_message_id TEXT
  `);

  await pool.query(`
    ALTER TABLE trade_offers
    ADD COLUMN IF NOT EXISTS owner_decision_by TEXT
  `);

  await pool.query(`
    ALTER TABLE trade_offers
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_owner'
  `);

  await pool.query(`
    ALTER TABLE trade_offers
    ADD COLUMN IF NOT EXISTS offer_details TEXT
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'trade_offers'
          AND column_name = 'screenshot_link'
      ) THEN
        UPDATE trade_offers
        SET screenshot_url = screenshot_link
        WHERE (screenshot_url IS NULL OR screenshot_url = '')
          AND screenshot_link IS NOT NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    UPDATE trade_offers
    SET screenshot_url = ''
    WHERE screenshot_url IS NULL
  `);

  await pool.query(`
    UPDATE trade_offers
    SET offer_details = ''
    WHERE offer_details IS NULL
  `);

  await pool.query(`
    ALTER TABLE trade_offers
    ALTER COLUMN offer_details DROP NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trade_offer_votes (
      offer_id TEXT NOT NULL,
      voter_user_id TEXT NOT NULL,
      vote TEXT NOT NULL,
      PRIMARY KEY (offer_id, voter_user_id)
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

async function userCanVote(interaction) {
  if (!interaction.guild) return false;

  const isAdmin = interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const hasCommitteeRole = member.roles.cache.has(COMMITTEE_ROLE_ID);

  return Boolean(isAdmin || hasCommitteeRole);
}

async function findTeamOwnerByRoleName(guild, teamRoleName) {
  const role = guild.roles.cache.find(r => r.name === teamRoleName);

  if (!role) return null;

  const owners = role.members.filter(member => !member.user.bot);

  if (owners.size === 0) return null;

  return owners.first();
}

function buildOfferDecisionButtons(offerId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`trade_offer_accept:${offerId}`)
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`trade_offer_decline:${offerId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function buildCommitteeVoteButtons(offerId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`committee_vote_approve:${offerId}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`committee_vote_deny:${offerId}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function buildOfferTradePanelButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('offer_trade_panel_button')
      .setLabel('Offer Trade')
      .setStyle(ButtonStyle.Primary)
  );
}

function buildTeamSelectMenus() {
  const firstHalf = TEAM_ROLE_NAMES.slice(0, 25);
  const secondHalf = TEAM_ROLE_NAMES.slice(25);

  const rows = [];

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('offer_trade_select_1')
        .setPlaceholder('Choose a team (1)')
        .addOptions(
          firstHalf.map(teamName => ({
            label: teamName,
            value: teamName,
          }))
        )
    )
  );

  if (secondHalf.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('offer_trade_select_2')
          .setPlaceholder('Choose a team (2)')
          .addOptions(
            secondHalf.map(teamName => ({
              label: teamName,
              value: teamName,
            }))
          )
      )
    );
  }

  return rows;
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

function buildOfferTradePanelEmbed() {
  return new EmbedBuilder()
    .setTitle('Offer a Trade')
    .setDescription(
      'Press the button below to start a trade offer.\n\nAfter you choose the team, the bot will ask you to upload a screenshot of the in-game trade proposal in this channel.'
    )
    .setColor(0xED4245)
    .setFooter({ text: 'GG Sports • Offer a Trade' })
    .setTimestamp();
}

function buildCommitteeEmbed(offer, approveCount, denyCount) {
  return new EmbedBuilder()
    .setTitle('Trade Committee Vote')
    .setColor(0x5865F2)
    .addFields(
      { name: 'Offering Team', value: offer.sender_team || 'Unknown Team', inline: true },
      { name: 'Receiving Team', value: offer.target_team, inline: true },
      { name: 'Sent By', value: `<@${offer.sender_user_id}>`, inline: true },
      { name: 'Screenshot', value: offer.screenshot_url, inline: false },
      { name: 'Approve Votes', value: String(approveCount), inline: true },
      { name: 'Deny Votes', value: String(denyCount), inline: true },
      { name: 'Status', value: offer.status, inline: true }
    )
    .setImage(offer.screenshot_url)
    .setFooter({ text: 'GG Sports • Trade Committee' })
    .setTimestamp();
}

function buildFinalTradeEmbed(title, color, offer) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(
      { name: 'Offering Team', value: offer.sender_team || 'Unknown Team', inline: true },
      { name: 'Receiving Team', value: offer.target_team, inline: true },
      { name: 'Sent By', value: `<@${offer.sender_user_id}>`, inline: true },
      { name: 'Screenshot', value: offer.screenshot_url, inline: false }
    )
    .setImage(offer.screenshot_url)
    .setFooter({ text: 'GG Sports • Trade Result' })
    .setTimestamp();
}

async function updatePanelByKey(guild, panelKey, embedBuilder, components = []) {
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
  await message.edit({ embeds: [embedBuilder], components });

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

async function getVoteCounts(offerId) {
  const approveResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM trade_offer_votes WHERE offer_id = $1 AND vote = 'approve'`,
    [offerId]
  );

  const denyResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM trade_offer_votes WHERE offer_id = $1 AND vote = 'deny'`,
    [offerId]
  );

  return {
    approve: approveResult.rows[0].count,
    deny: denyResult.rows[0].count,
  };
}

async function finalizeApprovedTrade(guild, offerId) {
  const result = await pool.query(
    'SELECT * FROM trade_offers WHERE id = $1',
    [offerId]
  );

  if (result.rows.length === 0) return;

  const offer = result.rows[0];

  await pool.query(
    `UPDATE trade_offers SET status = 'committee_approved' WHERE id = $1`,
    [offerId]
  );

  const approvedChannel = await guild.channels.fetch(TRADE_APPROVED_CHANNEL_ID);

  if (approvedChannel && approvedChannel.isTextBased()) {
    const embed = buildFinalTradeEmbed('Trade Approved', 0x57F287, {
      ...offer,
      status: 'committee_approved',
    });

    await approvedChannel.send({ embeds: [embed] });
  }

  await pool.query(
    'UPDATE trade_counts SET trade_count = trade_count + 1 WHERE team_name = $1',
    [offer.sender_team]
  );

  await pool.query(
    'UPDATE trade_counts SET trade_count = trade_count + 1 WHERE team_name = $1',
    [offer.target_team]
  );

  await updateTradeCountPanel(guild);

  try {
    const senderUser = await client.users.fetch(offer.sender_user_id);
    await senderUser.send(`Your trade offer involving the ${offer.target_team} has been approved by committee.`);
  } catch (error) {
    console.error('Failed to DM sender approved result:', error);
  }

  try {
    const targetOwner = await client.users.fetch(offer.target_owner_user_id);
    await targetOwner.send(`The trade with ${offer.sender_team || 'Unknown Team'} has been approved by committee.`);
  } catch (error) {
    console.error('Failed to DM owner approved result:', error);
  }
}

async function finalizeDeniedTrade(guild, offerId) {
  const result = await pool.query(
    'SELECT * FROM trade_offers WHERE id = $1',
    [offerId]
  );

  if (result.rows.length === 0) return;

  const offer = result.rows[0];

  await pool.query(
    `UPDATE trade_offers SET status = 'committee_denied' WHERE id = $1`,
    [offerId]
  );

  const deniedChannel = await guild.channels.fetch(TRADE_DENIED_CHANNEL_ID);

  if (deniedChannel && deniedChannel.isTextBased()) {
    const embed = buildFinalTradeEmbed('Trade Denied', 0xED4245, {
      ...offer,
      status: 'committee_denied',
    });

    await deniedChannel.send({ embeds: [embed] });
  }

  try {
    const senderUser = await client.users.fetch(offer.sender_user_id);
    await senderUser.send(`Your trade offer involving the ${offer.target_team} was denied by committee.`);
  } catch (error) {
    console.error('Failed to DM sender denied result:', error);
  }

  try {
    const targetOwner = await client.users.fetch(offer.target_owner_user_id);
    await targetOwner.send(`The trade with ${offer.sender_team || 'Unknown Team'} was denied by committee.`);
  } catch (error) {
    console.error('Failed to DM owner denied result:', error);
  }
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
      .setName('setupoffertrade')
      .setDescription('Create or refresh the Offer a Trade panel'),

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

// === MESSAGE ATTACHMENT FLOW ===
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.channel.id !== OFFER_A_TRADE_CHANNEL_ID) return;

    const pendingData = pendingOfferTargets.get(message.author.id);
    if (!pendingData) return;

    const { targetTeam } = pendingData;

    const attachment = message.attachments.first();
    if (!attachment) return;

    const senderMember = await message.guild.members.fetch(message.author.id);
    const senderTeamRole = senderMember.roles.cache.find(role =>
      TEAM_ROLE_NAMES.includes(role.name)
    );
    const senderTeam = senderTeamRole ? senderTeamRole.name : 'Unknown Team';

    const targetOwner = await findTeamOwnerByRoleName(message.guild, targetTeam);

    if (!targetOwner) {
      pendingOfferTargets.delete(message.author.id);
      await message.reply('That team does not currently have an owner assigned.');
      return;
    }

    const offerId = randomUUID();

    await pool.query(
      `
      INSERT INTO trade_offers (
        id, sender_user_id, sender_team, target_team,
        target_owner_user_id, offer_details, screenshot_url, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_owner')
      `,
      [
        offerId,
        message.author.id,
        senderTeam,
        targetTeam,
        targetOwner.id,
        '',
        attachment.url,
      ]
    );

    const dmEmbed = new EmbedBuilder()
      .setTitle('New Trade Offer')
      .setColor(0x5865F2)
      .addFields(
        { name: 'Offering Team', value: senderTeam, inline: true },
        { name: 'Receiving Team', value: targetTeam, inline: true },
        { name: 'Sent By', value: `<@${message.author.id}>`, inline: true },
        { name: 'Trade Proposal Screenshot', value: attachment.url, inline: false }
      )
      .setImage(attachment.url)
      .setFooter({ text: 'GG Sports • Trade Offer' })
      .setTimestamp();

    try {
      await targetOwner.send({
        embeds: [dmEmbed],
        components: [buildOfferDecisionButtons(offerId)],
      });
    } catch (dmError) {
      console.error('Failed to DM target owner:', dmError);
      pendingOfferTargets.delete(message.author.id);
      await message.reply('I could not DM that team owner. They may have DMs closed.');
      return;
    }

    pendingOfferTargets.delete(message.author.id);

    await message.reply(`Your trade offer was sent to the ${targetTeam} owner.`);
  } catch (error) {
    console.error('MessageCreate error:', error);
  }
});

// === INTERACTION HANDLER ===
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // === MODAL SUBMITS ===
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('tradeblock_modal:')) {
        if (!interaction.guild) {
          await interaction.reply({
            content: 'This can only be used in a server.',
            ephemeral: true,
          });
          return;
        }

        const team = decodeURIComponent(interaction.customId.split(':')[1]);
        const playerName = interaction.fields.getTextInputValue('tradeblock_player_name');
        const position = interaction.fields.getTextInputValue('tradeblock_position');
        const age = interaction.fields.getTextInputValue('tradeblock_age');
        const ovr = interaction.fields.getTextInputValue('tradeblock_ovr');
        const salary = interaction.fields.getTextInputValue('tradeblock_salary');

        const channel = await interaction.guild.channels.fetch(TRADE_BLOCK_CHANNEL_ID);

        if (!channel || !channel.isTextBased()) {
          await interaction.reply({
            content: 'Trade block channel not found.',
            ephemeral: true,
          });
          return;
        }

        const postId = randomUUID();

        await pool.query(
          `
          INSERT INTO trade_block_posts (
            id, posted_team, player_name, position, age, ovr, salary, submitted_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [postId, team, playerName, position, age, ovr, salary, interaction.user.id]
        );

        const embed = new EmbedBuilder()
          .setTitle('Trade Block Listing')
          .setColor(0xFEE75C)
          .addFields(
            { name: 'Team', value: team, inline: true },
            { name: 'Player Name', value: playerName, inline: true },
            { name: 'Position', value: position, inline: true },
            { name: 'Overall Rating', value: ovr, inline: true },
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

    // === BUTTONS ===
    if (interaction.isButton()) {
      if (interaction.customId === 'offer_trade_panel_button') {
        await interaction.reply({
          content: 'Choose the team you are sending the offer to.',
          components: buildTeamSelectMenus(),
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId.startsWith('trade_offer_accept:')) {
        const offerId = interaction.customId.split(':')[1];

        const result = await pool.query(
          'SELECT * FROM trade_offers WHERE id = $1',
          [offerId]
        );

        if (result.rows.length === 0) {
          await interaction.reply({
            content: 'That trade offer could not be found.',
            ephemeral: true,
          });
          return;
        }

        const offer = result.rows[0];

        if (interaction.user.id !== offer.target_owner_user_id) {
          await interaction.reply({
            content: 'Only the targeted team owner can accept this offer.',
            ephemeral: true,
          });
          return;
        }

        await pool.query(
          `UPDATE trade_offers SET status = 'owner_accepted', owner_decision_by = $1 WHERE id = $2`,
          [interaction.user.id, offerId]
        );

        const committeeChannel = await client.channels.fetch(COMMITTEE_CHANNEL_ID);

        if (!committeeChannel || !committeeChannel.isTextBased()) {
          await interaction.reply({
            content: 'Committee channel not found.',
            ephemeral: true,
          });
          return;
        }

        const committeeEmbed = buildCommitteeEmbed(
          { ...offer, status: 'owner_accepted' },
          0,
          0
        );

        const committeeMessage = await committeeChannel.send({
          content: `<@&${COMMITTEE_ROLE_ID}>`,
          embeds: [committeeEmbed],
          components: [buildCommitteeVoteButtons(offerId)],
          allowedMentions: {
            roles: [COMMITTEE_ROLE_ID],
            users: [],
          },
        });

        await pool.query(
          `UPDATE trade_offers SET committee_message_id = $1 WHERE id = $2`,
          [committeeMessage.id, offerId]
        );

        try {
          const senderUser = await client.users.fetch(offer.sender_user_id);
          await senderUser.send(
            `Your trade offer to the ${offer.target_team} owner was accepted and sent to committee for voting.`
          );
        } catch (notifyError) {
          console.error('Failed to notify sender of accepted offer:', notifyError);
        }

        await interaction.update({
          content: 'Trade offer accepted and sent to committee.',
          components: [buildOfferDecisionButtons(offerId, true)],
        });

        return;
      }

      if (interaction.customId.startsWith('trade_offer_decline:')) {
        const offerId = interaction.customId.split(':')[1];

        const result = await pool.query(
          'SELECT * FROM trade_offers WHERE id = $1',
          [offerId]
        );

        if (result.rows.length === 0) {
          await interaction.reply({
            content: 'That trade offer could not be found.',
            ephemeral: true,
          });
          return;
        }

        const offer = result.rows[0];

        if (interaction.user.id !== offer.target_owner_user_id) {
          await interaction.reply({
            content: 'Only the targeted team owner can decline this offer.',
            ephemeral: true,
          });
          return;
        }

        await pool.query(
          `UPDATE trade_offers SET status = 'owner_declined', owner_decision_by = $1 WHERE id = $2`,
          [interaction.user.id, offerId]
        );

        try {
          const senderUser = await client.users.fetch(offer.sender_user_id);
          await senderUser.send(
            `Your trade offer to the ${offer.target_team} owner was declined.`
          );
        } catch (notifyError) {
          console.error('Failed to notify sender of declined offer:', notifyError);
        }

        await interaction.update({
          content: 'Trade offer declined.',
          components: [buildOfferDecisionButtons(offerId, true)],
        });

        return;
      }

      if (interaction.customId.startsWith('committee_vote_approve:')) {
        const offerId = interaction.customId.split(':')[1];

        if (!interaction.guild) {
          await interaction.reply({
            content: 'This can only be used in a server.',
            ephemeral: true,
          });
          return;
        }

        const allowed = await userCanVote(interaction);

        if (!allowed) {
          await interaction.reply({
            content: 'You do not have permission to vote on trades.',
            ephemeral: true,
          });
          return;
        }

        const offerResult = await pool.query(
          'SELECT * FROM trade_offers WHERE id = $1',
          [offerId]
        );

        if (offerResult.rows.length === 0) {
          await interaction.reply({
            content: 'Trade offer not found.',
            ephemeral: true,
          });
          return;
        }

        const offer = offerResult.rows[0];

        if (offer.status === 'committee_approved' || offer.status === 'committee_denied') {
          await interaction.reply({
            content: 'This trade has already been finalized.',
            ephemeral: true,
          });
          return;
        }

        await pool.query(
          `
          INSERT INTO trade_offer_votes (offer_id, voter_user_id, vote)
          VALUES ($1, $2, 'approve')
          ON CONFLICT (offer_id, voter_user_id)
          DO UPDATE SET vote = 'approve'
          `,
          [offerId, interaction.user.id]
        );

        const counts = await getVoteCounts(offerId);

        if (counts.approve >= 3) {
          await finalizeApprovedTrade(interaction.guild, offerId);

          await interaction.update({
            embeds: [buildCommitteeEmbed({ ...offer, status: 'committee_approved' }, counts.approve, counts.deny)],
            components: [buildCommitteeVoteButtons(offerId, true)],
          });
          return;
        }

        await interaction.update({
          embeds: [buildCommitteeEmbed(offer, counts.approve, counts.deny)],
          components: [buildCommitteeVoteButtons(offerId)],
        });

        return;
      }

      if (interaction.customId.startsWith('committee_vote_deny:')) {
        const offerId = interaction.customId.split(':')[1];

        if (!interaction.guild) {
          await interaction.reply({
            content: 'This can only be used in a server.',
            ephemeral: true,
          });
          return;
        }

        const allowed = await userCanVote(interaction);

        if (!allowed) {
          await interaction.reply({
            content: 'You do not have permission to vote on trades.',
            ephemeral: true,
          });
          return;
        }

        const offerResult = await pool.query(
          'SELECT * FROM trade_offers WHERE id = $1',
          [offerId]
        );

        if (offerResult.rows.length === 0) {
          await interaction.reply({
            content: 'Trade offer not found.',
            ephemeral: true,
          });
          return;
        }

        const offer = offerResult.rows[0];

        if (offer.status === 'committee_approved' || offer.status === 'committee_denied') {
          await interaction.reply({
            content: 'This trade has already been finalized.',
            ephemeral: true,
          });
          return;
        }

        await pool.query(
          `
          INSERT INTO trade_offer_votes (offer_id, voter_user_id, vote)
          VALUES ($1, $2, 'deny')
          ON CONFLICT (offer_id, voter_user_id)
          DO UPDATE SET vote = 'deny'
          `,
          [offerId, interaction.user.id]
        );

        const counts = await getVoteCounts(offerId);

        if (counts.deny >= 3) {
          await finalizeDeniedTrade(interaction.guild, offerId);

          await interaction.update({
            embeds: [buildCommitteeEmbed({ ...offer, status: 'committee_denied' }, counts.approve, counts.deny)],
            components: [buildCommitteeVoteButtons(offerId, true)],
          });
          return;
        }

        await interaction.update({
          embeds: [buildCommitteeEmbed(offer, counts.approve, counts.deny)],
          components: [buildCommitteeVoteButtons(offerId)],
        });

        return;
      }
    }

    // === STRING SELECT MENUS ===
    if (interaction.isStringSelectMenu()) {
      if (
        interaction.customId === 'offer_trade_select_1' ||
        interaction.customId === 'offer_trade_select_2'
      ) {
        const targetTeam = interaction.values[0];

        pendingOfferTargets.set(interaction.user.id, {
          targetTeam,
          createdAt: Date.now(),
        });

        await interaction.reply({
          content: `You selected **${targetTeam}**. Now upload your trade proposal screenshot as your next message in <#${OFFER_A_TRADE_CHANNEL_ID}>.`,
          ephemeral: true,
        });

        return;
      }
    }

    // === CHAT INPUT COMMANDS ===
    if (!interaction.isChatInputCommand()) return;

    console.log(`Interaction received: ${interaction.commandName}`);

    if (interaction.commandName === 'ping') {
      await interaction.reply({
        content: 'GG Sports is live.',
        ephemeral: true,
      });
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

    if (interaction.commandName === 'setupoffertrade') {
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

      const channel = await interaction.guild.channels.fetch(OFFER_A_TRADE_CHANNEL_ID);

      if (!channel || !channel.isTextBased()) {
        await interaction.reply({
          content: 'Offer-a-trade channel not found.',
          ephemeral: true,
        });
        return;
      }

      const embed = buildOfferTradePanelEmbed();
      const message = await channel.send({
        embeds: [embed],
        components: [buildOfferTradePanelButton()],
      });

      await pool.query(
        `
        INSERT INTO bot_panels (panel_key, channel_id, message_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (panel_key)
        DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id
        `,
        ['offer_trade', channel.id, message.id]
      );

      await interaction.reply({
        content: 'Offer a Trade panel has been created.',
        ephemeral: true,
      });

      return;
    }

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

      if (!teamRole) {
        await interaction.reply({
          content: 'You do not have a team role assigned, so the bot could not determine your team.',
          ephemeral: true,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`tradeblock_modal:${encodeURIComponent(teamRole.name)}`)
        .setTitle('Trade Block Submission');

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

      const ovrInput = new TextInputBuilder()
        .setCustomId('tradeblock_ovr')
        .setLabel('Overall Rating')
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
        new ActionRowBuilder().addComponents(playerNameInput),
        new ActionRowBuilder().addComponents(positionInput),
        new ActionRowBuilder().addComponents(ageInput),
        new ActionRowBuilder().addComponents(ovrInput),
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
