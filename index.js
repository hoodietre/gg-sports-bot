import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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

// Keep these for now as your working NBA 2K fallback while V2 migration happens.
const CLIENT_ID = process.env.CLIENT_ID || '1407760487151833200';
const DEV_GUILD_ID = process.env.GUILD_ID || '1486545386649686068';
const USE_GLOBAL_COMMANDS = process.env.USE_GLOBAL_COMMANDS === 'true';

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

const TEAM_ROLE_NAMES = [
  '76ers', 'Bucks', 'Bulls', 'Cavs', 'Celtics', 'Clippers', 'Grizzlies',
  'Hawks', 'Heat', 'Hornets', 'Jazz', 'Kings', 'Knicks', 'Lakers', 'Magic',
  'Mavs', 'Nets', 'Nuggets', 'Pacers', 'Pistons', 'Raptors', 'Rockets',
  'Spurs', 'Suns', 'Sonics', 'Wolves', 'Blazers', 'Warriors', 'Wizards',
];

// user_id => { targetTeamName, targetTeamRoleId, leagueId, createdAt }
const pendingOfferTargets = new Map();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.app')
    ? { rejectUnauthorized: false }
    : false,
});

async function initDatabase() {
  // Legacy/current working tables.
  await pool.query(`CREATE TABLE IF NOT EXISTS stream_links (user_id TEXT PRIMARY KEY, stream_url TEXT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS bot_panels (panel_key TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS trade_counts (team_name TEXT PRIMARY KEY, trade_count INTEGER NOT NULL DEFAULT 0)`);
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
  await pool.query(`ALTER TABLE trade_block_posts ADD COLUMN IF NOT EXISTS ovr TEXT`);

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
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS screenshot_url TEXT`);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS committee_message_id TEXT`);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS owner_decision_by TEXT`);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_owner'`);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS offer_details TEXT`);
  await pool.query(`UPDATE trade_offers SET offer_details = '' WHERE offer_details IS NULL`);
  await pool.query(`ALTER TABLE trade_offers ALTER COLUMN offer_details DROP NOT NULL`);
  await pool.query(`UPDATE trade_offers SET screenshot_url = '' WHERE screenshot_url IS NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trade_offer_votes (
      offer_id TEXT NOT NULL,
      voter_user_id TEXT NOT NULL,
      vote TEXT NOT NULL,
      PRIMARY KEY (offer_id, voter_user_id)
    )
  `);

  // V2 configurable tables.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id TEXT PRIMARY KEY,
      guild_name TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leagues (
      league_id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
      league_name TEXT NOT NULL,
      game_key TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, league_name)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS league_settings (
      league_id UUID PRIMARY KEY REFERENCES leagues(league_id) ON DELETE CASCADE,
      league_role_id TEXT,
      staff_role_id TEXT,
      committee_role_id TEXT,
      live_channel_id TEXT,
      team_owners_channel_id TEXT,
      trade_count_channel_id TEXT,
      trade_block_channel_id TEXT,
      offer_a_trade_channel_id TEXT,
      committee_channel_id TEXT,
      approved_channel_id TEXT,
      denied_channel_id TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS league_team_roles (
      league_id UUID NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      role_name TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (league_id, role_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS league_panels (
      league_id UUID NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
      panel_key TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (league_id, panel_key)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_stream_links (
      guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      stream_url TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS league_trade_counts (
      league_id UUID NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      trade_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (league_id, role_id)
    )
  `);

  for (const teamName of TEAM_ROLE_NAMES) {
    await pool.query(`INSERT INTO trade_counts (team_name, trade_count) VALUES ($1, 0) ON CONFLICT (team_name) DO NOTHING`, [teamName]);
  }

  console.log('Database ready.');
}

function buildCommands() {
  return [
    new SlashCommandBuilder().setName('ping').setDescription('Check if bot is working'),
    new SlashCommandBuilder().setName('whogotnext').setDescription('Notify the league you are ready to play').addStringOption(o => o.setName('message').setDescription('Optional extra message').setRequired(false)),
    new SlashCommandBuilder().setName('linkstream').setDescription('Save your stream link').addStringOption(o => o.setName('url').setDescription('Your stream link').setRequired(true)),
    new SlashCommandBuilder().setName('livestream').setDescription('Post your saved stream link'),
    new SlashCommandBuilder().setName('assignrole').setDescription('Assign a role to a member').addUserOption(o => o.setName('member').setDescription('The member to give the role to').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('The role to assign').setRequired(true)),
    new SlashCommandBuilder().setName('setupteamowners').setDescription('Create or refresh the Team Owners embed'),
    new SlashCommandBuilder().setName('setuptradecount').setDescription('Create or refresh the Trade Count embed'),
    new SlashCommandBuilder().setName('setupoffertrade').setDescription('Create or refresh the Offer a Trade panel'),
    new SlashCommandBuilder().setName('addtrade').setDescription('Add 1 trade to a team').addRoleOption(o => o.setName('team').setDescription('The team role').setRequired(true)),
    new SlashCommandBuilder().setName('removetrade').setDescription('Remove 1 trade from a team').addRoleOption(o => o.setName('team').setDescription('The team role').setRequired(true)),
    new SlashCommandBuilder().setName('tradeblock').setDescription('Add a player to the trade block'),

    new SlashCommandBuilder().setName('league-create').setDescription('Create a configurable league profile').addStringOption(o => o.setName('name').setDescription('League name, ex: NBA 2K').setRequired(true)).addStringOption(o => o.setName('game').setDescription('Game key, ex: nba2k, mlb, madden').setRequired(true)),
    new SlashCommandBuilder().setName('league-list').setDescription('List configured leagues in this server'),
    new SlashCommandBuilder().setName('league-setroles').setDescription('Set league roles').addStringOption(o => o.setName('league').setDescription('League name').setRequired(true)).addRoleOption(o => o.setName('league_role').setDescription('League ping role').setRequired(true)).addRoleOption(o => o.setName('staff_role').setDescription('Staff role').setRequired(true)).addRoleOption(o => o.setName('committee_role').setDescription('Committee role').setRequired(true)),
    new SlashCommandBuilder().setName('league-setchannels').setDescription('Set league channels').addStringOption(o => o.setName('league').setDescription('League name').setRequired(true)).addChannelOption(o => o.setName('live').setDescription('Live stream channel').setRequired(true)).addChannelOption(o => o.setName('team_owners').setDescription('Team owners channel').setRequired(true)).addChannelOption(o => o.setName('trade_count').setDescription('Trade count channel').setRequired(true)).addChannelOption(o => o.setName('trade_block').setDescription('Trade block channel').setRequired(true)).addChannelOption(o => o.setName('offer_trade').setDescription('Offer a trade channel').setRequired(true)).addChannelOption(o => o.setName('committee').setDescription('Committee channel').setRequired(true)).addChannelOption(o => o.setName('approved').setDescription('Approved trades channel').setRequired(true)).addChannelOption(o => o.setName('denied').setDescription('Denied trades channel').setRequired(true)),
    new SlashCommandBuilder().setName('league-addteamrole').setDescription('Add a team role to a league').addStringOption(o => o.setName('league').setDescription('League name').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Team role').setRequired(true)),
    new SlashCommandBuilder().setName('league-listteamroles').setDescription('List team roles for a league').addStringOption(o => o.setName('league').setDescription('League name').setRequired(true)),
    new SlashCommandBuilder().setName('league-setup-panels').setDescription('Create V2 panels for a configured league').addStringOption(o => o.setName('league').setDescription('League name').setRequired(true)),
  ].map(cmd => cmd.toJSON());
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  if (USE_GLOBAL_COMMANDS) {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: buildCommands() });
    console.log('Global commands synced.');
  } else {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID), { body: buildCommands() });
    console.log('Guild commands synced.');
  }
}

async function getLeagueByName(guildId, leagueName) {
  const result = await pool.query(
    `SELECT l.*, s.league_role_id, s.staff_role_id, s.committee_role_id, s.live_channel_id,
            s.team_owners_channel_id, s.trade_count_channel_id, s.trade_block_channel_id,
            s.offer_a_trade_channel_id, s.committee_channel_id, s.approved_channel_id, s.denied_channel_id
     FROM leagues l
     LEFT JOIN league_settings s ON s.league_id = l.league_id
     WHERE l.guild_id = $1 AND LOWER(l.league_name) = LOWER($2) AND l.is_active = TRUE`,
    [guildId, leagueName]
  );
  return result.rows[0] || null;
}

async function getLeagueByChannel(guildId, channelId) {
  const result = await pool.query(
    `SELECT l.*, s.league_role_id, s.staff_role_id, s.committee_role_id, s.live_channel_id,
            s.team_owners_channel_id, s.trade_count_channel_id, s.trade_block_channel_id,
            s.offer_a_trade_channel_id, s.committee_channel_id, s.approved_channel_id, s.denied_channel_id
     FROM leagues l
     JOIN league_settings s ON s.league_id = l.league_id
     WHERE l.guild_id = $1 AND l.is_active = TRUE AND $2 IN (
       s.live_channel_id, s.team_owners_channel_id, s.trade_count_channel_id, s.trade_block_channel_id,
       s.offer_a_trade_channel_id, s.committee_channel_id, s.approved_channel_id, s.denied_channel_id
     )
     LIMIT 1`,
    [guildId, channelId]
  );
  return result.rows[0] || null;
}

async function getDefaultLeague(guildId) {
  const result = await pool.query(
    `SELECT l.*, s.league_role_id, s.staff_role_id, s.committee_role_id, s.live_channel_id,
            s.team_owners_channel_id, s.trade_count_channel_id, s.trade_block_channel_id,
            s.offer_a_trade_channel_id, s.committee_channel_id, s.approved_channel_id, s.denied_channel_id
     FROM leagues l
     LEFT JOIN league_settings s ON s.league_id = l.league_id
     WHERE l.guild_id = $1 AND l.is_active = TRUE
     ORDER BY l.created_at ASC
     LIMIT 1`,
    [guildId]
  );
  return result.rows[0] || null;
}

async function resolveLeague(interactionOrMessage) {
  const guild = interactionOrMessage.guild;
  if (!guild) return null;
  const channelId = interactionOrMessage.channelId || interactionOrMessage.channel?.id;
  return (await getLeagueByChannel(guild.id, channelId)) || (await getDefaultLeague(guild.id));
}

async function getLeagueTeamRoles(leagueId) {
  const result = await pool.query(`SELECT role_id, role_name FROM league_team_roles WHERE league_id = $1 ORDER BY role_name ASC`, [leagueId]);
  return result.rows;
}

function isLegacyTeamRole(roleName) {
  return TEAM_ROLE_NAMES.includes(roleName);
}

async function memberHasStaff(member, league) {
  if (!member || !league) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator) || (league.staff_role_id ? member.roles.cache.has(league.staff_role_id) : false);
}

async function memberHasCommittee(member, league) {
  if (!member || !league) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator) || (league.committee_role_id ? member.roles.cache.has(league.committee_role_id) : false);
}

async function findTeamOwnerByRoleId(guild, roleId) {
  await guild.members.fetch();

  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) return null;

  const owners = guild.members.cache.filter(member =>
    !member.user.bot && member.roles.cache.has(roleId)
  );

  return owners.first() || null;
}

async function findTeamOwnerByRoleName(guild, teamRoleName) {
  await guild.members.fetch();

  const role = guild.roles.cache.find(r => r.name === teamRoleName);
  if (!role) return null;

  const owners = guild.members.cache.filter(member =>
    !member.user.bot && member.roles.cache.has(role.id)
  );

  return owners.first() || null;
}

async function getMemberTeamForLeague(member, league) {
  if (league?.league_id) {
    const teamRoles = await getLeagueTeamRoles(league.league_id);
    const match = teamRoles.find(team => member.roles.cache.has(team.role_id));
    if (match) return { roleId: match.role_id, name: match.role_name };
  }

  const legacyRole = member.roles.cache.find(role => isLegacyTeamRole(role.name));
  return legacyRole ? { roleId: legacyRole.id, name: legacyRole.name } : null;
}

function buildOfferDecisionButtons(offerId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`trade_offer_accept:${offerId}`).setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`trade_offer_decline:${offerId}`).setLabel('Decline').setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}

function buildCommitteeVoteButtons(offerId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`committee_vote_approve:${offerId}`).setLabel('Approve').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`committee_vote_deny:${offerId}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}

function buildOfferTradePanelButton(leagueId = 'legacy') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`offer_trade_panel_button:${leagueId}`).setLabel('Offer Trade').setStyle(ButtonStyle.Primary)
  );
}

function buildTeamSelectMenus(teamRoles, leagueId = 'legacy') {
  const source = teamRoles?.length
    ? teamRoles.map(t => ({ label: t.role_name, value: t.role_id }))
    : TEAM_ROLE_NAMES.map(name => ({ label: name, value: name }));

  const firstHalf = source.slice(0, 25);
  const secondHalf = source.slice(25);
  const rows = [];

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`offer_trade_select_1:${leagueId}`)
        .setPlaceholder('Choose a team (1)')
        .addOptions(firstHalf)
    )
  );

  if (secondHalf.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`offer_trade_select_2:${leagueId}`)
          .setPlaceholder('Choose a team (2)')
          .addOptions(secondHalf)
      )
    );
  }

  return rows;
}

function buildOfferTradePanelEmbed(leagueName = 'League') {
  return new EmbedBuilder()
    .setTitle(`${leagueName} • Offer a Trade`)
    .setDescription('Press the button below to start a trade offer.\n\nAfter you choose the team, upload a screenshot of the in-game trade proposal in this channel.')
    .setColor(0xED4245)
    .setFooter({ text: 'GG Sports • Offer a Trade' })
    .setTimestamp();
}

async function buildTeamOwnersEmbed(guild, league = null) {
  const lines = [];
  const teamRoles = league?.league_id ? await getLeagueTeamRoles(league.league_id) : null;

  if (teamRoles?.length) {
    for (const team of teamRoles) {
      const role = await guild.roles.fetch(team.role_id).catch(() => null);
      if (!role) {
        lines.push(`**${team.role_name}** — Role not found`);
        continue;
      }
      const owners = role.members.filter(member => !member.user.bot);
      lines.push(owners.size === 0 ? `**${team.role_name}** — Unassigned` : `**${team.role_name}** — ${owners.map(member => `<@${member.id}>`).join(', ')}`);
    }
  } else {
    for (const teamName of TEAM_ROLE_NAMES) {
      const role = guild.roles.cache.find(r => r.name === teamName);
      if (!role) {
        lines.push(`**${teamName}** — Role not found`);
        continue;
      }
      const owners = role.members.filter(member => !member.user.bot);
      lines.push(owners.size === 0 ? `**${teamName}** — Unassigned` : `**${teamName}** — ${owners.map(member => `<@${member.id}>`).join(', ')}`);
    }
  }

  return new EmbedBuilder()
    .setTitle(`${league?.league_name || 'League'} Team Owners`)
    .setDescription(lines.join('\n') || 'No team roles configured.')
    .setColor(0x5865F2)
    .setFooter({ text: 'GG Sports • Team Owner Board' })
    .setTimestamp();
}

async function buildTradeCountEmbed(league = null) {
  let rows;
  if (league?.league_id) {
    const result = await pool.query(
      `SELECT t.role_name AS team_name, COALESCE(c.trade_count, 0) AS trade_count
       FROM league_team_roles t
       LEFT JOIN league_trade_counts c ON c.league_id = t.league_id AND c.role_id = t.role_id
       WHERE t.league_id = $1
       ORDER BY t.role_name ASC`,
      [league.league_id]
    );
    rows = result.rows;
  } else {
    const result = await pool.query('SELECT team_name, trade_count FROM trade_counts ORDER BY team_name ASC');
    rows = result.rows;
  }

  const lines = rows.map(row => `**${row.team_name}** — ${row.trade_count}`);
  return new EmbedBuilder()
    .setTitle(`${league?.league_name || 'League'} Trade Counts`)
    .setDescription(lines.join('\n') || 'No trade counts yet.')
    .setColor(0x57F287)
    .setFooter({ text: 'GG Sports • Trade Count Board' })
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

async function savePanel(league, panelKey, channelId, messageId) {
  if (league?.league_id) {
    await pool.query(
      `INSERT INTO league_panels (league_id, panel_key, channel_id, message_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (league_id, panel_key)
       DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id, updated_at = NOW()`,
      [league.league_id, panelKey, channelId, messageId]
    );
  } else {
    await pool.query(
      `INSERT INTO bot_panels (panel_key, channel_id, message_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (panel_key)
       DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id`,
      [panelKey, channelId, messageId]
    );
  }
}

async function updatePanel(guild, league, panelKey, embed, components = []) {
  let result;
  if (league?.league_id) {
    result = await pool.query('SELECT channel_id, message_id FROM league_panels WHERE league_id = $1 AND panel_key = $2', [league.league_id, panelKey]);
  } else {
    result = await pool.query('SELECT channel_id, message_id FROM bot_panels WHERE panel_key = $1', [panelKey]);
  }
  if (result.rows.length === 0) return;
  const channel = await guild.channels.fetch(result.rows[0].channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  const message = await channel.messages.fetch(result.rows[0].message_id).catch(() => null);
  if (message) await message.edit({ embeds: [embed], components });
}

async function updateTeamOwnersPanel(guild, league = null) {
  await updatePanel(guild, league, 'team_owners', await buildTeamOwnersEmbed(guild, league));
}

async function updateTradeCountPanel(guild, league = null) {
  await updatePanel(guild, league, 'trade_count', await buildTradeCountEmbed(league));
}

async function getVoteCounts(offerId) {
  const approveResult = await pool.query(`SELECT COUNT(*)::int AS count FROM trade_offer_votes WHERE offer_id = $1 AND vote = 'approve'`, [offerId]);
  const denyResult = await pool.query(`SELECT COUNT(*)::int AS count FROM trade_offer_votes WHERE offer_id = $1 AND vote = 'deny'`, [offerId]);
  return { approve: approveResult.rows[0].count, deny: denyResult.rows[0].count };
}

async function finalizeApprovedTrade(guild, offerId) {
  const result = await pool.query('SELECT * FROM trade_offers WHERE id = $1', [offerId]);
  if (result.rows.length === 0) return;
  const offer = result.rows[0];
  const league = offer.league_id ? await getLeagueByName(guild.id, offer.league_name || '') : await resolveLeague({ guild, channelId: null });

  await pool.query(`UPDATE trade_offers SET status = 'committee_approved' WHERE id = $1`, [offerId]);
  const approvedChannelId = league?.approved_channel_id || TRADE_APPROVED_CHANNEL_ID;
  const approvedChannel = await guild.channels.fetch(approvedChannelId).catch(() => null);
  if (approvedChannel && approvedChannel.isTextBased()) {
    await approvedChannel.send({ embeds: [buildFinalTradeEmbed('Trade Approved', 0x57F287, { ...offer, status: 'committee_approved' })] });
  }

  if (league?.league_id && offer.sender_team_role_id && offer.target_team_role_id) {
    await pool.query(
      `INSERT INTO league_trade_counts (league_id, role_id, team_name, trade_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (league_id, role_id)
       DO UPDATE SET trade_count = league_trade_counts.trade_count + 1`,
      [league.league_id, offer.sender_team_role_id, offer.sender_team]
    );
    await pool.query(
      `INSERT INTO league_trade_counts (league_id, role_id, team_name, trade_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (league_id, role_id)
       DO UPDATE SET trade_count = league_trade_counts.trade_count + 1`,
      [league.league_id, offer.target_team_role_id, offer.target_team]
    );
  } else {
    await pool.query('UPDATE trade_counts SET trade_count = trade_count + 1 WHERE team_name = $1', [offer.sender_team]);
    await pool.query('UPDATE trade_counts SET trade_count = trade_count + 1 WHERE team_name = $1', [offer.target_team]);
  }

  await updateTradeCountPanel(guild, league);
}

async function finalizeDeniedTrade(guild, offerId) {
  const result = await pool.query('SELECT * FROM trade_offers WHERE id = $1', [offerId]);
  if (result.rows.length === 0) return;
  const offer = result.rows[0];
  const league = await resolveLeague({ guild, channelId: null });
  await pool.query(`UPDATE trade_offers SET status = 'committee_denied' WHERE id = $1`, [offerId]);
  const deniedChannelId = league?.denied_channel_id || TRADE_DENIED_CHANNEL_ID;
  const deniedChannel = await guild.channels.fetch(deniedChannelId).catch(() => null);
  if (deniedChannel && deniedChannel.isTextBased()) {
    await deniedChannel.send({ embeds: [buildFinalTradeEmbed('Trade Denied', 0xED4245, { ...offer, status: 'committee_denied' })] });
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`GG Sports is online as ${client.user.tag}`);
  try {
    await initDatabase();
    await registerCommands();
  } catch (error) {
    console.error('Startup failed:', error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    const pendingData = pendingOfferTargets.get(message.author.id);
    if (!pendingData) return;
    const league = pendingData.leagueId ? await getLeagueByName(message.guild.id, pendingData.leagueName || '') : await resolveLeague(message);
    const offerChannelId = league?.offer_a_trade_channel_id || OFFER_A_TRADE_CHANNEL_ID;
    if (message.channel.id !== offerChannelId) return;

    const attachment = message.attachments.first();
    if (!attachment) return;

    const senderMember = await message.guild.members.fetch(message.author.id);
    const senderTeam = await getMemberTeamForLeague(senderMember, league);
    if (!senderTeam) {
      pendingOfferTargets.delete(message.author.id);
      await message.reply('The bot could not determine your team role for this league.');
      return;
    }

    const targetOwner = pendingData.targetTeamRoleId
      ? await findTeamOwnerByRoleId(message.guild, pendingData.targetTeamRoleId)
      : await findTeamOwnerByRoleName(message.guild, pendingData.targetTeamName);

    if (!targetOwner) {
      pendingOfferTargets.delete(message.author.id);
      await message.reply('That team does not currently have an owner assigned.');
      return;
    }

    const offerId = randomUUID();
    await pool.query(
      `INSERT INTO trade_offers (id, sender_user_id, sender_team, target_team, target_owner_user_id, offer_details, screenshot_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_owner')`,
      [offerId, message.author.id, senderTeam.name, pendingData.targetTeamName, targetOwner.id, '', attachment.url]
    );

    const dmEmbed = new EmbedBuilder()
      .setTitle('New Trade Offer')
      .setColor(0x5865F2)
      .addFields(
        { name: 'Offering Team', value: senderTeam.name, inline: true },
        { name: 'Receiving Team', value: pendingData.targetTeamName, inline: true },
        { name: 'Sent By', value: `<@${message.author.id}>`, inline: true },
        { name: 'Trade Proposal Screenshot', value: attachment.url, inline: false }
      )
      .setImage(attachment.url)
      .setFooter({ text: 'GG Sports • Trade Offer' })
      .setTimestamp();

    await targetOwner.send({ embeds: [dmEmbed], components: [buildOfferDecisionButtons(offerId)] });
    pendingOfferTargets.delete(message.author.id);
    await message.reply(`Your trade offer was sent to the ${pendingData.targetTeamName} owner.`);
  } catch (error) {
    console.error('MessageCreate error:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('tradeblock_modal:')) {
        if (!interaction.guild) return;
        const [, encodedTeam, leagueId = 'legacy'] = interaction.customId.split(':');
        const team = decodeURIComponent(encodedTeam);
        const league = leagueId !== 'legacy' ? await resolveLeague(interaction) : null;
        const playerName = interaction.fields.getTextInputValue('tradeblock_player_name');
        const position = interaction.fields.getTextInputValue('tradeblock_position');
        const age = interaction.fields.getTextInputValue('tradeblock_age');
        const ovr = interaction.fields.getTextInputValue('tradeblock_ovr');
        const salary = interaction.fields.getTextInputValue('tradeblock_salary');
        const channelId = league?.trade_block_channel_id || TRADE_BLOCK_CHANNEL_ID;
        const channel = await interaction.guild.channels.fetch(channelId);

        if (!channel || !channel.isTextBased()) {
          await interaction.reply({ content: 'Trade block channel not found.', ephemeral: true });
          return;
        }

        const postId = randomUUID();
        await pool.query(
          `INSERT INTO trade_block_posts (id, posted_team, player_name, position, age, ovr, salary, submitted_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
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

        await channel.send({ content: `<@&${league?.league_role_id || LEAGUE_ROLE_ID}>`, embeds: [embed], allowedMentions: { roles: [league?.league_role_id || LEAGUE_ROLE_ID], users: [] } });
        await interaction.reply({ content: 'Your trade block listing has been posted.', ephemeral: true });
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith('offer_trade_panel_button')) {
        const league = await resolveLeague(interaction);
        const teamRoles = league?.league_id ? await getLeagueTeamRoles(league.league_id) : [];
        await interaction.reply({ content: 'Choose the team you are sending the offer to.', components: buildTeamSelectMenus(teamRoles, league?.league_id || 'legacy'), ephemeral: true });
        return;
      }

      if (interaction.customId.startsWith('trade_offer_accept:')) {
        const offerId = interaction.customId.split(':')[1];
        const result = await pool.query('SELECT * FROM trade_offers WHERE id = $1', [offerId]);
        if (result.rows.length === 0) return;
        const offer = result.rows[0];
        if (interaction.user.id !== offer.target_owner_user_id) {
          await interaction.reply({ content: 'Only the targeted team owner can accept this offer.', ephemeral: true });
          return;
        }
        const league = await resolveLeague({ guild: interaction.guild, channelId: null }) || await getDefaultLeague(interaction.guild.id);
        await pool.query(`UPDATE trade_offers SET status = 'owner_accepted', owner_decision_by = $1 WHERE id = $2`, [interaction.user.id, offerId]);
        const committeeChannel = await client.channels.fetch(league?.committee_channel_id || COMMITTEE_CHANNEL_ID);
        const committeeMessage = await committeeChannel.send({
          content: `<@&${league?.committee_role_id || COMMITTEE_ROLE_ID}>`,
          embeds: [buildCommitteeEmbed({ ...offer, status: 'owner_accepted' }, 0, 0)],
          components: [buildCommitteeVoteButtons(offerId)],
          allowedMentions: { roles: [league?.committee_role_id || COMMITTEE_ROLE_ID], users: [] },
        });
        await pool.query(`UPDATE trade_offers SET committee_message_id = $1 WHERE id = $2`, [committeeMessage.id, offerId]);
        await interaction.update({ content: 'Trade offer accepted and sent to committee.', components: [buildOfferDecisionButtons(offerId, true)] });
        return;
      }

      if (interaction.customId.startsWith('trade_offer_decline:')) {
        const offerId = interaction.customId.split(':')[1];
        const result = await pool.query('SELECT * FROM trade_offers WHERE id = $1', [offerId]);
        if (result.rows.length === 0) return;
        const offer = result.rows[0];
        if (interaction.user.id !== offer.target_owner_user_id) {
          await interaction.reply({ content: 'Only the targeted team owner can decline this offer.', ephemeral: true });
          return;
        }
        await pool.query(`UPDATE trade_offers SET status = 'owner_declined', owner_decision_by = $1 WHERE id = $2`, [interaction.user.id, offerId]);
        await interaction.update({ content: 'Trade offer declined.', components: [buildOfferDecisionButtons(offerId, true)] });
        return;
      }

      if (interaction.customId.startsWith('committee_vote_approve:') || interaction.customId.startsWith('committee_vote_deny:')) {
        const isApprove = interaction.customId.startsWith('committee_vote_approve:');
        const offerId = interaction.customId.split(':')[1];
        const league = await resolveLeague(interaction) || await getDefaultLeague(interaction.guild.id);
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!(await memberHasCommittee(member, league))) {
          await interaction.reply({ content: 'You do not have permission to vote on trades.', ephemeral: true });
          return;
        }
        const offerResult = await pool.query('SELECT * FROM trade_offers WHERE id = $1', [offerId]);
        if (offerResult.rows.length === 0) return;
        const offer = offerResult.rows[0];
        if (offer.status === 'committee_approved' || offer.status === 'committee_denied') {
          await interaction.reply({ content: 'This trade has already been finalized.', ephemeral: true });
          return;
        }
        await pool.query(
          `INSERT INTO trade_offer_votes (offer_id, voter_user_id, vote) VALUES ($1, $2, $3)
           ON CONFLICT (offer_id, voter_user_id) DO UPDATE SET vote = $3`,
          [offerId, interaction.user.id, isApprove ? 'approve' : 'deny']
        );
        const counts = await getVoteCounts(offerId);
        if (counts.approve >= 3) {
          await finalizeApprovedTrade(interaction.guild, offerId);
          await interaction.update({ embeds: [buildCommitteeEmbed({ ...offer, status: 'committee_approved' }, counts.approve, counts.deny)], components: [buildCommitteeVoteButtons(offerId, true)] });
          return;
        }
        if (counts.deny >= 3) {
          await finalizeDeniedTrade(interaction.guild, offerId);
          await interaction.update({ embeds: [buildCommitteeEmbed({ ...offer, status: 'committee_denied' }, counts.approve, counts.deny)], components: [buildCommitteeVoteButtons(offerId, true)] });
          return;
        }
        await interaction.update({ embeds: [buildCommitteeEmbed(offer, counts.approve, counts.deny)], components: [buildCommitteeVoteButtons(offerId)] });
        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('offer_trade_select_')) {
        const [, , leagueId = 'legacy'] = interaction.customId.split(':');
        let targetTeamName = interaction.values[0];
        let targetTeamRoleId = null;
        let league = null;

        if (leagueId !== 'legacy') {
          const result = await pool.query(
            `SELECT l.*, s.* FROM leagues l LEFT JOIN league_settings s ON s.league_id = l.league_id WHERE l.league_id = $1`,
            [leagueId]
          );
          league = result.rows[0] || null;
          const teamRoles = await getLeagueTeamRoles(leagueId);
          const selected = teamRoles.find(t => t.role_id === interaction.values[0]);
          if (selected) {
            targetTeamName = selected.role_name;
            targetTeamRoleId = selected.role_id;
          }
        }

        pendingOfferTargets.set(interaction.user.id, { targetTeamName, targetTeamRoleId, leagueId: league?.league_id || null, leagueName: league?.league_name || null, createdAt: Date.now() });
        await interaction.reply({ content: `You selected **${targetTeamName}**. Now upload your trade proposal screenshot as your next message in <#${league?.offer_a_trade_channel_id || OFFER_A_TRADE_CHANNEL_ID}>.`, ephemeral: true });
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName.startsWith('league-')) {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
      }
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'Only server admins can use league setup commands.', ephemeral: true });
        return;
      }

      if (interaction.commandName === 'league-create') {
        const name = interaction.options.getString('name');
        const game = interaction.options.getString('game').toLowerCase();
        const leagueId = randomUUID();
        await pool.query(`INSERT INTO guilds (guild_id, guild_name) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET guild_name = EXCLUDED.guild_name`, [interaction.guild.id, interaction.guild.name]);
        await pool.query(`INSERT INTO leagues (league_id, guild_id, league_name, game_key) VALUES ($1, $2, $3, $4)`, [leagueId, interaction.guild.id, name, game]);
        await pool.query(`INSERT INTO league_settings (league_id) VALUES ($1) ON CONFLICT (league_id) DO NOTHING`, [leagueId]);
        await interaction.reply({ content: `Created league **${name}** for **${game}**.`, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'league-list') {
        const result = await pool.query(`SELECT league_name, game_key FROM leagues WHERE guild_id = $1 AND is_active = TRUE ORDER BY league_name ASC`, [interaction.guild.id]);
        const text = result.rows.length ? result.rows.map(row => `• **${row.league_name}** (${row.game_key})`).join('\n') : 'No leagues configured yet.';
        await interaction.reply({ content: text, ephemeral: true });
        return;
      }

      const leagueName = interaction.options.getString('league');
      const league = await getLeagueByName(interaction.guild.id, leagueName);
      if (!league) {
        await interaction.reply({ content: `Could not find league **${leagueName}**.`, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'league-setroles') {
        const leagueRole = interaction.options.getRole('league_role');
        const staffRole = interaction.options.getRole('staff_role');
        const committeeRole = interaction.options.getRole('committee_role');
        await pool.query(
          `UPDATE league_settings SET league_role_id = $1, staff_role_id = $2, committee_role_id = $3, updated_at = NOW() WHERE league_id = $4`,
          [leagueRole.id, staffRole.id, committeeRole.id, league.league_id]
        );
        await interaction.reply({ content: `Roles saved for **${league.league_name}**.`, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'league-setchannels') {
        const live = interaction.options.getChannel('live');
        const teamOwners = interaction.options.getChannel('team_owners');
        const tradeCount = interaction.options.getChannel('trade_count');
        const tradeBlock = interaction.options.getChannel('trade_block');
        const offerTrade = interaction.options.getChannel('offer_trade');
        const committee = interaction.options.getChannel('committee');
        const approved = interaction.options.getChannel('approved');
        const denied = interaction.options.getChannel('denied');
        await pool.query(
          `UPDATE league_settings
           SET live_channel_id = $1, team_owners_channel_id = $2, trade_count_channel_id = $3, trade_block_channel_id = $4,
               offer_a_trade_channel_id = $5, committee_channel_id = $6, approved_channel_id = $7, denied_channel_id = $8, updated_at = NOW()
           WHERE league_id = $9`,
          [live.id, teamOwners.id, tradeCount.id, tradeBlock.id, offerTrade.id, committee.id, approved.id, denied.id, league.league_id]
        );
        await interaction.reply({ content: `Channels saved for **${league.league_name}**.`, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'league-addteamrole') {
        const role = interaction.options.getRole('role');
        await pool.query(
          `INSERT INTO league_team_roles (league_id, role_id, role_name) VALUES ($1, $2, $3)
           ON CONFLICT (league_id, role_id) DO UPDATE SET role_name = EXCLUDED.role_name`,
          [league.league_id, role.id, role.name]
        );
        await pool.query(
          `INSERT INTO league_trade_counts (league_id, role_id, team_name, trade_count)
           VALUES ($1, $2, $3, 0)
           ON CONFLICT (league_id, role_id) DO NOTHING`,
          [league.league_id, role.id, role.name]
        );
        await interaction.reply({ content: `Added team role **${role.name}** to **${league.league_name}**.`, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'league-listteamroles') {
        const roles = await getLeagueTeamRoles(league.league_id);
        const text = roles.length ? roles.map(role => `• <@&${role.role_id}>`).join('\n') : 'No team roles configured yet.';
        await interaction.reply({ content: text, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'league-setup-panels') {
        const teamOwnersChannel = await interaction.guild.channels.fetch(league.team_owners_channel_id);
        const tradeCountChannel = await interaction.guild.channels.fetch(league.trade_count_channel_id);
        const offerTradeChannel = await interaction.guild.channels.fetch(league.offer_a_trade_channel_id);

        const teamOwnersMessage = await teamOwnersChannel.send({ embeds: [await buildTeamOwnersEmbed(interaction.guild, league)] });
        await savePanel(league, 'team_owners', teamOwnersChannel.id, teamOwnersMessage.id);

        const tradeCountMessage = await tradeCountChannel.send({ embeds: [await buildTradeCountEmbed(league)] });
        await savePanel(league, 'trade_count', tradeCountChannel.id, tradeCountMessage.id);

        const offerTradeMessage = await offerTradeChannel.send({ embeds: [buildOfferTradePanelEmbed(league.league_name)], components: [buildOfferTradePanelButton(league.league_id)] });
        await savePanel(league, 'offer_trade', offerTradeChannel.id, offerTradeMessage.id);

        await interaction.reply({ content: `Panels created for **${league.league_name}**.`, ephemeral: true });
        return;
      }
    }

    // Current working commands, now with V2 league resolution where possible.
    const league = await resolveLeague(interaction);
    const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;

    if (interaction.commandName === 'ping') {
      await interaction.reply({ content: 'GG Sports is live.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'whogotnext') {
      const extraMessage = interaction.options.getString('message');
      let text = `<@&${league?.league_role_id || LEAGUE_ROLE_ID}> <@${interaction.user.id}> is available to play right now.`;
      if (extraMessage) text += ` ${extraMessage}`;
      await interaction.reply({ content: text, allowedMentions: { roles: [league?.league_role_id || LEAGUE_ROLE_ID], users: [interaction.user.id] } });
      return;
    }

    if (interaction.commandName === 'linkstream') {
      const url = interaction.options.getString('url');
      if (interaction.guild) {
        await pool.query(
          `INSERT INTO guilds (guild_id, guild_name) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET guild_name = EXCLUDED.guild_name`,
          [interaction.guild.id, interaction.guild.name]
        );
        await pool.query(
          `INSERT INTO guild_stream_links (guild_id, user_id, stream_url, updated_at) VALUES ($1, $2, $3, NOW())
           ON CONFLICT (guild_id, user_id) DO UPDATE SET stream_url = EXCLUDED.stream_url, updated_at = NOW()`,
          [interaction.guild.id, interaction.user.id, url]
        );
      }
      await pool.query(`INSERT INTO stream_links (user_id, stream_url) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET stream_url = EXCLUDED.stream_url`, [interaction.user.id, url]);
      await interaction.reply({ content: 'Your stream link has been saved permanently.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'livestream') {
      const result = interaction.guild
        ? await pool.query('SELECT stream_url FROM guild_stream_links WHERE guild_id = $1 AND user_id = $2', [interaction.guild.id, interaction.user.id])
        : await pool.query('SELECT stream_url FROM stream_links WHERE user_id = $1', [interaction.user.id]);
      const fallback = result.rows.length ? result : await pool.query('SELECT stream_url FROM stream_links WHERE user_id = $1', [interaction.user.id]);
      if (fallback.rows.length === 0) {
        await interaction.reply({ content: 'You need to set your stream first using /linkstream', ephemeral: true });
        return;
      }
      const channel = await client.channels.fetch(league?.live_channel_id || LIVE_CHANNEL_ID);
      await channel.send({ content: `<@&${league?.league_role_id || LEAGUE_ROLE_ID}> **${interaction.user.username} is LIVE!**\n${fallback.rows[0].stream_url}`, allowedMentions: { roles: [league?.league_role_id || LEAGUE_ROLE_ID], users: [] } });
      await interaction.reply({ content: 'Your stream has been posted.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'assignrole') {
      if (!interaction.guild || !(member && (await memberHasStaff(member, league)))) {
        await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }
      const targetUser = interaction.options.getUser('member');
      const role = interaction.options.getRole('role');
      const targetMember = await interaction.guild.members.fetch(targetUser.id);
      await targetMember.roles.add(role);
      const configuredTeamRoles = league?.league_id ? await getLeagueTeamRoles(league.league_id) : [];
      if (configuredTeamRoles.some(team => team.role_id === role.id) || isLegacyTeamRole(role.name)) {
        await updateTeamOwnersPanel(interaction.guild, league);
      }
      await interaction.reply({ content: `Assigned ${role} to ${targetMember}.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'setupteamowners') {
      const channel = await interaction.guild.channels.fetch(league?.team_owners_channel_id || TEAM_OWNERS_CHANNEL_ID);
      const message = await channel.send({ embeds: [await buildTeamOwnersEmbed(interaction.guild, league)] });
      await savePanel(league, 'team_owners', channel.id, message.id);
      await interaction.reply({ content: 'Team Owners panel has been created.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'setuptradecount') {
      const channel = await interaction.guild.channels.fetch(league?.trade_count_channel_id || TRADE_COUNT_CHANNEL_ID);
      const message = await channel.send({ embeds: [await buildTradeCountEmbed(league)] });
      await savePanel(league, 'trade_count', channel.id, message.id);
      await interaction.reply({ content: 'Trade Count panel has been created.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'setupoffertrade') {
      const channel = await interaction.guild.channels.fetch(league?.offer_a_trade_channel_id || OFFER_A_TRADE_CHANNEL_ID);
      const message = await channel.send({ embeds: [buildOfferTradePanelEmbed(league?.league_name || 'League')], components: [buildOfferTradePanelButton(league?.league_id || 'legacy')] });
      await savePanel(league, 'offer_trade', channel.id, message.id);
      await interaction.reply({ content: 'Offer a Trade panel has been created.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'addtrade' || interaction.commandName === 'removetrade') {
      const teamRole = interaction.options.getRole('team');
      const increment = interaction.commandName === 'addtrade' ? 1 : -1;
      if (league?.league_id) {
        await pool.query(
          `INSERT INTO league_trade_counts (league_id, role_id, team_name, trade_count)
           VALUES ($1, $2, $3, GREATEST($4, 0))
           ON CONFLICT (league_id, role_id)
           DO UPDATE SET trade_count = GREATEST(league_trade_counts.trade_count + $4, 0)`,
          [league.league_id, teamRole.id, teamRole.name, increment]
        );
      } else {
        await pool.query(`UPDATE trade_counts SET trade_count = GREATEST(trade_count + $1, 0) WHERE team_name = $2`, [increment, teamRole.name]);
      }
      await updateTradeCountPanel(interaction.guild, league);
      await interaction.reply({ content: `${increment > 0 ? 'Added' : 'Removed'} 1 trade ${increment > 0 ? 'to' : 'from'} ${teamRole}.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'tradeblock') {
      const tradeBlockChannelId = league?.trade_block_channel_id || TRADE_BLOCK_CHANNEL_ID;
      if (interaction.channelId !== tradeBlockChannelId) {
        await interaction.reply({ content: 'This command can only be used in the trade block channel.', ephemeral: true });
        return;
      }
      const teamRole = await getMemberTeamForLeague(member, league);
      if (!teamRole) {
        await interaction.reply({ content: 'You do not have a team role assigned, so the bot could not determine your team.', ephemeral: true });
        return;
      }
      const modal = new ModalBuilder().setCustomId(`tradeblock_modal:${encodeURIComponent(teamRole.name)}:${league?.league_id || 'legacy'}`).setTitle('Trade Block Submission');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tradeblock_player_name').setLabel('Player Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tradeblock_position').setLabel('Position').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tradeblock_age').setLabel('Age').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tradeblock_ovr').setLabel('Overall Rating').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tradeblock_salary').setLabel('Current Year Salary').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25))
      );
      await interaction.showModal(modal);
      return;
    }
  } catch (error) {
    console.error('Interaction error:', error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong.', ephemeral: true });
    }
  }
});

client.on('error', console.error);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(process.env.DISCORD_TOKEN);
