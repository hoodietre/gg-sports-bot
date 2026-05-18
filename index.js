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

const CLIENT_ID = process.env.CLIENT_ID || '1407760487151833200';
const DEV_GUILD_ID = process.env.GUILD_ID || '1486545386649686068';
const USE_GLOBAL_COMMANDS = process.env.USE_GLOBAL_COMMANDS === 'true';

// Legacy fallback IDs for your original server.
const LEAGUE_ROLE_ID = '1486787668489797843';
const LIVE_CHANNEL_ID = '1486546017053573223';
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

const pendingOfferTargets = new Map();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.app')
    ? { rejectUnauthorized: false }
    : false,
});

async function initDatabase() {
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
      offer_details TEXT,
      guild_id TEXT,
      league_id UUID,
      sender_team_role_id TEXT,
      target_team_role_id TEXT
    )
  `);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS screenshot_url TEXT`);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS committee_message_id TEXT`);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS owner_decision_by TEXT`);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_owner'`);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS offer_details TEXT`);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS guild_id TEXT`);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS league_id UUID`);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS sender_team_role_id TEXT`);
  await pool.query(`ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS target_team_role_id TEXT`);
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
      season_length INTEGER,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, league_name)
    )
  `);
  await pool.query(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS season_length INTEGER`);

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
      history_channel_id TEXT,
      standings_channel_id TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE league_settings ADD COLUMN IF NOT EXISTS history_channel_id TEXT`);
  await pool.query(`ALTER TABLE league_settings ADD COLUMN IF NOT EXISTS standings_channel_id TEXT`);

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trade_history (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      league_id UUID REFERENCES leagues(league_id) ON DELETE SET NULL,
      offer_id TEXT,
      sender_user_id TEXT NOT NULL,
      sender_team TEXT NOT NULL,
      sender_team_role_id TEXT,
      target_team TEXT NOT NULL,
      target_team_role_id TEXT,
      screenshot_url TEXT,
      approved_by_committee_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS offer_id TEXT`);
  await pool.query(`ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS screenshot_url TEXT`);
  await pool.query(`ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS sender_team_role_id TEXT`);
  await pool.query(`ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS target_team_role_id TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS season_history (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      league_id UUID REFERENCES leagues(league_id) ON DELETE SET NULL,
      season_label TEXT NOT NULL,
      champion TEXT NOT NULL,
      runner_up TEXT,
      mvp TEXT,
      awards TEXT,
      notes TEXT,
      posted_channel_id TEXT,
      posted_message_id TEXT,
      created_by_user_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS franchise_legacy (
      guild_id TEXT NOT NULL,
      league_id UUID REFERENCES leagues(league_id) ON DELETE CASCADE,
      franchise_name TEXT NOT NULL,
      championships INTEGER NOT NULL DEFAULT 0,
      finals_appearances INTEGER NOT NULL DEFAULT 0,
      last_championship TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, league_id, franchise_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS award_history (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      league_id UUID REFERENCES leagues(league_id) ON DELETE CASCADE,
      season_label TEXT NOT NULL,
      award_name TEXT NOT NULL,
      winner TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS league_standings (
      guild_id TEXT NOT NULL,
      league_id UUID REFERENCES leagues(league_id) ON DELETE CASCADE,
      team_role_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      points_for INTEGER NOT NULL DEFAULT 0,
      points_against INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, league_id, team_role_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS league_games (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      league_id UUID REFERENCES leagues(league_id) ON DELETE CASCADE,
      home_team_role_id TEXT NOT NULL,
      home_team_name TEXT NOT NULL,
      away_team_role_id TEXT NOT NULL,
      away_team_name TEXT NOT NULL,
      scheduled_for TEXT,
      week_label TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      home_score INTEGER,
      away_score INTEGER,
      winner_team_role_id TEXT,
      reported_by_user_id TEXT,
      created_by_user_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  for (const teamName of TEAM_ROLE_NAMES) {
    await pool.query(
      `INSERT INTO trade_counts (team_name, trade_count) VALUES ($1, 0) ON CONFLICT (team_name) DO NOTHING`,
      [teamName]
    );
  }

  console.log('Database ready.');
}

function buildCommands() {
  return [
    new SlashCommandBuilder().setName('ping').setDescription('Check if bot is working'),
    new SlashCommandBuilder().setName('help').setDescription('Show the GG Sports setup guide'),
    new SlashCommandBuilder().setName('commands').setDescription('Show available GG Sports commands'),

    new SlashCommandBuilder()
      .setName('whogotnext')
      .setDescription('Notify a league that you are ready to play')
      .addStringOption(o => o.setName('league').setDescription('League name, ex: NBA 2K or MLB').setRequired(false))
      .addStringOption(o => o.setName('message').setDescription('Optional extra message').setRequired(false)),

    new SlashCommandBuilder()
      .setName('linkstream')
      .setDescription('Save your stream link')
      .addStringOption(o => o.setName('url').setDescription('Your stream link').setRequired(true)),

    new SlashCommandBuilder().setName('livestream').setDescription('Post your saved stream link'),

    new SlashCommandBuilder()
      .setName('assignrole')
      .setDescription('Assign a role to a member')
      .addUserOption(o => o.setName('member').setDescription('The member to give the role to').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('The role to assign').setRequired(true)),

    new SlashCommandBuilder()
      .setName('unassignrole')
      .setDescription('Remove a role from a member')
      .addUserOption(o => o.setName('member').setDescription('The member to remove the role from').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('The role to remove').setRequired(true)),

    new SlashCommandBuilder().setName('setupteamowners').setDescription('Create or refresh the Team Owners embed'),
    new SlashCommandBuilder().setName('setuptradecount').setDescription('Create or refresh the Trade Count embed'),
    new SlashCommandBuilder().setName('setupoffertrade').setDescription('Create or refresh the Offer a Trade panel'),

    new SlashCommandBuilder()
      .setName('addtrade')
      .setDescription('Add 1 trade to a team')
      .addRoleOption(o => o.setName('team').setDescription('The team role').setRequired(true)),

    new SlashCommandBuilder()
      .setName('removetrade')
      .setDescription('Remove 1 trade from a team')
      .addRoleOption(o => o.setName('team').setDescription('The team role').setRequired(true)),

    new SlashCommandBuilder().setName('tradeblock').setDescription('Add a player to the trade block'),

    new SlashCommandBuilder()
      .setName('tradehistory')
      .setDescription('Show recent approved trades for a league')
      .addStringOption(o => o.setName('league').setDescription('League name, ex: NBA 2K or MLB').setRequired(false)),

    new SlashCommandBuilder()
      .setName('teamtrades')
      .setDescription('Show approved trades involving a team')
      .addRoleOption(o => o.setName('team').setDescription('Team role').setRequired(true))
      .addStringOption(o => o.setName('league').setDescription('League name, ex: NBA 2K or MLB').setRequired(false)),

    new SlashCommandBuilder()
      .setName('league-create')
      .setDescription('Create a configurable league profile')
      .addStringOption(o => o.setName('name').setDescription('League name, ex: NBA 2K').setRequired(true))
      .addStringOption(o => o.setName('game').setDescription('Game key, ex: nba2k, mlb, madden').setRequired(true))
      .addIntegerOption(o => o.setName('season_length').setDescription('Season length in games, ex: 82').setRequired(false)),

    new SlashCommandBuilder().setName('league-list').setDescription('List configured leagues in this server'),

    new SlashCommandBuilder()
      .setName('league-setroles')
      .setDescription('Set league roles')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
      .addRoleOption(o => o.setName('league_role').setDescription('League ping role').setRequired(true))
      .addRoleOption(o => o.setName('staff_role').setDescription('Staff role').setRequired(true))
      .addRoleOption(o => o.setName('committee_role').setDescription('Committee role').setRequired(true)),

    new SlashCommandBuilder()
      .setName('league-setchannels')
      .setDescription('Set league channels')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
      .addChannelOption(o => o.setName('live').setDescription('Live stream channel').setRequired(true))
      .addChannelOption(o => o.setName('team_owners').setDescription('Team owners channel').setRequired(true))
      .addChannelOption(o => o.setName('trade_count').setDescription('Trade count channel').setRequired(true))
      .addChannelOption(o => o.setName('trade_block').setDescription('Trade block channel').setRequired(true))
      .addChannelOption(o => o.setName('offer_trade').setDescription('Offer a trade channel').setRequired(true))
      .addChannelOption(o => o.setName('committee').setDescription('Committee channel').setRequired(true))
      .addChannelOption(o => o.setName('approved').setDescription('Approved trades channel').setRequired(true))
      .addChannelOption(o => o.setName('denied').setDescription('Denied trades channel').setRequired(true)),

    new SlashCommandBuilder()
      .setName('league-sethistorychannel')
      .setDescription('Set the league history channel')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('League history channel').setRequired(true)),

    new SlashCommandBuilder()
      .setName('league-setstandingschannel')
      .setDescription('Set the league standings channel')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('League standings channel').setRequired(true)),

    new SlashCommandBuilder()
      .setName('setupstandings')
      .setDescription('Create or refresh the permanent standings panel')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true)),

    new SlashCommandBuilder()
      .setName('league-addteamrole')
      .setDescription('Add a team role to a league')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Team role').setRequired(true)),

    new SlashCommandBuilder()
      .setName('league-listteamroles')
      .setDescription('List team roles for a league')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true)),

    new SlashCommandBuilder()
      .setName('league-setup-panels')
      .setDescription('Create V3 panels for a configured league')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true)),

    new SlashCommandBuilder()
      .setName('editleaguename')
      .setDescription('Rename a configured league')
      .addStringOption(o => o.setName('league').setDescription('Current league name').setRequired(true))
      .addStringOption(o => o.setName('new_name').setDescription('New league name').setRequired(true)),

    new SlashCommandBuilder()
      .setName('addseasonhistory')
      .setDescription('Post a completed season history embed')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
      .addStringOption(o => o.setName('season').setDescription('Season label, ex: Season 1 or 2026 Spring').setRequired(true))
      .addStringOption(o => o.setName('champion').setDescription('Champion team/user').setRequired(true))
      .addStringOption(o => o.setName('runner_up').setDescription('Runner-up team/user').setRequired(false))
      .addStringOption(o => o.setName('mvp').setDescription('MVP or top player').setRequired(false))
      .addStringOption(o => o.setName('awards').setDescription('Format: MVP: Name | Cy Young: Name | Sportsmanship: Name').setRequired(false))
      .addStringOption(o => o.setName('notes').setDescription('Season notes or storylines').setRequired(false)),

    new SlashCommandBuilder()
      .setName('franchiselegacy')
      .setDescription('Show franchise championship and finals history')
      .addStringOption(o => o.setName('league').setDescription('League name, ex: NBA 2K or MLB').setRequired(false)),

    new SlashCommandBuilder()
      .setName('awardhistory')
      .setDescription('Show award history for a league')
      .addStringOption(o => o.setName('league').setDescription('League name, ex: NBA 2K or MLB').setRequired(false))
      .addStringOption(o => o.setName('award').setDescription('Filter by award name, ex: MVP or Cy Young').setRequired(false)),

    new SlashCommandBuilder()
      .setName('halloffame')
      .setDescription('Show the league Hall of Fame leaderboard')
      .addStringOption(o => o.setName('league').setDescription('League name, ex: NBA 2K or MLB').setRequired(false)),

    new SlashCommandBuilder()
      .setName('profile')
      .setDescription('Show a user profile for a league')
      .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false))
      .addStringOption(o => o.setName('league').setDescription('League name, ex: NBA 2K or MLB').setRequired(false)),

    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show your league stats or another user’s stats')
      .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false))
      .addStringOption(o => o.setName('league').setDescription('League name, ex: NBA 2K or MLB').setRequired(false)),

    new SlashCommandBuilder()
      .setName('teamprofile')
      .setDescription('Show a team/franchise profile for a league')
      .addRoleOption(o => o.setName('team').setDescription('Team role').setRequired(true))
      .addStringOption(o => o.setName('league').setDescription('League name, ex: NBA 2K or MLB').setRequired(false)),

    new SlashCommandBuilder()
      .setName('addgame')
      .setDescription('Add a scheduled league game')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
      .addRoleOption(o => o.setName('home').setDescription('Home team role').setRequired(true))
      .addRoleOption(o => o.setName('away').setDescription('Away team role').setRequired(true))
      .addStringOption(o => o.setName('date').setDescription('Game date/time, ex: Week 1 or May 20 8PM').setRequired(false))
      .addStringOption(o => o.setName('week').setDescription('Week/series label, ex: Week 1').setRequired(false)),

    new SlashCommandBuilder()
      .setName('reportgame')
      .setDescription('Report a completed league game')
      .addStringOption(o => o.setName('game_id').setDescription('Game ID from /schedule').setRequired(true))
      .addIntegerOption(o => o.setName('home_score').setDescription('Home team score').setRequired(true))
      .addIntegerOption(o => o.setName('away_score').setDescription('Away team score').setRequired(true)),

    new SlashCommandBuilder()
      .setName('schedule')
      .setDescription('Show scheduled/recent games for a league')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(false)),

    new SlashCommandBuilder()
      .setName('standings')
      .setDescription('Show league standings')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(false)),

    new SlashCommandBuilder()
      .setName('adjuststandings')
      .setDescription('Admin adjustment for team standings')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
      .addRoleOption(o => o.setName('team').setDescription('Team role').setRequired(true))
      .addIntegerOption(o => o.setName('wins').setDescription('Set wins').setRequired(true))
      .addIntegerOption(o => o.setName('losses').setDescription('Set losses').setRequired(true)),
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
            s.offer_a_trade_channel_id, s.committee_channel_id, s.approved_channel_id, s.denied_channel_id,
            s.history_channel_id, s.standings_channel_id
     FROM leagues l
     LEFT JOIN league_settings s ON s.league_id = l.league_id
     WHERE l.guild_id = $1 AND LOWER(l.league_name) = LOWER($2) AND l.is_active = TRUE`,
    [guildId, leagueName]
  );
  return result.rows[0] || null;
}

async function getLeagueById(leagueId) {
  if (!leagueId) return null;
  const result = await pool.query(
    `SELECT l.*, s.league_role_id, s.staff_role_id, s.committee_role_id, s.live_channel_id,
            s.team_owners_channel_id, s.trade_count_channel_id, s.trade_block_channel_id,
            s.offer_a_trade_channel_id, s.committee_channel_id, s.approved_channel_id, s.denied_channel_id,
            s.history_channel_id, s.standings_channel_id
     FROM leagues l
     LEFT JOIN league_settings s ON s.league_id = l.league_id
     WHERE l.league_id = $1 AND l.is_active = TRUE`,
    [leagueId]
  );
  return result.rows[0] || null;
}

async function getLeagueByChannel(guildId, channelId) {
  const result = await pool.query(
    `SELECT l.*, s.league_role_id, s.staff_role_id, s.committee_role_id, s.live_channel_id,
            s.team_owners_channel_id, s.trade_count_channel_id, s.trade_block_channel_id,
            s.offer_a_trade_channel_id, s.committee_channel_id, s.approved_channel_id, s.denied_channel_id,
            s.history_channel_id, s.standings_channel_id
     FROM leagues l
     JOIN league_settings s ON s.league_id = l.league_id
     WHERE l.guild_id = $1 AND l.is_active = TRUE AND $2 IN (
       s.live_channel_id, s.team_owners_channel_id, s.trade_count_channel_id, s.trade_block_channel_id,
       s.offer_a_trade_channel_id, s.committee_channel_id, s.approved_channel_id, s.denied_channel_id, s.history_channel_id, s.standings_channel_id
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
            s.offer_a_trade_channel_id, s.committee_channel_id, s.approved_channel_id, s.denied_channel_id,
            s.history_channel_id, s.standings_channel_id
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
  if (!channelId) return await getDefaultLeague(guild.id);
  return (await getLeagueByChannel(guild.id, channelId)) || (await getDefaultLeague(guild.id));
}

async function getLeagueTeamRoles(leagueId) {
  const result = await pool.query(
    `SELECT role_id, role_name FROM league_team_roles WHERE league_id = $1 ORDER BY role_name ASC`,
    [leagueId]
  );
  return result.rows;
}

function isLegacyTeamRole(roleName) {
  return TEAM_ROLE_NAMES.includes(roleName);
}

async function memberHasStaff(member, league) {
  if (!member) return false;
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const canManageServer = member.permissions.has(PermissionFlagsBits.ManageGuild);
  const hasStaffRole = league?.staff_role_id ? member.roles.cache.has(league.staff_role_id) : false;
  return Boolean(isAdmin || canManageServer || hasStaffRole);
}

async function memberHasCommittee(member, league) {
  if (!member) return false;
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasCommitteeRole = league?.committee_role_id ? member.roles.cache.has(league.committee_role_id) : false;
  return Boolean(isAdmin || hasCommitteeRole);
}

async function userCanUseLeagueSetup(interaction, league = null) {
  if (!interaction.guild) return false;
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  const canManageServer = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  if (isAdmin || canManageServer) return true;

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return false;

  if (league?.staff_role_id && member.roles.cache.has(league.staff_role_id)) return true;

  const result = await pool.query(
    `SELECT DISTINCT s.staff_role_id
     FROM leagues l
     JOIN league_settings s ON s.league_id = l.league_id
     WHERE l.guild_id = $1 AND l.is_active = TRUE AND s.staff_role_id IS NOT NULL`,
    [interaction.guild.id]
  );
  return result.rows.some(row => member.roles.cache.has(row.staff_role_id));
}

async function findTeamOwnerByRoleId(guild, roleId) {
  await guild.members.fetch();
  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) return null;
  const owners = guild.members.cache.filter(member => !member.user.bot && member.roles.cache.has(roleId));
  return owners.first() || null;
}

async function findTeamOwnerByRoleName(guild, teamRoleName) {
  await guild.members.fetch();
  const role = guild.roles.cache.find(r => r.name === teamRoleName);
  if (!role) return null;
  const owners = guild.members.cache.filter(member => !member.user.bot && member.roles.cache.has(role.id));
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

function parseCustomAwards(awardsText) {
  if (!awardsText) return [];
  return awardsText
    .split('|')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const separatorIndex = item.indexOf(':');
      if (separatorIndex === -1) return { name: 'Award', value: item };
      return {
        name: item.slice(0, separatorIndex).trim() || 'Award',
        value: item.slice(separatorIndex + 1).trim() || 'Not listed',
      };
    });
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
    ? teamRoles.map(team => ({ label: team.role_name, value: team.role_id }))
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
  await guild.members.fetch();

  if (teamRoles?.length) {
    for (const team of teamRoles) {
      const role = await guild.roles.fetch(team.role_id).catch(() => null);
      if (!role) {
        lines.push(`**${team.role_name}** — Role not found`);
        continue;
      }
      const owners = guild.members.cache.filter(member => !member.user.bot && member.roles.cache.has(role.id));
      lines.push(owners.size === 0 ? `**${team.role_name}** — Unassigned` : `**${team.role_name}** — ${owners.map(member => `<@${member.id}>`).join(', ')}`);
    }
  } else {
    for (const teamName of TEAM_ROLE_NAMES) {
      const role = guild.roles.cache.find(r => r.name === teamName);
      if (!role) {
        lines.push(`**${teamName}** — Role not found`);
        continue;
      }
      const owners = guild.members.cache.filter(member => !member.user.bot && member.roles.cache.has(role.id));
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
      { name: 'Screenshot', value: offer.screenshot_url || 'No screenshot', inline: false },
      { name: 'Approve Votes', value: String(approveCount), inline: true },
      { name: 'Deny Votes', value: String(denyCount), inline: true },
      { name: 'Status', value: offer.status || 'pending', inline: true }
    )
    .setImage(offer.screenshot_url || null)
    .setFooter({ text: 'GG Sports • Trade Committee' })
    .setTimestamp();
}

function buildFinalTradeEmbed(title, color, offer) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(
      { name: 'Offering Team', value: offer.sender_team || 'Unknown Team', inline: true },
      { name: 'Receiving Team', value: offer.target_team || 'Unknown Team', inline: true },
      { name: 'Sent By', value: `<@${offer.sender_user_id}>`, inline: true },
      { name: 'Screenshot', value: offer.screenshot_url || 'No screenshot', inline: false }
    )
    .setImage(offer.screenshot_url || null)
    .setFooter({ text: 'GG Sports • Trade Result' })
    .setTimestamp();
}

function buildTradeHistoryEmbed(league, rows, title = 'Trade History') {
  const embed = new EmbedBuilder()
    .setTitle(`${league?.league_name || 'League'} • ${title}`)
    .setColor(0xFEE75C)
    .setFooter({ text: 'GG Sports • Trade History' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No approved trades found yet.');
    return embed;
  }

  const lines = rows.map((row, index) => {
    const date = row.approved_by_committee_at ? new Date(row.approved_by_committee_at).toLocaleDateString('en-US') : 'Unknown date';
    const screenshotLine = row.screenshot_url ? `\n[View Screenshot](${row.screenshot_url})` : '';
    return `**${index + 1}. ${row.sender_team} ⇄ ${row.target_team}**\nSent by <@${row.sender_user_id}> • ${date}${screenshotLine}`;
  });

  embed.setDescription(lines.join('\n\n'));
  return embed;
}

function buildSeasonHistoryEmbed(league, data) {
  const embed = new EmbedBuilder()
    .setTitle(`${league.league_name} • ${data.seasonLabel} History`)
    .setColor(0xFEE75C)
    .addFields({ name: 'Champion', value: data.champion, inline: true })
    .setFooter({ text: 'GG Sports • League History' })
    .setTimestamp();

  if (data.runnerUp) embed.addFields({ name: 'Runner-Up', value: data.runnerUp, inline: true });
  if (data.mvp) embed.addFields({ name: 'MVP / Top Player', value: data.mvp, inline: false });

  const customAwards = parseCustomAwards(data.awards);
  if (customAwards.length > 0) {
    embed.addFields({ name: 'Award Winners', value: '━━━━━━━━━━━━━━', inline: false });
    for (const award of customAwards.slice(0, 20)) {
      embed.addFields({ name: award.name, value: award.value, inline: true });
    }
  }

  if (data.notes) embed.addFields({ name: 'Season Notes', value: data.notes, inline: false });
  return embed;
}

function buildFranchiseLegacyEmbed(league, rows) {
  const embed = new EmbedBuilder()
    .setTitle(`${league?.league_name || 'League'} • Franchise Legacy`)
    .setColor(0xFEE75C)
    .setFooter({ text: 'GG Sports • Franchise Legacy' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No franchise legacy records have been added yet.');
    return embed;
  }

  const lines = rows.map((row, index) => {
    const lastTitle = row.last_championship ? ` • Last Title: ${row.last_championship}` : '';
    return `**${index + 1}. ${row.franchise_name}** — ${row.championships} titles, ${row.finals_appearances} finals${lastTitle}`;
  });

  embed.setDescription(lines.join('\n'));
  return embed;
}

function buildAwardHistoryEmbed(league, rows, awardFilter = null) {
  const embed = new EmbedBuilder()
    .setTitle(`${league?.league_name || 'League'} • ${awardFilter ? `${awardFilter} History` : 'Award History'}`)
    .setColor(0x57F287)
    .setFooter({ text: 'GG Sports • Award History' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No award history has been added yet.');
    return embed;
  }

  const lines = rows.map(row => `**${row.season_label}** — ${row.award_name}: ${row.winner}`);
  embed.setDescription(lines.join('\n'));
  return embed;
}

function buildHallOfFameEmbed(league, franchiseRows, awardRows) {
  const NL = String.fromCharCode(10);

  const titleLeaders = franchiseRows.length
    ? franchiseRows
        .slice(0, 10)
        .map((row, index) => `**${index + 1}. ${row.franchise_name}** — ${row.championships} titles`)
        .join(NL)
    : 'No championship records yet.';

  const awardLeaders = awardRows.length
    ? awardRows
        .slice(0, 10)
        .map((row, index) => `**${index + 1}. ${row.winner}** — ${row.award_count} awards`)
        .join(NL)
    : 'No award records yet.';

  return new EmbedBuilder()
    .setTitle(`${league?.league_name || 'League'} • Hall of Fame`)
    .setColor(0xB8860B)
    .addFields(
      { name: 'Championship Leaders', value: titleLeaders, inline: false },
      { name: 'Award Leaders', value: awardLeaders, inline: false }
    )
    .setFooter({ text: 'GG Sports • Hall of Fame' })
    .setTimestamp();
}

function shortGameId(gameId) {
  return String(gameId || '').split('-')[0];
}

function buildScheduleEmbed(league, rows) {
  const NL = String.fromCharCode(10);

  const embed = new EmbedBuilder()
    .setTitle(`${league?.league_name || 'League'} • Schedule`)
    .setColor(0x5865F2)
    .setFooter({ text: 'GG Sports • Schedule' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No games have been scheduled yet.');
    return embed;
  }

  const lines = rows.map(row => {
    const score = row.status === 'final' ? ` • Final: ${row.away_score}-${row.home_score}` : '';
    const date = row.scheduled_for ? ` • ${row.scheduled_for}` : '';
    const week = row.week_label ? ` • ${row.week_label}` : '';
    return `**${shortGameId(row.id)}** — ${row.away_team_name} @ ${row.home_team_name}${week}${date} • ${row.status}${score}`;
  });

  embed.setDescription(lines.join(NL));
  return embed;
}

function buildStandingsEmbed(league, rows) {
  const NL = String.fromCharCode(10);

  const embed = new EmbedBuilder()
    .setTitle(`${league?.league_name || 'League'} • Standings`)
    .setColor(0x57F287)
    .setFooter({ text: 'GG Sports • Standings' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No standings records yet. Report a game or adjust standings to begin.');
    return embed;
  }

  const lines = rows.map((row, index) => {
    const games = Number(row.wins) + Number(row.losses);
    const winPct = games > 0 ? (Number(row.wins) / games).toFixed(3).replace(/^0/, '') : '.000';
    const diff = Number(row.points_for) - Number(row.points_against);
    return `**${index + 1}. ${row.team_name}** — ${row.wins}-${row.losses} (${winPct}) • DIFF ${diff >= 0 ? '+' : ''}${diff}`;
  });

  embed.setDescription(lines.join(NL));
  return embed;
}

function buildUserProfileEmbed(league, user, data) {
  return new EmbedBuilder()
    .setTitle(`${league?.league_name || 'League'} • ${user.username} Profile`)
    .setColor(0x5865F2)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'Team', value: data.teamName || 'No team assigned', inline: true },
      { name: 'Record', value: `${data.wins}-${data.losses}`, inline: true },
      { name: 'Games Played', value: String(data.gamesPlayed), inline: true },
      { name: 'Championships', value: String(data.championships), inline: true },
      { name: 'Finals Appearances', value: String(data.finalsAppearances), inline: true },
      { name: 'Awards', value: String(data.awardsWon), inline: true },
      { name: 'Approved Trades Involving Team', value: String(data.trades), inline: true }
    )
    .setFooter({ text: 'GG Sports • User Profile' })
    .setTimestamp();
}

function buildUserStatsEmbed(league, user, data) {
  const NL = String.fromCharCode(10);
  const recentGames = data.recentGames.length
    ? data.recentGames.map(game => {
        const isHome = game.home_team_role_id === data.teamRoleId;
        const teamScore = isHome ? game.home_score : game.away_score;
        const oppScore = isHome ? game.away_score : game.home_score;
        const opponent = isHome ? game.away_team_name : game.home_team_name;
        const result = game.winner_team_role_id === data.teamRoleId ? 'W' : 'L';
        return `**${result}** vs ${opponent} • ${teamScore}-${oppScore}`;
      }).join(NL)
    : 'No recent games found.';

  return new EmbedBuilder()
    .setTitle(`${league?.league_name || 'League'} • ${user.username} Stats`)
    .setColor(0x57F287)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'Team', value: data.teamName || 'No team assigned', inline: true },
      { name: 'Record', value: `${data.wins}-${data.losses}`, inline: true },
      { name: 'Win %', value: data.winPct, inline: true },
      { name: 'Points For', value: String(data.pointsFor), inline: true },
      { name: 'Points Against', value: String(data.pointsAgainst), inline: true },
      { name: 'Point Differential', value: `${data.pointDiff >= 0 ? '+' : ''}${data.pointDiff}`, inline: true },
      { name: 'Avg Points For', value: data.avgFor, inline: true },
      { name: 'Avg Points Against', value: data.avgAgainst, inline: true },
      { name: 'Games Played', value: String(data.gamesPlayed), inline: true },
      { name: 'Recent Games', value: recentGames, inline: false }
    )
    .setFooter({ text: 'GG Sports • Competitive Stats' })
    .setTimestamp();
}

function buildTeamProfileEmbed(league, teamRole, data) {
  const NL = String.fromCharCode(10);
  const recentAwards = data.awards.length
    ? data.awards.map(row => `**${row.season_label}** — ${row.award_name}: ${row.winner}`).join(NL)
    : 'No awards recorded.';

  return new EmbedBuilder()
    .setTitle(`${league?.league_name || 'League'} • ${teamRole.name} Profile`)
    .setColor(0xFEE75C)
    .addFields(
      { name: 'Record', value: `${data.wins}-${data.losses}`, inline: true },
      { name: 'Games Played', value: String(data.gamesPlayed), inline: true },
      { name: 'Point Differential', value: String(data.pointDiff), inline: true },
      { name: 'Championships', value: String(data.championships), inline: true },
      { name: 'Finals Appearances', value: String(data.finalsAppearances), inline: true },
      { name: 'Trades', value: String(data.trades), inline: true },
      { name: 'Recent Awards', value: recentAwards, inline: false }
    )
    .setFooter({ text: 'GG Sports • Team Profile' })
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
  const result = league?.league_id
    ? await pool.query('SELECT channel_id, message_id FROM league_panels WHERE league_id = $1 AND panel_key = $2', [league.league_id, panelKey])
    : await pool.query('SELECT channel_id, message_id FROM bot_panels WHERE panel_key = $1', [panelKey]);

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

async function getStandingsRows(guildId, leagueId) {
  const result = await pool.query(
    `SELECT * FROM league_standings
     WHERE guild_id = $1 AND league_id = $2
     ORDER BY wins DESC, losses ASC, (points_for - points_against) DESC, team_name ASC`,
    [guildId, leagueId]
  );
  return result.rows;
}

async function updateStandingsPanel(guild, league) {
  if (!guild || !league?.league_id) return;
  const rows = await getStandingsRows(guild.id, league.league_id);
  await updatePanel(guild, league, 'standings', buildStandingsEmbed(league, rows));
}

async function getVoteCounts(offerId) {
  const approveResult = await pool.query(`SELECT COUNT(*)::int AS count FROM trade_offer_votes WHERE offer_id = $1 AND vote = 'approve'`, [offerId]);
  const denyResult = await pool.query(`SELECT COUNT(*)::int AS count FROM trade_offer_votes WHERE offer_id = $1 AND vote = 'deny'`, [offerId]);
  return { approve: approveResult.rows[0].count, deny: denyResult.rows[0].count };
}

async function saveTradeHistory(guild, league, offer) {
  await pool.query(
    `INSERT INTO trade_history (
       id, guild_id, league_id, offer_id, sender_user_id, sender_team, sender_team_role_id,
       target_team, target_team_role_id, screenshot_url, approved_by_committee_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
    [
      randomUUID(),
      guild.id,
      league?.league_id || null,
      offer.id,
      offer.sender_user_id,
      offer.sender_team || 'Unknown Team',
      offer.sender_team_role_id || null,
      offer.target_team || 'Unknown Team',
      offer.target_team_role_id || null,
      offer.screenshot_url || null,
    ]
  );
}

async function finalizeApprovedTrade(guild, offerId) {
  const result = await pool.query('SELECT * FROM trade_offers WHERE id = $1', [offerId]);
  if (result.rows.length === 0) return;

  const offer = result.rows[0];
  const league = offer.league_id ? await getLeagueById(offer.league_id) : await getDefaultLeague(guild.id);

  await pool.query(`UPDATE trade_offers SET status = 'committee_approved' WHERE id = $1`, [offerId]);
  await saveTradeHistory(guild, league, offer);

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
  const league = offer.league_id ? await getLeagueById(offer.league_id) : await getDefaultLeague(guild.id);

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

    const league = pendingData.leagueId ? await getLeagueById(pendingData.leagueId) : await resolveLeague(message);
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
      `INSERT INTO trade_offers (
         id, guild_id, league_id, sender_user_id, sender_team, sender_team_role_id,
         target_team, target_team_role_id, target_owner_user_id, offer_details, screenshot_url, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_owner')`,
      [offerId, message.guild.id, league?.league_id || null, message.author.id, senderTeam.name, senderTeam.roleId || null, pendingData.targetTeamName, pendingData.targetTeamRoleId || null, targetOwner.id, '', attachment.url]
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
        const league = leagueId !== 'legacy' ? await getLeagueById(leagueId) : await resolveLeague(interaction);

        const playerName = interaction.fields.getTextInputValue('tradeblock_player_name');
        const position = interaction.fields.getTextInputValue('tradeblock_position');
        const age = interaction.fields.getTextInputValue('tradeblock_age');
        const ovr = interaction.fields.getTextInputValue('tradeblock_ovr');
        const salary = interaction.fields.getTextInputValue('tradeblock_salary');

        const channelId = league?.trade_block_channel_id || TRADE_BLOCK_CHANNEL_ID;
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
          await interaction.reply({ content: 'Trade block channel not found.', ephemeral: true });
          return;
        }

        await pool.query(
          `INSERT INTO trade_block_posts (id, posted_team, player_name, position, age, ovr, salary, submitted_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), team, playerName, position, age, ovr, salary, interaction.user.id]
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
          content: `<@&${league?.league_role_id || LEAGUE_ROLE_ID}>`,
          embeds: [embed],
          allowedMentions: { roles: [league?.league_role_id || LEAGUE_ROLE_ID], users: [] },
        });
        await interaction.reply({ content: 'Your trade block listing has been posted.', ephemeral: true });
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith('offer_trade_panel_button')) {
        const [, leagueId] = interaction.customId.split(':');
        const league = leagueId && leagueId !== 'legacy' ? await getLeagueById(leagueId) : await resolveLeague(interaction);
        const teamRoles = league?.league_id ? await getLeagueTeamRoles(league.league_id) : [];
        await interaction.reply({ content: 'Choose the team you are sending the offer to.', components: buildTeamSelectMenus(teamRoles, league?.league_id || 'legacy'), ephemeral: true });
        return;
      }

      if (interaction.customId.startsWith('trade_offer_accept:')) {
        const offerId = interaction.customId.split(':')[1];
        const result = await pool.query('SELECT * FROM trade_offers WHERE id = $1', [offerId]);
        if (result.rows.length === 0) {
          await interaction.reply({ content: 'That trade offer could not be found.', ephemeral: true });
          return;
        }
        const offer = result.rows[0];
        if (interaction.user.id !== offer.target_owner_user_id) {
          await interaction.reply({ content: 'Only the targeted team owner can accept this offer.', ephemeral: true });
          return;
        }
        const guild = await client.guilds.fetch(offer.guild_id || DEV_GUILD_ID);
        const league = offer.league_id ? await getLeagueById(offer.league_id) : await getDefaultLeague(guild.id);
        await pool.query(`UPDATE trade_offers SET status = 'owner_accepted', owner_decision_by = $1 WHERE id = $2`, [interaction.user.id, offerId]);
        const committeeChannel = await client.channels.fetch(league?.committee_channel_id || COMMITTEE_CHANNEL_ID);
        if (!committeeChannel || !committeeChannel.isTextBased()) {
          await interaction.reply({ content: 'Committee channel not found.', ephemeral: true });
          return;
        }
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
        if (result.rows.length === 0) {
          await interaction.reply({ content: 'That trade offer could not be found.', ephemeral: true });
          return;
        }
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
        if (!interaction.guild) {
          await interaction.reply({ content: 'Committee voting must happen inside the server.', ephemeral: true });
          return;
        }
        const isApprove = interaction.customId.startsWith('committee_vote_approve:');
        const offerId = interaction.customId.split(':')[1];
        const offerResult = await pool.query('SELECT * FROM trade_offers WHERE id = $1', [offerId]);
        if (offerResult.rows.length === 0) {
          await interaction.reply({ content: 'Trade offer not found.', ephemeral: true });
          return;
        }
        const offer = offerResult.rows[0];
        const league = offer.league_id ? await getLeagueById(offer.league_id) : await resolveLeague(interaction);
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!(await memberHasCommittee(member, league))) {
          await interaction.reply({ content: 'You do not have permission to vote on trades.', ephemeral: true });
          return;
        }
        if (offer.status === 'committee_approved' || offer.status === 'committee_denied') {
          await interaction.reply({ content: 'This trade has already been finalized.', ephemeral: true });
          return;
        }
        await pool.query(
          `INSERT INTO trade_offer_votes (offer_id, voter_user_id, vote)
           VALUES ($1, $2, $3)
           ON CONFLICT (offer_id, voter_user_id)
           DO UPDATE SET vote = $3`,
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
        const [, leagueId = 'legacy'] = interaction.customId.split(':');
        let targetTeamName = interaction.values[0];
        let targetTeamRoleId = null;
        let league = null;
        if (leagueId !== 'legacy') {
          league = await getLeagueById(leagueId);
          const teamRoles = await getLeagueTeamRoles(leagueId);
          const selected = teamRoles.find(team => team.role_id === interaction.values[0]);
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
      if (!(await userCanUseLeagueSetup(interaction))) {
        await interaction.reply({ content: 'You need server admin, Manage Server, or a configured league staff role to use league setup commands.', ephemeral: true });
        return;
      }

      if (interaction.commandName === 'league-create') {
        const name = interaction.options.getString('name');
        const game = interaction.options.getString('game').toLowerCase();
        const seasonLength = interaction.options.getInteger('season_length');
        const leagueId = randomUUID();
        await pool.query(`INSERT INTO guilds (guild_id, guild_name) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET guild_name = EXCLUDED.guild_name`, [interaction.guild.id, interaction.guild.name]);
        await pool.query(`INSERT INTO leagues (league_id, guild_id, league_name, game_key, season_length) VALUES ($1, $2, $3, $4, $5)`, [leagueId, interaction.guild.id, name, game, seasonLength]);
        await pool.query(`INSERT INTO league_settings (league_id) VALUES ($1) ON CONFLICT (league_id) DO NOTHING`, [leagueId]);
        await interaction.reply({ content: `Created league **${name}** for **${game}**${seasonLength ? ` with a ${seasonLength}-game season` : ''}.`, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'league-list') {
        const result = await pool.query(`SELECT league_name, game_key, season_length FROM leagues WHERE guild_id = $1 AND is_active = TRUE ORDER BY league_name ASC`, [interaction.guild.id]);
        const text = result.rows.length ? result.rows.map(row => `• **${row.league_name}** (${row.game_key}${row.season_length ? ` • ${row.season_length} games` : ''})`).join('\n') : 'No leagues configured yet.';
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
        await pool.query(`UPDATE league_settings SET league_role_id = $1, staff_role_id = $2, committee_role_id = $3, updated_at = NOW() WHERE league_id = $4`, [leagueRole.id, staffRole.id, committeeRole.id, league.league_id]);
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
          `UPDATE league_settings SET live_channel_id = $1, team_owners_channel_id = $2, trade_count_channel_id = $3, trade_block_channel_id = $4, offer_a_trade_channel_id = $5, committee_channel_id = $6, approved_channel_id = $7, denied_channel_id = $8, updated_at = NOW() WHERE league_id = $9`,
          [live.id, teamOwners.id, tradeCount.id, tradeBlock.id, offerTrade.id, committee.id, approved.id, denied.id, league.league_id]
        );
        await interaction.reply({ content: `Channels saved for **${league.league_name}**.`, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'league-sethistorychannel') {
        const channel = interaction.options.getChannel('channel');
        const botMember = await interaction.guild.members.fetchMe();
        const permissions = channel?.permissionsFor(botMember);
        if (!channel || !channel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
          await interaction.reply({ content: 'I need View Channel, Send Messages, and Embed Links permissions in that history channel.', ephemeral: true });
          return;
        }
        await pool.query(`UPDATE league_settings SET history_channel_id = $1, updated_at = NOW() WHERE league_id = $2`, [channel.id, league.league_id]);
        await interaction.reply({ content: `History channel for **${league.league_name}** set to ${channel}.`, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'league-setstandingschannel') {
        const channel = interaction.options.getChannel('channel');
        const botMember = await interaction.guild.members.fetchMe();
        const permissions = channel?.permissionsFor(botMember);
        if (!channel || !channel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
          await interaction.reply({ content: 'I need View Channel, Send Messages, and Embed Links permissions in that standings channel.', ephemeral: true });
          return;
        }
        await pool.query(`UPDATE league_settings SET standings_channel_id = $1, updated_at = NOW() WHERE league_id = $2`, [channel.id, league.league_id]);
        await interaction.reply({ content: `Standings channel for **${league.league_name}** set to ${channel}.`, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'league-addteamrole') {
        const role = interaction.options.getRole('role');
        await pool.query(`INSERT INTO league_team_roles (league_id, role_id, role_name) VALUES ($1, $2, $3) ON CONFLICT (league_id, role_id) DO UPDATE SET role_name = EXCLUDED.role_name`, [league.league_id, role.id, role.name]);
        await pool.query(`INSERT INTO league_trade_counts (league_id, role_id, team_name, trade_count) VALUES ($1, $2, $3, 0) ON CONFLICT (league_id, role_id) DO NOTHING`, [league.league_id, role.id, role.name]);
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
        const missing = [];
        if (!league.team_owners_channel_id) missing.push('team owners channel');
        if (!league.trade_count_channel_id) missing.push('trade count channel');
        if (!league.offer_a_trade_channel_id) missing.push('offer-a-trade channel');
        if (missing.length > 0) {
          await interaction.reply({ content: `This league is missing: ${missing.join(', ')}. Run /league-setchannels for **${league.league_name}** first.`, ephemeral: true });
          return;
        }
        const teamOwnersChannel = await interaction.guild.channels.fetch(league.team_owners_channel_id).catch(() => null);
        const tradeCountChannel = await interaction.guild.channels.fetch(league.trade_count_channel_id).catch(() => null);
        const offerTradeChannel = await interaction.guild.channels.fetch(league.offer_a_trade_channel_id).catch(() => null);
        const botMember = await interaction.guild.members.fetchMe();
        function canPostIn(channel) {
          if (!channel || !channel.isTextBased()) return false;
          const permissions = channel.permissionsFor(botMember);
          return Boolean(permissions?.has(PermissionFlagsBits.ViewChannel) && permissions?.has(PermissionFlagsBits.SendMessages) && permissions?.has(PermissionFlagsBits.EmbedLinks));
        }
        const inaccessible = [];
        if (!canPostIn(teamOwnersChannel)) inaccessible.push(`team owners channel (<#${league.team_owners_channel_id}>)`);
        if (!canPostIn(tradeCountChannel)) inaccessible.push(`trade count channel (<#${league.trade_count_channel_id}>)`);
        if (!canPostIn(offerTradeChannel)) inaccessible.push(`offer-a-trade channel (<#${league.offer_a_trade_channel_id}>)`);
        if (inaccessible.length > 0) {
          await interaction.reply({ content: `I cannot post in: ${inaccessible.join(', ')}. Give the bot View Channel, Send Messages, and Embed Links permissions there.`, ephemeral: true });
          return;
        }
        const teamOwnersMessage = await teamOwnersChannel.send({ embeds: [await buildTeamOwnersEmbed(interaction.guild, league)] });
        await savePanel(league, 'team_owners', teamOwnersChannel.id, teamOwnersMessage.id);
        const tradeCountMessage = await tradeCountChannel.send({ embeds: [await buildTradeCountEmbed(league)] });
        await savePanel(league, 'trade_count', tradeCountChannel.id, tradeCountMessage.id);
        if (league.standings_channel_id) {
          const standingsChannel = await interaction.guild.channels.fetch(league.standings_channel_id).catch(() => null);
          if (standingsChannel && standingsChannel.isTextBased()) {
            const standingsRows = await getStandingsRows(interaction.guild.id, league.league_id);
            const standingsMessage = await standingsChannel.send({ embeds: [buildStandingsEmbed(league, standingsRows)] });
            await savePanel(league, 'standings', standingsChannel.id, standingsMessage.id);
          }
        }
        const offerTradeMessage = await offerTradeChannel.send({ embeds: [buildOfferTradePanelEmbed(league.league_name)], components: [buildOfferTradePanelButton(league.league_id)] });
        await savePanel(league, 'offer_trade', offerTradeChannel.id, offerTradeMessage.id);
        await interaction.reply({ content: `Panels created for **${league.league_name}**.`, ephemeral: true });
        return;
      }
    }

    const league = await resolveLeague(interaction);
    const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;

    if (interaction.commandName === 'ping') {
      await interaction.reply({ content: 'GG Sports is live.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('GG Sports Setup Guide')
        .setColor(0x5865F2)
        .setDescription('Use this guide to set up GG Sports in your server.')
        .addFields(
          { name: '1. Create League', value: '`/league-create` — create a league and optionally set season length.', inline: false },
          { name: '2. Set Roles', value: '`/league-setroles` — set league ping, staff, and committee roles.', inline: false },
          { name: '3. Set Channels', value: '`/league-setchannels` — connect live, trade, committee, approved/denied, team owners, and trade count channels.', inline: false },
          { name: '4. History Channel', value: '`/league-sethistorychannel` — choose where season history embeds are posted.', inline: false },
          { name: '5. Add Teams', value: '`/league-addteamrole` — run once for each team role.', inline: false },
          { name: '6. Create Panels', value: '`/league-setup-panels` — posts Team Owners, Trade Count, and Offer Trade panels.', inline: false }
        )
        .setFooter({ text: 'GG Sports • Setup Guide' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'commands') {
      const isStaff = member && league ? await memberHasStaff(member, league) : false;
      const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
      const memberCommands = [
        '`/ping` — check if the bot is live',
        '`/help` — setup guide',
        '`/commands` — command list',
        '`/whogotnext` — ping your league that you are ready to play',
        '`/linkstream` — save your stream link',
        '`/livestream` — post your stream link',
        '`/tradeblock` — post a player to the trade block',
        '`/tradehistory` — view approved trades',
        '`/teamtrades` — view approved trades for a team',
        '`/franchiselegacy` — view franchise legacy records',
        '`/awardhistory` — view award history',
        '`/halloffame` — view Hall of Fame leaders',
      ];
      const staffCommands = [
        '`/assignrole` — assign a role',
        '`/unassignrole` — remove a role',
        '`/league-create` — create league',
        '`/league-setroles` — set roles',
        '`/league-setchannels` — set channels',
        '`/league-sethistorychannel` — set history channel',
        '`/league-addteamrole` — add team role',
        '`/league-listteamroles` — list team roles',
        '`/league-setup-panels` — create panels',
        '`/editleaguename` — rename league',
        '`/addseasonhistory` — post season history and update legacy records',
      ];
      const embed = new EmbedBuilder()
        .setTitle('GG Sports Commands')
        .setColor(0x57F287)
        .addFields(
          { name: 'Member Commands', value: memberCommands.join('\n'), inline: false },
          { name: 'Staff/Admin Commands', value: (isStaff || isAdmin) ? staffCommands.join('\n') : 'You do not currently have access to staff/admin commands.', inline: false }
        )
        .setFooter({ text: 'GG Sports • Commands' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'addseasonhistory') {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
      }
      const leagueName = interaction.options.getString('league');
      const activeLeague = await getLeagueByName(interaction.guild.id, leagueName);
      if (!activeLeague) {
        await interaction.reply({ content: `Could not find league **${leagueName}**.`, ephemeral: true });
        return;
      }
      if (!(await userCanUseLeagueSetup(interaction, activeLeague))) {
        await interaction.reply({ content: 'You do not have permission to add season history for this league.', ephemeral: true });
        return;
      }
      if (!activeLeague.history_channel_id) {
        await interaction.reply({ content: `No history channel is set for **${activeLeague.league_name}**. Use /league-sethistorychannel first.`, ephemeral: true });
        return;
      }
      const historyChannel = await interaction.guild.channels.fetch(activeLeague.history_channel_id).catch(() => null);
      const botMember = await interaction.guild.members.fetchMe();
      const permissions = historyChannel?.permissionsFor(botMember);
      if (!historyChannel || !historyChannel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
        await interaction.reply({ content: 'I cannot post in the configured history channel. Check my permissions there.', ephemeral: true });
        return;
      }

      const data = {
        seasonLabel: interaction.options.getString('season'),
        champion: interaction.options.getString('champion'),
        runnerUp: interaction.options.getString('runner_up'),
        mvp: interaction.options.getString('mvp'),
        awards: interaction.options.getString('awards'),
        notes: interaction.options.getString('notes'),
      };

      const embed = buildSeasonHistoryEmbed(activeLeague, data);
      const postedMessage = await historyChannel.send({ embeds: [embed] });

      await pool.query(
        `INSERT INTO season_history (id, guild_id, league_id, season_label, champion, runner_up, mvp, awards, notes, posted_channel_id, posted_message_id, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [randomUUID(), interaction.guild.id, activeLeague.league_id, data.seasonLabel, data.champion, data.runnerUp, data.mvp, data.awards, data.notes, historyChannel.id, postedMessage.id, interaction.user.id]
      );

      await pool.query(
        `INSERT INTO franchise_legacy (guild_id, league_id, franchise_name, championships, finals_appearances, last_championship, updated_at)
         VALUES ($1, $2, $3, 1, 1, $4, NOW())
         ON CONFLICT (guild_id, league_id, franchise_name)
         DO UPDATE SET championships = franchise_legacy.championships + 1, finals_appearances = franchise_legacy.finals_appearances + 1, last_championship = EXCLUDED.last_championship, updated_at = NOW()`,
        [interaction.guild.id, activeLeague.league_id, data.champion, data.seasonLabel]
      );

      if (data.runnerUp) {
        await pool.query(
          `INSERT INTO franchise_legacy (guild_id, league_id, franchise_name, championships, finals_appearances, updated_at)
           VALUES ($1, $2, $3, 0, 1, NOW())
           ON CONFLICT (guild_id, league_id, franchise_name)
           DO UPDATE SET finals_appearances = franchise_legacy.finals_appearances + 1, updated_at = NOW()`,
          [interaction.guild.id, activeLeague.league_id, data.runnerUp]
        );
      }

      const awardRows = [];
      if (data.mvp) awardRows.push({ name: 'MVP / Top Player', value: data.mvp });
      for (const award of parseCustomAwards(data.awards)) awardRows.push(award);
      for (const award of awardRows) {
        await pool.query(
          `INSERT INTO award_history (id, guild_id, league_id, season_label, award_name, winner, created_by_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), interaction.guild.id, activeLeague.league_id, data.seasonLabel, award.name, award.value, interaction.user.id]
        );
      }

      await interaction.reply({ content: `Season history posted for **${activeLeague.league_name} • ${data.seasonLabel}** in ${historyChannel}.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'franchiselegacy') {
      if (!interaction.guild) return;
      const requestedLeagueName = interaction.options.getString('league');
      const activeLeague = requestedLeagueName ? await getLeagueByName(interaction.guild.id, requestedLeagueName) : league;
      if (!activeLeague) {
        await interaction.reply({ content: 'No league found. Use this in a league channel or provide a league name.', ephemeral: true });
        return;
      }
      const result = await pool.query(
        `SELECT franchise_name, championships, finals_appearances, last_championship
         FROM franchise_legacy
         WHERE guild_id = $1 AND league_id = $2
         ORDER BY championships DESC, finals_appearances DESC, franchise_name ASC
         LIMIT 25`,
        [interaction.guild.id, activeLeague.league_id]
      );
      await interaction.reply({ embeds: [buildFranchiseLegacyEmbed(activeLeague, result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'awardhistory') {
      if (!interaction.guild) return;
      const requestedLeagueName = interaction.options.getString('league');
      const awardFilter = interaction.options.getString('award');
      const activeLeague = requestedLeagueName ? await getLeagueByName(interaction.guild.id, requestedLeagueName) : league;
      if (!activeLeague) {
        await interaction.reply({ content: 'No league found. Use this in a league channel or provide a league name.', ephemeral: true });
        return;
      }
      const result = awardFilter
        ? await pool.query(`SELECT season_label, award_name, winner FROM award_history WHERE guild_id = $1 AND league_id = $2 AND LOWER(award_name) = LOWER($3) ORDER BY created_at DESC LIMIT 25`, [interaction.guild.id, activeLeague.league_id, awardFilter])
        : await pool.query(`SELECT season_label, award_name, winner FROM award_history WHERE guild_id = $1 AND league_id = $2 ORDER BY created_at DESC LIMIT 25`, [interaction.guild.id, activeLeague.league_id]);
      await interaction.reply({ embeds: [buildAwardHistoryEmbed(activeLeague, result.rows, awardFilter)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'halloffame') {
      if (!interaction.guild) return;
      const requestedLeagueName = interaction.options.getString('league');
      const activeLeague = requestedLeagueName ? await getLeagueByName(interaction.guild.id, requestedLeagueName) : league;
      if (!activeLeague) {
        await interaction.reply({ content: 'No league found. Use this in a league channel or provide a league name.', ephemeral: true });
        return;
      }
      const franchiseResult = await pool.query(
        `SELECT franchise_name, championships FROM franchise_legacy WHERE guild_id = $1 AND league_id = $2 ORDER BY championships DESC, finals_appearances DESC, franchise_name ASC LIMIT 10`,
        [interaction.guild.id, activeLeague.league_id]
      );
      const awardResult = await pool.query(
        `SELECT winner, COUNT(*)::int AS award_count FROM award_history WHERE guild_id = $1 AND league_id = $2 GROUP BY winner ORDER BY award_count DESC, winner ASC LIMIT 10`,
        [interaction.guild.id, activeLeague.league_id]
      );
      await interaction.reply({ embeds: [buildHallOfFameEmbed(activeLeague, franchiseResult.rows, awardResult.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'setupstandings') {
      if (!interaction.guild) return;
      const leagueName = interaction.options.getString('league');
      const activeLeague = await getLeagueByName(interaction.guild.id, leagueName);
      if (!activeLeague) {
        await interaction.reply({ content: `Could not find league **${leagueName}**.`, ephemeral: true });
        return;
      }
      if (!(await userCanUseLeagueSetup(interaction, activeLeague))) {
        await interaction.reply({ content: 'You do not have permission to set up standings for this league.', ephemeral: true });
        return;
      }
      if (!activeLeague.standings_channel_id) {
        await interaction.reply({ content: `No standings channel is set for **${activeLeague.league_name}**. Use /league-setstandingschannel first.`, ephemeral: true });
        return;
      }
      const channel = await interaction.guild.channels.fetch(activeLeague.standings_channel_id).catch(() => null);
      const botMember = await interaction.guild.members.fetchMe();
      const permissions = channel?.permissionsFor(botMember);
      if (!channel || !channel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
        await interaction.reply({ content: 'I cannot post in the configured standings channel. Check my permissions there.', ephemeral: true });
        return;
      }
      const rows = await getStandingsRows(interaction.guild.id, activeLeague.league_id);
      const message = await channel.send({ embeds: [buildStandingsEmbed(activeLeague, rows)] });
      await savePanel(activeLeague, 'standings', channel.id, message.id);
      await interaction.reply({ content: `Permanent standings panel created for **${activeLeague.league_name}** in ${channel}.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'addgame') {
      if (!interaction.guild) return;
      const leagueName = interaction.options.getString('league');
      const activeLeague = await getLeagueByName(interaction.guild.id, leagueName);
      if (!activeLeague) {
        await interaction.reply({ content: `Could not find league **${leagueName}**.`, ephemeral: true });
        return;
      }
      if (!(await userCanUseLeagueSetup(interaction, activeLeague))) {
        await interaction.reply({ content: 'You do not have permission to add games for this league.', ephemeral: true });
        return;
      }

      const home = interaction.options.getRole('home');
      const away = interaction.options.getRole('away');
      const scheduledFor = interaction.options.getString('date');
      const weekLabel = interaction.options.getString('week');
      const gameId = randomUUID();

      if (home.id === away.id) {
        await interaction.reply({ content: 'Home and away teams must be different.', ephemeral: true });
        return;
      }

      await pool.query(
        `INSERT INTO league_games (id, guild_id, league_id, home_team_role_id, home_team_name, away_team_role_id, away_team_name, scheduled_for, week_label, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [gameId, interaction.guild.id, activeLeague.league_id, home.id, home.name, away.id, away.name, scheduledFor, weekLabel, interaction.user.id]
      );

      await pool.query(
        `INSERT INTO league_standings (guild_id, league_id, team_role_id, team_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (guild_id, league_id, team_role_id) DO NOTHING`,
        [interaction.guild.id, activeLeague.league_id, home.id, home.name]
      );
      await pool.query(
        `INSERT INTO league_standings (guild_id, league_id, team_role_id, team_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (guild_id, league_id, team_role_id) DO NOTHING`,
        [interaction.guild.id, activeLeague.league_id, away.id, away.name]
      );

      await interaction.reply({ content: `Game added: **${away.name} @ ${home.name}**. Game ID: **${shortGameId(gameId)}**`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'reportgame') {
      if (!interaction.guild) return;
      const gameIdInput = interaction.options.getString('game_id');
      const homeScore = interaction.options.getInteger('home_score');
      const awayScore = interaction.options.getInteger('away_score');

      const gameResult = await pool.query(
        `SELECT g.*, l.league_name, l.league_id
         FROM league_games g
         JOIN leagues l ON l.league_id = g.league_id
         WHERE g.guild_id = $1 AND g.id::text LIKE $2
         ORDER BY g.created_at DESC
         LIMIT 1`,
        [interaction.guild.id, `${gameIdInput}%`]
      );

      if (gameResult.rows.length === 0) {
        await interaction.reply({ content: 'Could not find that game ID. Use /schedule to see game IDs.', ephemeral: true });
        return;
      }

      const game = gameResult.rows[0];
      const activeLeague = await getLeagueById(game.league_id);
      if (!(await userCanUseLeagueSetup(interaction, activeLeague))) {
        await interaction.reply({ content: 'You do not have permission to report games for this league.', ephemeral: true });
        return;
      }

      if (homeScore === awayScore) {
        await interaction.reply({ content: 'Tie scores are not currently supported. Please enter a winner.', ephemeral: true });
        return;
      }

      const homeWon = homeScore > awayScore;
      const winnerRoleId = homeWon ? game.home_team_role_id : game.away_team_role_id;
      const loserRoleId = homeWon ? game.away_team_role_id : game.home_team_role_id;
      const winnerName = homeWon ? game.home_team_name : game.away_team_name;
      const loserName = homeWon ? game.away_team_name : game.home_team_name;
      const winnerPf = homeWon ? homeScore : awayScore;
      const winnerPa = homeWon ? awayScore : homeScore;
      const loserPf = homeWon ? awayScore : homeScore;
      const loserPa = homeWon ? homeScore : awayScore;

      await pool.query(
        `UPDATE league_games
         SET status = 'final', home_score = $1, away_score = $2, winner_team_role_id = $3, reported_by_user_id = $4, updated_at = NOW()
         WHERE id = $5`,
        [homeScore, awayScore, winnerRoleId, interaction.user.id, game.id]
      );

      await pool.query(
        `INSERT INTO league_standings (guild_id, league_id, team_role_id, team_name, wins, losses, points_for, points_against)
         VALUES ($1, $2, $3, $4, 1, 0, $5, $6)
         ON CONFLICT (guild_id, league_id, team_role_id)
         DO UPDATE SET wins = league_standings.wins + 1, points_for = league_standings.points_for + $5, points_against = league_standings.points_against + $6, updated_at = NOW()`,
        [interaction.guild.id, activeLeague.league_id, winnerRoleId, winnerName, winnerPf, winnerPa]
      );

      await pool.query(
        `INSERT INTO league_standings (guild_id, league_id, team_role_id, team_name, wins, losses, points_for, points_against)
         VALUES ($1, $2, $3, $4, 0, 1, $5, $6)
         ON CONFLICT (guild_id, league_id, team_role_id)
         DO UPDATE SET losses = league_standings.losses + 1, points_for = league_standings.points_for + $5, points_against = league_standings.points_against + $6, updated_at = NOW()`,
        [interaction.guild.id, activeLeague.league_id, loserRoleId, loserName, loserPf, loserPa]
      );

      await updateStandingsPanel(interaction.guild, activeLeague);
      await interaction.reply({ content: `Final recorded: **${game.away_team_name} ${awayScore} @ ${game.home_team_name} ${homeScore}**. Winner: **${winnerName}**`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'schedule') {
      if (!interaction.guild) return;
      const requestedLeagueName = interaction.options.getString('league');
      const activeLeague = requestedLeagueName ? await getLeagueByName(interaction.guild.id, requestedLeagueName) : league;
      if (!activeLeague) {
        await interaction.reply({ content: 'No league found. Use this in a league channel or provide a league name.', ephemeral: true });
        return;
      }
      const result = await pool.query(
        `SELECT * FROM league_games
         WHERE guild_id = $1 AND league_id = $2
         ORDER BY created_at DESC
         LIMIT 20`,
        [interaction.guild.id, activeLeague.league_id]
      );
      await interaction.reply({ embeds: [buildScheduleEmbed(activeLeague, result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'standings') {
      if (!interaction.guild) return;
      const requestedLeagueName = interaction.options.getString('league');
      const activeLeague = requestedLeagueName ? await getLeagueByName(interaction.guild.id, requestedLeagueName) : league;
      if (!activeLeague) {
        await interaction.reply({ content: 'No league found. Use this in a league channel or provide a league name.', ephemeral: true });
        return;
      }
      const result = await pool.query(
        `SELECT * FROM league_standings
         WHERE guild_id = $1 AND league_id = $2
         ORDER BY wins DESC, losses ASC, (points_for - points_against) DESC, team_name ASC`,
        [interaction.guild.id, activeLeague.league_id]
      );
      await interaction.reply({ embeds: [buildStandingsEmbed(activeLeague, result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'adjuststandings') {
      if (!interaction.guild) return;
      const leagueName = interaction.options.getString('league');
      const activeLeague = await getLeagueByName(interaction.guild.id, leagueName);
      if (!activeLeague) {
        await interaction.reply({ content: `Could not find league **${leagueName}**.`, ephemeral: true });
        return;
      }
      if (!(await userCanUseLeagueSetup(interaction, activeLeague))) {
        await interaction.reply({ content: 'You do not have permission to adjust standings for this league.', ephemeral: true });
        return;
      }
      const team = interaction.options.getRole('team');
      const wins = interaction.options.getInteger('wins');
      const losses = interaction.options.getInteger('losses');
      await pool.query(
        `INSERT INTO league_standings (guild_id, league_id, team_role_id, team_name, wins, losses)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (guild_id, league_id, team_role_id)
         DO UPDATE SET wins = $5, losses = $6, team_name = $4, updated_at = NOW()`,
        [interaction.guild.id, activeLeague.league_id, team.id, team.name, wins, losses]
      );
      await updateStandingsPanel(interaction.guild, activeLeague);
      await interaction.reply({ content: `Standings adjusted: **${team.name}** is now **${wins}-${losses}**.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'profile' || interaction.commandName === 'stats') {
      if (!interaction.guild) return;
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const requestedLeagueName = interaction.options.getString('league');
      const activeLeague = requestedLeagueName ? await getLeagueByName(interaction.guild.id, requestedLeagueName) : league;
      if (!activeLeague) {
        await interaction.reply({ content: 'No league found. Use this in a league channel or provide a league name.', ephemeral: true });
        return;
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        await interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true });
        return;
      }

      const team = await getMemberTeamForLeague(targetMember, activeLeague);
      let wins = 0;
      let losses = 0;
      let gamesPlayed = 0;
      let championships = 0;
      let finalsAppearances = 0;
      let awardsWon = 0;
      let trades = 0;
      let pointsFor = 0;
      let pointsAgainst = 0;
      let pointDiff = 0;
      let recentGames = [];

      if (team) {
        const standingsResult = await pool.query(
          `SELECT wins, losses, points_for, points_against FROM league_standings WHERE guild_id = $1 AND league_id = $2 AND team_role_id = $3`,
          [interaction.guild.id, activeLeague.league_id, team.roleId]
        );
        if (standingsResult.rows.length) {
          wins = Number(standingsResult.rows[0].wins);
          losses = Number(standingsResult.rows[0].losses);
          pointsFor = Number(standingsResult.rows[0].points_for || 0);
          pointsAgainst = Number(standingsResult.rows[0].points_against || 0);
          pointDiff = pointsFor - pointsAgainst;
          gamesPlayed = wins + losses;
        }

        const legacyResult = await pool.query(
          `SELECT championships, finals_appearances FROM franchise_legacy WHERE guild_id = $1 AND league_id = $2 AND LOWER(franchise_name) = LOWER($3)`,
          [interaction.guild.id, activeLeague.league_id, team.name]
        );
        if (legacyResult.rows.length) {
          championships = Number(legacyResult.rows[0].championships);
          finalsAppearances = Number(legacyResult.rows[0].finals_appearances);
        }

        const tradeResult = await pool.query(
          `SELECT COUNT(*)::int AS count FROM trade_history
           WHERE guild_id = $1 AND league_id = $2
           AND (sender_team_role_id = $3 OR target_team_role_id = $3 OR LOWER(sender_team) = LOWER($4) OR LOWER(target_team) = LOWER($4))`,
          [interaction.guild.id, activeLeague.league_id, team.roleId, team.name]
        );
        trades = tradeResult.rows[0]?.count || 0;

        const recentResult = await pool.query(
          `SELECT * FROM league_games
           WHERE guild_id = $1 AND league_id = $2 AND status = 'final'
           AND (home_team_role_id = $3 OR away_team_role_id = $3)
           ORDER BY updated_at DESC
           LIMIT 5`,
          [interaction.guild.id, activeLeague.league_id, team.roleId]
        );
        recentGames = recentResult.rows;
      }

      const awardResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM award_history
         WHERE guild_id = $1 AND league_id = $2 AND (winner ILIKE $3 OR winner ILIKE $4)`,
        [interaction.guild.id, activeLeague.league_id, `%${targetUser.username}%`, `%${targetMember.displayName}%`]
      );
      awardsWon = awardResult.rows[0]?.count || 0;

      if (interaction.commandName === 'stats') {
        const winPct = gamesPlayed > 0 ? (wins / gamesPlayed).toFixed(3).replace(/^0/, '') : '.000';
        const avgFor = gamesPlayed > 0 ? (pointsFor / gamesPlayed).toFixed(1) : '0.0';
        const avgAgainst = gamesPlayed > 0 ? (pointsAgainst / gamesPlayed).toFixed(1) : '0.0';
        await interaction.reply({
          embeds: [buildUserStatsEmbed(activeLeague, targetUser, {
            teamName: team?.name || null,
            teamRoleId: team?.roleId || null,
            wins,
            losses,
            gamesPlayed,
            pointsFor,
            pointsAgainst,
            pointDiff,
            winPct,
            avgFor,
            avgAgainst,
            recentGames,
          })],
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        embeds: [buildUserProfileEmbed(activeLeague, targetUser, {
          teamName: team?.name || null,
          wins,
          losses,
          gamesPlayed,
          championships,
          finalsAppearances,
          awardsWon,
          trades,
        })],
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'teamprofile') {
      if (!interaction.guild) return;
      const teamRole = interaction.options.getRole('team');
      const requestedLeagueName = interaction.options.getString('league');
      const activeLeague = requestedLeagueName ? await getLeagueByName(interaction.guild.id, requestedLeagueName) : league;
      if (!activeLeague) {
        await interaction.reply({ content: 'No league found. Use this in a league channel or provide a league name.', ephemeral: true });
        return;
      }

      const standingsResult = await pool.query(
        `SELECT wins, losses, points_for, points_against FROM league_standings WHERE guild_id = $1 AND league_id = $2 AND team_role_id = $3`,
        [interaction.guild.id, activeLeague.league_id, teamRole.id]
      );
      const standings = standingsResult.rows[0] || { wins: 0, losses: 0, points_for: 0, points_against: 0 };
      const wins = Number(standings.wins);
      const losses = Number(standings.losses);
      const gamesPlayed = wins + losses;
      const pointDiff = Number(standings.points_for) - Number(standings.points_against);

      const legacyResult = await pool.query(
        `SELECT championships, finals_appearances FROM franchise_legacy WHERE guild_id = $1 AND league_id = $2 AND LOWER(franchise_name) = LOWER($3)`,
        [interaction.guild.id, activeLeague.league_id, teamRole.name]
      );
      const legacy = legacyResult.rows[0] || { championships: 0, finals_appearances: 0 };

      const tradeResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM trade_history
         WHERE guild_id = $1 AND league_id = $2
         AND (sender_team_role_id = $3 OR target_team_role_id = $3 OR LOWER(sender_team) = LOWER($4) OR LOWER(target_team) = LOWER($4))`,
        [interaction.guild.id, activeLeague.league_id, teamRole.id, teamRole.name]
      );

      const awardsResult = await pool.query(
        `SELECT season_label, award_name, winner FROM award_history
         WHERE guild_id = $1 AND league_id = $2 AND winner ILIKE $3
         ORDER BY created_at DESC
         LIMIT 8`,
        [interaction.guild.id, activeLeague.league_id, `%${teamRole.name}%`]
      );

      await interaction.reply({
        embeds: [buildTeamProfileEmbed(activeLeague, teamRole, {
          wins,
          losses,
          gamesPlayed,
          pointDiff,
          championships: Number(legacy.championships),
          finalsAppearances: Number(legacy.finals_appearances),
          trades: tradeResult.rows[0]?.count || 0,
          awards: awardsResult.rows,
        })],
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'tradehistory') {
      if (!interaction.guild) return;
      const requestedLeagueName = interaction.options.getString('league');
      const activeLeague = requestedLeagueName ? await getLeagueByName(interaction.guild.id, requestedLeagueName) : league;
      if (!activeLeague) {
        await interaction.reply({ content: 'No league found. Use this in a league channel or provide a league name.', ephemeral: true });
        return;
      }
      const result = await pool.query(`SELECT * FROM trade_history WHERE guild_id = $1 AND league_id = $2 ORDER BY approved_by_committee_at DESC LIMIT 10`, [interaction.guild.id, activeLeague.league_id]);
      await interaction.reply({ embeds: [buildTradeHistoryEmbed(activeLeague, result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'teamtrades') {
      if (!interaction.guild) return;
      const teamRole = interaction.options.getRole('team');
      const requestedLeagueName = interaction.options.getString('league');
      const activeLeague = requestedLeagueName ? await getLeagueByName(interaction.guild.id, requestedLeagueName) : league;
      if (!activeLeague) {
        await interaction.reply({ content: 'No league found. Use this in a league channel or provide a league name.', ephemeral: true });
        return;
      }
      const result = await pool.query(
        `SELECT * FROM trade_history
         WHERE guild_id = $1 AND league_id = $2
         AND (sender_team_role_id = $3 OR target_team_role_id = $3 OR LOWER(sender_team) = LOWER($4) OR LOWER(target_team) = LOWER($4))
         ORDER BY approved_by_committee_at DESC LIMIT 10`,
        [interaction.guild.id, activeLeague.league_id, teamRole.id, teamRole.name]
      );
      await interaction.reply({ embeds: [buildTradeHistoryEmbed(activeLeague, result.rows, `${teamRole.name} Trades`)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'editleaguename') {
      if (!interaction.guild) return;
      const currentName = interaction.options.getString('league');
      const newName = interaction.options.getString('new_name');
      const leagueToRename = await getLeagueByName(interaction.guild.id, currentName);
      if (!leagueToRename) {
        await interaction.reply({ content: `Could not find league **${currentName}**.`, ephemeral: true });
        return;
      }
      if (!(await userCanUseLeagueSetup(interaction, leagueToRename))) {
        await interaction.reply({ content: 'You do not have permission to rename this league.', ephemeral: true });
        return;
      }
      await pool.query(`UPDATE leagues SET league_name = $1 WHERE league_id = $2`, [newName, leagueToRename.league_id]);
      const updatedLeague = await getLeagueByName(interaction.guild.id, newName);
      await updateTeamOwnersPanel(interaction.guild, updatedLeague);
      await updateTradeCountPanel(interaction.guild, updatedLeague);
      await updatePanel(interaction.guild, updatedLeague, 'offer_trade', buildOfferTradePanelEmbed(updatedLeague.league_name), [buildOfferTradePanelButton(updatedLeague.league_id)]);
      await interaction.reply({ content: `League renamed from **${currentName}** to **${newName}**. Panels updated.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'whogotnext') {
      const requestedLeagueName = interaction.options.getString('league');
      const activeLeague = requestedLeagueName && interaction.guild ? await getLeagueByName(interaction.guild.id, requestedLeagueName) : league;
      if (requestedLeagueName && !activeLeague) {
        await interaction.reply({ content: `Could not find league **${requestedLeagueName}**.`, ephemeral: true });
        return;
      }
      const extraMessage = interaction.options.getString('message');
      let text = `<@&${activeLeague?.league_role_id || LEAGUE_ROLE_ID}> <@${interaction.user.id}> is available to play right now.`;
      if (extraMessage) text += ` ${extraMessage}`;
      await interaction.reply({ content: text, allowedMentions: { roles: [activeLeague?.league_role_id || LEAGUE_ROLE_ID], users: [interaction.user.id] } });
      return;
    }

    if (interaction.commandName === 'linkstream') {
      const url = interaction.options.getString('url');
      if (interaction.guild) {
        await pool.query(`INSERT INTO guilds (guild_id, guild_name) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET guild_name = EXCLUDED.guild_name`, [interaction.guild.id, interaction.guild.name]);
        await pool.query(
          `INSERT INTO guild_stream_links (guild_id, user_id, stream_url, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (guild_id, user_id)
           DO UPDATE SET stream_url = EXCLUDED.stream_url, updated_at = NOW()`,
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

    if (interaction.commandName === 'assignrole' || interaction.commandName === 'unassignrole') {
      if (!interaction.guild || !(member && (await memberHasStaff(member, league)))) {
        await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }
      const targetUser = interaction.options.getUser('member');
      const role = interaction.options.getRole('role');
      const targetMember = await interaction.guild.members.fetch(targetUser.id);
      if (interaction.commandName === 'assignrole') await targetMember.roles.add(role);
      else await targetMember.roles.remove(role);
      const configuredTeamRoles = league?.league_id ? await getLeagueTeamRoles(league.league_id) : [];
      if (configuredTeamRoles.some(team => team.role_id === role.id) || isLegacyTeamRole(role.name)) await updateTeamOwnersPanel(interaction.guild, league);
      await interaction.reply({ content: `${interaction.commandName === 'assignrole' ? 'Assigned' : 'Removed'} ${role} ${interaction.commandName === 'assignrole' ? 'to' : 'from'} ${targetMember}.`, ephemeral: true });
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
      const modal = new ModalBuilder()
        .setCustomId(`tradeblock_modal:${encodeURIComponent(teamRole.name)}:${league?.league_id || 'legacy'}`)
        .setTitle('Trade Block Submission');
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
