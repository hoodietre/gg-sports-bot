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
const COMMAND_GUILD_IDS = (process.env.GUILD_IDS || process.env.GUILD_ID || DEV_GUILD_ID)
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);
const USE_GLOBAL_COMMANDS = true;

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
      tournament_channel_id TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE league_settings ADD COLUMN IF NOT EXISTS history_channel_id TEXT`);
  await pool.query(`ALTER TABLE league_settings ADD COLUMN IF NOT EXISTS standings_channel_id TEXT`);
  await pool.query(`ALTER TABLE league_settings ADD COLUMN IF NOT EXISTS tournament_channel_id TEXT`);

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
      announcement_channel_id TEXT,
      announcement_message_id TEXT,
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_currency_settings (
      guild_id TEXT PRIMARY KEY,
      currency_name TEXT NOT NULL DEFAULT 'GG Coins',
      currency_icon TEXT NOT NULL DEFAULT '🪙',
      win_payout INTEGER NOT NULL DEFAULT 100,
      game_played_payout INTEGER NOT NULL DEFAULT 25,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_currency_balances (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0,
      lifetime_earned INTEGER NOT NULL DEFAULT 0,
      lifetime_spent INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  await pool.query(`ALTER TABLE guild_currency_settings ADD COLUMN IF NOT EXISTS game_played_payout INTEGER NOT NULL DEFAULT 25`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS currency_transactions (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      reason TEXT,
      issued_by_user_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_items (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      description TEXT,
      price INTEGER NOT NULL,
      stock INTEGER,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_inventory (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      item_id UUID REFERENCES shop_items(id) ON DELETE SET NULL,
      item_name TEXT NOT NULL,
      price_paid INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'owned',
      request_note TEXT,
      fulfillment_note TEXT,
      fulfilled_by_user_id TEXT,
      purchased_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_tournament_settings (
      guild_id TEXT PRIMARY KEY,
      tournament_channel_id TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      league_id UUID REFERENCES leagues(league_id) ON DELETE SET NULL,
      tournament_name TEXT NOT NULL,
      game TEXT,
      format TEXT NOT NULL DEFAULT 'single_elim',
      max_entries INTEGER,
      buy_in INTEGER NOT NULL DEFAULT 0,
      prize TEXT,
      prize_pool INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_by_user_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_entries (
      tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      entry_name TEXT,
      paid_buy_in INTEGER NOT NULL DEFAULT 0,
      seed INTEGER,
      joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tournament_id, user_id)
    )
  `);

  await pool.query(`ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS seed INTEGER`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_matches (
      id UUID PRIMARY KEY,
      tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      match_number INTEGER NOT NULL,
      player1_user_id TEXT,
      player1_entry_name TEXT,
      player2_user_id TEXT,
      player2_entry_name TEXT,
      winner_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      reported_by_user_id TEXT,
      thread_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS thread_id TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_panels (
      tournament_id UUID PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE tournament_panels ADD COLUMN IF NOT EXISTS announcement_channel_id TEXT`);
  await pool.query(`ALTER TABLE tournament_panels ADD COLUMN IF NOT EXISTS announcement_message_id TEXT`);

  await pool.query(`ALTER TABLE tournament_history ADD COLUMN IF NOT EXISTS mvp_user_id TEXT`);
  await pool.query(`ALTER TABLE tournament_history ADD COLUMN IF NOT EXISTS mvp_payout INTEGER NOT NULL DEFAULT 0`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_history (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      league_id UUID REFERENCES leagues(league_id) ON DELETE SET NULL,
      tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
      tournament_name TEXT NOT NULL,
      game TEXT,
      format TEXT,
      champion_user_id TEXT NOT NULL,
      prize_paid INTEGER NOT NULL DEFAULT 0,
      mvp_user_id TEXT,
      mvp_payout INTEGER NOT NULL DEFAULT 0,
      completed_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      league_id UUID REFERENCES leagues(league_id) ON DELETE SET NULL,
      user_id TEXT NOT NULL,
      ticket_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      channel_id TEXT,
      thread_id TEXT,
      assigned_staff_user_id TEXT,
      review_decision TEXT,
      review_decision_by_user_id TEXT,
      review_decision_at TIMESTAMP,
      game_id TEXT,
      request_action TEXT,
      requested_team_role_id TEXT,
      opponent_user_id TEXT,
      closed_by_user_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS close_reason TEXT`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS review_decision TEXT`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS review_decision_by_user_id TEXT`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS review_decision_at TIMESTAMP`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS game_id TEXT`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS request_action TEXT`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS requested_team_role_id TEXT`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS opponent_user_id TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_transcripts (
      id UUID PRIMARY KEY,
      ticket_id UUID REFERENCES support_tickets(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      message_author_id TEXT,
      message_author_tag TEXT,
      message_content TEXT,
      attachment_urls TEXT,
      message_created_at TIMESTAMP,
      saved_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_panels (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_evidence (
      id UUID PRIMARY KEY,
      ticket_id UUID REFERENCES support_tickets(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      attachment_url TEXT NOT NULL,
      file_name TEXT,
      content_type TEXT,
      message_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sportsbook_games (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      league_id UUID REFERENCES leagues(league_id) ON DELETE SET NULL,
      game_label TEXT NOT NULL,
      home_label TEXT NOT NULL,
      away_label TEXT NOT NULL,
      home_odds INTEGER NOT NULL DEFAULT -110,
      away_odds INTEGER NOT NULL DEFAULT -110,
      status TEXT NOT NULL DEFAULT 'open',
      winner_side TEXT,
      max_bet INTEGER,
      max_payout INTEGER,
      created_by_user_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      settled_at TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE sportsbook_games ADD COLUMN IF NOT EXISTS max_bet INTEGER`);
  await pool.query(`ALTER TABLE sportsbook_games ADD COLUMN IF NOT EXISTS max_payout INTEGER`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sportsbook_bets (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      sportsbook_game_id UUID REFERENCES sportsbook_games(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      side TEXT NOT NULL,
      amount INTEGER NOT NULL,
      odds INTEGER NOT NULL,
      potential_payout INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      settled_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sportsbook_panels (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sportsbook_settings (
      guild_id TEXT PRIMARY KEY,
      feed_channel_id TEXT,
      big_bet_threshold INTEGER NOT NULL DEFAULT 500,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_recognition (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      activity_points INTEGER NOT NULL DEFAULT 0,
      legacy_score INTEGER NOT NULL DEFAULT 0,
      championships INTEGER NOT NULL DEFAULT 0,
      tournament_titles INTEGER NOT NULL DEFAULT 0,
      sportsbook_wins INTEGER NOT NULL DEFAULT 0,
      sportsbook_profit INTEGER NOT NULL DEFAULT 0,
      tickets_resolved INTEGER NOT NULL DEFAULT 0,
      games_played INTEGER NOT NULL DEFAULT 0,
      activity_streak INTEGER NOT NULL DEFAULT 0,
      last_activity_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  await pool.query(`ALTER TABLE user_recognition ADD COLUMN IF NOT EXISTS activity_points INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`UPDATE user_recognition SET activity_points = recognition_points WHERE activity_points = 0 AND recognition_points IS NOT NULL`).catch(() => null);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS league_awards (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      league_id UUID REFERENCES leagues(league_id) ON DELETE SET NULL,
      season_label TEXT,
      award_name TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS championship_history (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      league_id UUID REFERENCES leagues(league_id) ON DELETE SET NULL,
      season_label TEXT,
      team_name TEXT,
      winner_user_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_milestones_claimed (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      milestone_key TEXT NOT NULL,
      claimed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id, milestone_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_settings (
      guild_id TEXT PRIMARY KEY,
      milestone_channel_id TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sportsbook_parlays (
      id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      combined_decimal NUMERIC NOT NULL,
      potential_payout INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      settled_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sportsbook_parlay_legs (
      id UUID PRIMARY KEY,
      parlay_id UUID REFERENCES sportsbook_parlays(id) ON DELETE CASCADE,
      sportsbook_game_id UUID REFERENCES sportsbook_games(id) ON DELETE CASCADE,
      side TEXT NOT NULL,
      odds INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    )
  `);

  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_staff_user_id TEXT`);

  await pool.query(`ALTER TABLE user_inventory ADD COLUMN IF NOT EXISTS request_note TEXT`);
  await pool.query(`ALTER TABLE user_inventory ADD COLUMN IF NOT EXISTS fulfillment_note TEXT`);
  await pool.query(`ALTER TABLE user_inventory ADD COLUMN IF NOT EXISTS fulfilled_by_user_id TEXT`);
  await pool.query(`ALTER TABLE user_inventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`);

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
      .setName('league-settournamentchannel')
      .setDescription('Set the league tournament/bracket channel')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('League tournament channel').setRequired(true)),

    new SlashCommandBuilder()
      .setName('settournamentchannel')
      .setDescription('Set the default server tournament/bracket channel')
      .addChannelOption(o => o.setName('channel').setDescription('Server tournament channel').setRequired(true)),

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
      .setName('setcurrency')
      .setDescription('Configure this server’s currency')
      .addStringOption(o => o.setName('name').setDescription('Currency name, ex: Ghost Gold').setRequired(true))
      .addStringOption(o => o.setName('icon').setDescription('Currency icon/emoji, ex: 🪙').setRequired(false))
      .addIntegerOption(o => o.setName('win_payout').setDescription('Bonus amount earned for a reported win').setRequired(false))
      .addIntegerOption(o => o.setName('game_played_payout').setDescription('Amount each owner earns for playing a completed game').setRequired(false)),

    new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check your balance or another user’s balance')
      .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(false)),

    new SlashCommandBuilder()
      .setName('transfer')
      .setDescription('Transfer currency to another user')
      .addUserOption(o => o.setName('user').setDescription('User receiving currency').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to transfer').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Optional reason').setRequired(false)),

    new SlashCommandBuilder()
      .setName('givecurrency')
      .setDescription('Admin/staff: give currency to a user')
      .addUserOption(o => o.setName('user').setDescription('User receiving currency').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to give').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
      .setName('takecurrency')
      .setDescription('Admin/staff: remove currency from a user')
      .addUserOption(o => o.setName('user').setDescription('User losing currency').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to remove').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
      .setName('createshopitem')
      .setDescription('Admin/staff: create a shop item')
      .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption(o => o.setName('price').setDescription('Item price').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Item description').setRequired(false))
      .addIntegerOption(o => o.setName('stock').setDescription('Optional limited stock').setRequired(false)),

    new SlashCommandBuilder()
      .setName('shop')
      .setDescription('View the server shop'),

    new SlashCommandBuilder()
      .setName('buy')
      .setDescription('Buy an item from the shop')
      .addStringOption(o => o.setName('item').setDescription('Item name or short ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('inventory')
      .setDescription('View your inventory or another user’s inventory')
      .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false)),

    new SlashCommandBuilder()
      .setName('removeshopitem')
      .setDescription('Admin/staff: remove/deactivate a shop item')
      .addStringOption(o => o.setName('item').setDescription('Item name or short ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('useitem')
      .setDescription('Request to use/redeem an inventory item')
      .addStringOption(o => o.setName('item').setDescription('Inventory item name or short ID').setRequired(true))
      .addStringOption(o => o.setName('note').setDescription('Optional note for staff').setRequired(false)),

    new SlashCommandBuilder()
      .setName('redeemitem')
      .setDescription('Admin/staff: mark a user inventory item as redeemed/fulfilled')
      .addUserOption(o => o.setName('user').setDescription('User who owns the item').setRequired(true))
      .addStringOption(o => o.setName('item').setDescription('Inventory item name or short ID').setRequired(true))
      .addStringOption(o => o.setName('status').setDescription('New status: redeemed, used, owned, requested').setRequired(false))
      .addStringOption(o => o.setName('note').setDescription('Optional fulfillment note').setRequired(false)),

    new SlashCommandBuilder()
      .setName('economy')
      .setDescription('Show this server’s economy settings and activity'),

    new SlashCommandBuilder()
      .setName('richest')
      .setDescription('Show the richest users in the server'),

    new SlashCommandBuilder()
      .setName('transactions')
      .setDescription('Show your recent currency transactions or another user’s')
      .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false)),

    new SlashCommandBuilder()
      .setName('banklog')
      .setDescription('Admin/staff: view recent server economy transactions'),

    new SlashCommandBuilder()
      .setName('createtournament')
      .setDescription('Admin/staff: create a tournament')
      .addStringOption(o => o.setName('name').setDescription('Tournament name').setRequired(true))
      .addStringOption(o => o.setName('game').setDescription('Game, ex: NBA 2K or MLB The Show').setRequired(true))
      .addStringOption(o => o.setName('format').setDescription('single_elim, double_elim, round_robin').setRequired(false))
      .addIntegerOption(o => o.setName('max_entries').setDescription('Maximum number of entries').setRequired(false))
      .addIntegerOption(o => o.setName('buy_in').setDescription('Currency buy-in amount').setRequired(false))
      .addStringOption(o => o.setName('prize').setDescription('Prize description').setRequired(false))
      .addStringOption(o => o.setName('date').setDescription('Start date/time').setRequired(false))
      .addStringOption(o => o.setName('league').setDescription('Optional league name').setRequired(false)),

    new SlashCommandBuilder()
      .setName('jointournament')
      .setDescription('Join an open tournament')
      .addStringOption(o => o.setName('tournament').setDescription('Tournament name or short ID').setRequired(true))
      .addStringOption(o => o.setName('entry_name').setDescription('Optional team/entry name').setRequired(false)),

    new SlashCommandBuilder()
      .setName('tournaments')
      .setDescription('List active tournaments'),

    new SlashCommandBuilder()
      .setName('tournamentinfo')
      .setDescription('Show tournament info')
      .addStringOption(o => o.setName('tournament').setDescription('Tournament name or short ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('closetournament')
      .setDescription('Admin/staff: close tournament registration')
      .addStringOption(o => o.setName('tournament').setDescription('Tournament name or short ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('starttournament')
      .setDescription('Admin/staff: start a single-elimination tournament bracket')
      .addStringOption(o => o.setName('tournament').setDescription('Tournament name or short ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('tournamentmatches')
      .setDescription('Show tournament matches')
      .addStringOption(o => o.setName('tournament').setDescription('Tournament name or short ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('setuptournamentpanel')
      .setDescription('Create or refresh a permanent tournament bracket panel')
      .addStringOption(o => o.setName('tournament').setDescription('Tournament name or short ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('reportmatch')
      .setDescription('Admin/staff: report a tournament match winner')
      .addStringOption(o => o.setName('match_id').setDescription('Match short ID from /tournamentmatches').setRequired(true))
      .addUserOption(o => o.setName('winner').setDescription('Winning user').setRequired(true)),

    new SlashCommandBuilder()
      .setName('shuffletournament')
      .setDescription('Admin/staff: randomly seed a tournament before it starts')
      .addStringOption(o => o.setName('tournament').setDescription('Tournament name or short ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('settournamentseed')
      .setDescription('Admin/staff: manually set a user seed before tournament starts')
      .addStringOption(o => o.setName('tournament').setDescription('Tournament name or short ID').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('User to seed').setRequired(true))
      .addIntegerOption(o => o.setName('seed').setDescription('Seed number').setRequired(true)),

    new SlashCommandBuilder()
      .setName('tournamentseeds')
      .setDescription('Show tournament seeds')
      .addStringOption(o => o.setName('tournament').setDescription('Tournament name or short ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('announcetournament')
      .setDescription('Post a public tournament registration announcement')
      .addStringOption(o => o.setName('tournament').setDescription('Tournament name or short ID').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Announcement channel').setRequired(false)),

    new SlashCommandBuilder()
      .setName('tournamenthistory')
      .setDescription('Show completed tournament champions')
      .addStringOption(o => o.setName('league').setDescription('Optional league name').setRequired(false)),

    new SlashCommandBuilder()
      .setName('settournamentmvp')
      .setDescription('Admin/staff: set a tournament MVP and optional payout')
      .addStringOption(o => o.setName('tournament').setDescription('Tournament name or short ID').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Tournament MVP').setRequired(true))
      .addIntegerOption(o => o.setName('payout').setDescription('Optional MVP currency payout').setRequired(false)),

    new SlashCommandBuilder()
      .setName('tournamentrewards')
      .setDescription('Show tournament champion/MVP reward records')
      .addStringOption(o => o.setName('league').setDescription('Optional league name').setRequired(false)),

    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Open a support ticket')
      .addStringOption(o => o.setName('subject').setDescription('Short ticket subject').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Explain what you need help with').setRequired(false))
      .addStringOption(o => o.setName('league').setDescription('Optional league name').setRequired(false)),

    new SlashCommandBuilder()
      .setName('dispute')
      .setDescription('Open a league dispute ticket')
      .addStringOption(o => o.setName('subject').setDescription('Short dispute subject').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Explain the dispute').setRequired(false))
      .addStringOption(o => o.setName('league').setDescription('Optional league name').setRequired(false)),

    new SlashCommandBuilder()
      .setName('gamerequest')
      .setDescription('Open a game/reset/lag-out request ticket')
      .addStringOption(o => o.setName('subject').setDescription('Short request subject').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Explain what happened').setRequired(false))
      .addStringOption(o => o.setName('league').setDescription('Optional league name').setRequired(false)),

    new SlashCommandBuilder()
      .setName('closeticket')
      .setDescription('Staff: close the current ticket thread')
      .addStringOption(o => o.setName('reason').setDescription('Optional close reason').setRequired(false)),

    new SlashCommandBuilder()
      .setName('tickets')
      .setDescription('Staff: list tickets by status/priority')
      .addStringOption(o => o.setName('status').setDescription('open, pending, reviewing, resolved, closed').setRequired(false))
      .addStringOption(o => o.setName('priority').setDescription('low, normal, high, urgent').setRequired(false)),

    new SlashCommandBuilder()
      .setName('ticketinfo')
      .setDescription('Staff: view ticket details')
      .addStringOption(o => o.setName('ticket_id').setDescription('Ticket short ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('claimticket')
      .setDescription('Staff: claim the current ticket thread'),

    new SlashCommandBuilder()
      .setName('ticketevidence')
      .setDescription('Show evidence uploaded to a ticket')
      .addStringOption(o => o.setName('ticket_id').setDescription('Optional ticket short ID').setRequired(false)),

    new SlashCommandBuilder()
      .setName('tickettranscript')
      .setDescription('Show saved transcript for a closed ticket')
      .addStringOption(o => o.setName('ticket_id').setDescription('Ticket short ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('setticketstatus')
      .setDescription('Staff: update a ticket status')
      .addStringOption(o => o.setName('status').setDescription('open, pending, reviewing, resolved, closed').setRequired(true))
      .addStringOption(o => o.setName('ticket_id').setDescription('Optional ticket short ID').setRequired(false)),

    new SlashCommandBuilder()
      .setName('setticketpriority')
      .setDescription('Staff: update a ticket priority')
      .addStringOption(o => o.setName('priority').setDescription('low, normal, high, urgent').setRequired(true))
      .addStringOption(o => o.setName('ticket_id').setDescription('Optional ticket short ID').setRequired(false)),

    new SlashCommandBuilder()
      .setName('setupticketpanel')
      .setDescription('Staff: create or refresh the live ticket dashboard panel')
      .addChannelOption(o => o.setName('channel').setDescription('Ticket dashboard channel').setRequired(false)),

    new SlashCommandBuilder()
      .setName('setupsupportpanel')
      .setDescription('Staff: create a user-facing support ticket panel')
      .addChannelOption(o => o.setName('channel').setDescription('Support panel channel').setRequired(false)),

    new SlashCommandBuilder()
      .setName('lagoutrequest')
      .setDescription('Open a lag-out review ticket')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
      .addStringOption(o => o.setName('game_id').setDescription('Game ID, if available').setRequired(false))
      .addUserOption(o => o.setName('opponent').setDescription('Opponent involved').setRequired(false))
      .addRoleOption(o => o.setName('team').setDescription('Your team role').setRequired(false))
      .addStringOption(o => o.setName('details').setDescription('What happened? Include score/time remaining if possible.').setRequired(false)),

    new SlashCommandBuilder()
      .setName('quitrequest')
      .setDescription('Open a quit/forfeit review ticket')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
      .addStringOption(o => o.setName('game_id').setDescription('Game ID, if available').setRequired(false))
      .addUserOption(o => o.setName('opponent').setDescription('Opponent involved').setRequired(false))
      .addRoleOption(o => o.setName('team').setDescription('Your team role').setRequired(false))
      .addStringOption(o => o.setName('details').setDescription('What happened? Include score/time remaining if possible.').setRequired(false)),

    new SlashCommandBuilder()
      .setName('resetrequest')
      .setDescription('Open a game reset review ticket')
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
      .addStringOption(o => o.setName('game_id').setDescription('Game ID, if available').setRequired(false))
      .addUserOption(o => o.setName('opponent').setDescription('Opponent involved').setRequired(false))
      .addRoleOption(o => o.setName('team').setDescription('Your team role').setRequired(false))
      .addStringOption(o => o.setName('details').setDescription('Why should this game be reset?').setRequired(false)),

    new SlashCommandBuilder()
      .setName('gameissuelog')
      .setDescription('Staff: view lagout/quit/reset review decisions')
      .addStringOption(o => o.setName('league').setDescription('Optional league name').setRequired(false))
      .addStringOption(o => o.setName('decision').setDescription('approved or denied').setRequired(false)),

    new SlashCommandBuilder()
      .setName('createsportsbookgame')
      .setDescription('Staff: create a sportsbook moneyline game')
      .addStringOption(o => o.setName('label').setDescription('Game label, ex: Lakers vs Celtics').setRequired(true))
      .addStringOption(o => o.setName('home').setDescription('Home/team A label').setRequired(true))
      .addStringOption(o => o.setName('away').setDescription('Away/team B label').setRequired(true))
      .addIntegerOption(o => o.setName('home_odds').setDescription('American odds, ex: -150 or 120').setRequired(false))
      .addIntegerOption(o => o.setName('away_odds').setDescription('American odds, ex: -150 or 120').setRequired(false))
      .addIntegerOption(o => o.setName('max_bet').setDescription('Optional max bet amount').setRequired(false))
      .addIntegerOption(o => o.setName('max_payout').setDescription('Optional max payout per bet').setRequired(false))
      .addStringOption(o => o.setName('league').setDescription('Optional league name').setRequired(false)),

    new SlashCommandBuilder()
      .setName('sportsbook')
      .setDescription('View open sportsbook games'),

    new SlashCommandBuilder()
      .setName('placebet')
      .setDescription('Place a moneyline bet')
      .addStringOption(o => o.setName('game_id').setDescription('Sportsbook game short ID').setRequired(true))
      .addStringOption(o => o.setName('side').setDescription('home or away').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to bet').setRequired(true)),

    new SlashCommandBuilder()
      .setName('settlebet')
      .setDescription('Staff: settle a sportsbook game')
      .addStringOption(o => o.setName('game_id').setDescription('Sportsbook game short ID').setRequired(true))
      .addStringOption(o => o.setName('winner').setDescription('home or away').setRequired(true)),

    new SlashCommandBuilder()
      .setName('mybets')
      .setDescription('View your recent sportsbook bets'),

    new SlashCommandBuilder()
      .setName('sportsbookline')
      .setDescription('Staff: open, close, or reopen a sportsbook line')
      .addStringOption(o => o.setName('game_id').setDescription('Sportsbook game short ID').setRequired(true))
      .addStringOption(o => o.setName('action').setDescription('open or closed').setRequired(true)),

    new SlashCommandBuilder()
      .setName('cancelsportsbookgame')
      .setDescription('Staff: cancel a sportsbook game and refund open bets')
      .addStringOption(o => o.setName('game_id').setDescription('Sportsbook game short ID').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Optional cancellation reason').setRequired(false)),

    new SlashCommandBuilder()
      .setName('setupsportsbookpanel')
      .setDescription('Staff: create or refresh the live sportsbook board')
      .addChannelOption(o => o.setName('channel').setDescription('Sportsbook board channel').setRequired(false)),

    new SlashCommandBuilder()
      .setName('setsportsbookfeed')
      .setDescription('Staff: set sportsbook feed channel and big bet threshold')
      .addChannelOption(o => o.setName('channel').setDescription('Sportsbook feed channel').setRequired(true))
      .addIntegerOption(o => o.setName('big_bet_threshold').setDescription('Amount that triggers big bet alerts').setRequired(false)),

    new SlashCommandBuilder()
      .setName('bettinghistory')
      .setDescription('View your sportsbook betting history or another user’s')
      .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false)),

    new SlashCommandBuilder()
      .setName('bettingleaderboard')
      .setDescription('View sportsbook leaderboard and profit leaders'),

    new SlashCommandBuilder()
      .setName('activity')
      .setDescription('View activity and legacy profile')
      .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false)),

    new SlashCommandBuilder()
      .setName('activityleaderboard')
      .setDescription('View the activity leaderboard'),

    new SlashCommandBuilder()
      .setName('milestones')
      .setDescription('View your activity milestones or another user’s')
      .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false)),

    new SlashCommandBuilder()
      .setName('setactivitychannel')
      .setDescription('Staff: set the activity milestone announcement channel')
      .addChannelOption(o => o.setName('channel').setDescription('Activity milestone channel').setRequired(true)),

    new SlashCommandBuilder()
      .setName('legacy')
      .setDescription('View legacy rankings'),

    new SlashCommandBuilder()
      .setName('halloffame')
      .setDescription('View the GG Sports Hall of Fame'),

    new SlashCommandBuilder()
      .setName('awards')
      .setDescription('View league awards or add one')
      .addStringOption(o => o.setName('action').setDescription('view or add').setRequired(true))
      .addStringOption(o => o.setName('league').setDescription('League name').setRequired(false))
      .addStringOption(o => o.setName('season').setDescription('Season label').setRequired(false))
      .addStringOption(o => o.setName('award').setDescription('Award name').setRequired(false))
      .addUserOption(o => o.setName('user').setDescription('Award recipient').setRequired(false)),

    new SlashCommandBuilder()
      .setName('seasonhistory')
      .setDescription('View championship history')
      .addStringOption(o => o.setName('league').setDescription('Optional league name').setRequired(false)),

    new SlashCommandBuilder()
      .setName('createparlay')
      .setDescription('Create a 2-4 leg sportsbook parlay')
      .addIntegerOption(o => o.setName('amount').setDescription('Stake amount').setRequired(true))
      .addStringOption(o => o.setName('leg1_game').setDescription('Leg 1 sportsbook game ID').setRequired(true))
      .addStringOption(o => o.setName('leg1_side').setDescription('home or away').setRequired(true))
      .addStringOption(o => o.setName('leg2_game').setDescription('Leg 2 sportsbook game ID').setRequired(true))
      .addStringOption(o => o.setName('leg2_side').setDescription('home or away').setRequired(true))
      .addStringOption(o => o.setName('leg3_game').setDescription('Optional leg 3 sportsbook game ID').setRequired(false))
      .addStringOption(o => o.setName('leg3_side').setDescription('home or away').setRequired(false))
      .addStringOption(o => o.setName('leg4_game').setDescription('Optional leg 4 sportsbook game ID').setRequired(false))
      .addStringOption(o => o.setName('leg4_side').setDescription('home or away').setRequired(false)),

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

function getRegisteredCommands() {
  const commands = buildCommands();
  const MAX_COMMANDS = 100;

  if (commands.length <= MAX_COMMANDS) return commands;

  const dropIfNeeded = new Set([
    'ping',
    'help',
    'commands',
    'setupteamowners',
    'setuptradecount',
    'setupoffertrade',
    'franchiselegacy',
    'awardhistory',
    'halloffame',
    'teamtrades',
    'teamprofile',
    'transactions',
    'banklog',
    'mybets',
    'bettinghistory',
    'bettingleaderboard',
  ]);

  const trimmed = commands.filter(command => !dropIfNeeded.has(command.name));

  if (trimmed.length > MAX_COMMANDS) {
    console.warn('Command list still over Discord limit after trimming:', trimmed.length);
    return trimmed.slice(0, MAX_COMMANDS);
  }

  console.warn('Discord command limit reached. Registered', trimmed.length, 'of', commands.length, 'commands. Some non-critical commands were skipped.');
  return trimmed;
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const commands = getRegisteredCommands();

  console.log('Registering global commands...');
  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );
  console.log('Global commands synced:', commands.length);

  for (const guildId of COMMAND_GUILD_IDS) {
    console.log('Registering guild commands for:', guildId);
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, guildId),
      { body: commands }
    );
    console.log('Guild commands synced for', guildId + ':', commands.length);
  }
}

async function getLeagueByName(guildId, leagueName) {
  const result = await pool.query(
    `SELECT l.*, s.league_role_id, s.staff_role_id, s.committee_role_id, s.live_channel_id,
            s.team_owners_channel_id, s.trade_count_channel_id, s.trade_block_channel_id,
            s.offer_a_trade_channel_id, s.committee_channel_id, s.approved_channel_id, s.denied_channel_id,
            s.history_channel_id, s.standings_channel_id, s.tournament_channel_id
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
            s.history_channel_id, s.standings_channel_id, s.tournament_channel_id
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
            s.history_channel_id, s.standings_channel_id, s.tournament_channel_id
     FROM leagues l
     JOIN league_settings s ON s.league_id = l.league_id
     WHERE l.guild_id = $1 AND l.is_active = TRUE AND $2 IN (
       s.live_channel_id, s.team_owners_channel_id, s.trade_count_channel_id, s.trade_block_channel_id,
       s.offer_a_trade_channel_id, s.committee_channel_id, s.approved_channel_id, s.denied_channel_id, s.history_channel_id, s.standings_channel_id, s.tournament_channel_id
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
            s.history_channel_id, s.standings_channel_id, s.tournament_channel_id
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
      { name: 'Approved Trades Involving Team', value: String(data.trades), inline: true },
      { name: 'Tournament Wins', value: String(data.tournamentWins || 0), inline: true },
      { name: 'Tournament MVPs', value: String(data.tournamentMvps || 0), inline: true }
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

async function getCurrencySettings(guildId) {
  await pool.query(
    `INSERT INTO guild_currency_settings (guild_id)
     VALUES ($1)
     ON CONFLICT (guild_id) DO NOTHING`,
    [guildId]
  );

  const result = await pool.query(
    `SELECT currency_name, currency_icon, win_payout, game_played_payout FROM guild_currency_settings WHERE guild_id = $1`,
    [guildId]
  );

  return result.rows[0] || { currency_name: 'GG Coins', currency_icon: '🪙', win_payout: 100, game_played_payout: 25 };
}

async function getBalance(guildId, userId) {
  await pool.query(
    `INSERT INTO guild_currency_balances (guild_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );

  const result = await pool.query(
    `SELECT balance, lifetime_earned, lifetime_spent FROM guild_currency_balances WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId]
  );

  return result.rows[0] || { balance: 0, lifetime_earned: 0, lifetime_spent: 0 };
}

async function addCurrency(guildId, userId, amount, transactionType, reason, issuedByUserId = null) {
  if (!Number.isInteger(amount) || amount <= 0) return;

  await pool.query(
    `INSERT INTO guild_currency_balances (guild_id, user_id, balance, lifetime_earned)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET
       balance = guild_currency_balances.balance + $3,
       lifetime_earned = guild_currency_balances.lifetime_earned + $3,
       updated_at = NOW()`,
    [guildId, userId, amount]
  );

  await pool.query(
    `INSERT INTO currency_transactions (id, guild_id, user_id, amount, transaction_type, reason, issued_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), guildId, userId, amount, transactionType, reason || null, issuedByUserId]
  );
}

async function removeCurrency(guildId, userId, amount, transactionType, reason, issuedByUserId = null) {
  if (!Number.isInteger(amount) || amount <= 0) return false;

  const balance = await getBalance(guildId, userId);
  if (Number(balance.balance) < amount) return false;

  await pool.query(
    `UPDATE guild_currency_balances
     SET balance = balance - $3,
         lifetime_spent = lifetime_spent + $3,
         updated_at = NOW()
     WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId, amount]
  );

  await pool.query(
    `INSERT INTO currency_transactions (id, guild_id, user_id, amount, transaction_type, reason, issued_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), guildId, userId, -amount, transactionType, reason || null, issuedByUserId]
  );

  return true;
}

function buildBalanceEmbed(settings, user, balanceRow) {
  return new EmbedBuilder()
    .setTitle(`${settings.currency_icon} ${user.username}'s Balance`)
    .setColor(0xFEE75C)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'Balance', value: `${settings.currency_icon} ${balanceRow.balance} ${settings.currency_name}`, inline: false },
      { name: 'Lifetime Earned', value: `${settings.currency_icon} ${balanceRow.lifetime_earned}`, inline: true },
      { name: 'Lifetime Spent', value: `${settings.currency_icon} ${balanceRow.lifetime_spent}`, inline: true }
    )
    .setFooter({ text: 'GG Sports • Server Economy' })
    .setTimestamp();
}

function shortItemId(itemId) {
  return String(itemId || '').split('-')[0];
}

async function findShopItem(guildId, itemInput) {
  const result = await pool.query(
    `SELECT * FROM shop_items
     WHERE guild_id = $1 AND is_active = TRUE
       AND (LOWER(item_name) = LOWER($2) OR id::text LIKE $3)
     ORDER BY created_at DESC
     LIMIT 1`,
    [guildId, itemInput, `${itemInput}%`]
  );
  return result.rows[0] || null;
}

function buildShopEmbed(settings, rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle(`${settings.currency_icon} Server Shop`)
    .setColor(0xFEE75C)
    .setFooter({ text: 'GG Sports • Server Shop' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No active shop items yet. Staff can create one with /createshopitem.');
    return embed;
  }

  const lines = rows.map(row => {
    const stock = row.stock === null || row.stock === undefined ? 'Unlimited' : `${row.stock} left`;
    const description = row.description ? ` — ${row.description}` : '';
    return `**${shortItemId(row.id)} • ${row.item_name}**${description}${NL}${settings.currency_icon} ${row.price} ${settings.currency_name} • Stock: ${stock}`;
  });

  embed.setDescription(lines.join(`${NL}${NL}`));
  return embed;
}

function buildInventoryEmbed(settings, user, rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle(`${user.username}'s Inventory`)
    .setColor(0x5865F2)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: 'GG Sports • Inventory' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No inventory items yet.');
    return embed;
  }

  const lines = rows.map(row => {
    const date = row.purchased_at ? new Date(row.purchased_at).toLocaleDateString('en-US') : 'Unknown date';
    const note = row.request_note ? `${NL}Note: ${row.request_note}` : '';
    return `**${shortItemId(row.id)} • ${row.item_name}** — ${settings.currency_icon} ${row.price_paid} • ${date}${NL}Status: **${row.status}**${note}`;
  });

  embed.setDescription(lines.join(`${NL}${NL}`));
  return embed;
}

function buildEconomyEmbed(settings, stats) {
  return new EmbedBuilder()
    .setTitle(`${settings.currency_icon} Server Economy`)
    .setColor(0xFEE75C)
    .addFields(
      { name: 'Currency', value: `${settings.currency_icon} ${settings.currency_name}`, inline: true },
      { name: 'Win Bonus', value: `${settings.win_payout}`, inline: true },
      { name: 'Game Played Payout', value: `${settings.game_played_payout}`, inline: true },
      { name: 'Total Circulating', value: `${settings.currency_icon} ${stats.totalBalance}`, inline: true },
      { name: 'Users With Balance', value: `${stats.usersWithBalance}`, inline: true },
      { name: 'Transactions', value: `${stats.transactionCount}`, inline: true },
      { name: 'Shop Items Active', value: `${stats.activeShopItems}`, inline: true }
    )
    .setFooter({ text: 'GG Sports • Economy' })
    .setTimestamp();
}

function buildRichestEmbed(settings, rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle(`${settings.currency_icon} Richest Users`)
    .setColor(0xFEE75C)
    .setFooter({ text: 'GG Sports • Economy Leaderboard' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No balances found yet.');
    return embed;
  }

  const lines = rows.map((row, index) => `**${index + 1}.** <@${row.user_id}> — ${settings.currency_icon} ${row.balance} ${settings.currency_name}`);
  embed.setDescription(lines.join(NL));
  return embed;
}

function buildTransactionsEmbed(settings, title, rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x5865F2)
    .setFooter({ text: 'GG Sports • Transactions' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No transactions found.');
    return embed;
  }

  const lines = rows.map(row => {
    const sign = Number(row.amount) >= 0 ? '+' : '';
    const date = row.created_at ? new Date(row.created_at).toLocaleDateString('en-US') : 'Unknown date';
    const issuer = row.issued_by_user_id ? ` • By <@${row.issued_by_user_id}>` : '';
    const reason = row.reason ? ` • ${row.reason}` : '';
    return `**${sign}${row.amount} ${settings.currency_name}** — ${row.transaction_type}${reason}${issuer} • ${date}`;
  });

  embed.setDescription(lines.join(NL));
  return embed;
}

async function findInventoryItem(guildId, userId, itemInput) {
  const result = await pool.query(
    `SELECT * FROM user_inventory
     WHERE guild_id = $1 AND user_id = $2
       AND (LOWER(item_name) = LOWER($3) OR id::text LIKE $4)
     ORDER BY purchased_at DESC
     LIMIT 1`,
    [guildId, userId, itemInput, `${itemInput}%`]
  );
  return result.rows[0] || null;
}

function shortTournamentId(tournamentId) {
  return String(tournamentId || '').split('-')[0];
}

async function findTournament(guildId, input) {
  const result = await pool.query(
    `SELECT t.*, l.league_name
     FROM tournaments t
     LEFT JOIN leagues l ON l.league_id = t.league_id
     WHERE t.guild_id = $1
       AND (LOWER(t.tournament_name) = LOWER($2) OR t.id::text LIKE $3)
     ORDER BY t.created_at DESC
     LIMIT 1`,
    [guildId, input, `${input}%`]
  );
  return result.rows[0] || null;
}

async function getTournamentEntries(tournamentId) {
  const result = await pool.query(
    `SELECT * FROM tournament_entries WHERE tournament_id = $1 ORDER BY seed ASC NULLS LAST, joined_at ASC`,
    [tournamentId]
  );
  return result.rows;
}

function buildTournamentsEmbed(settings, rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle('Active Tournaments')
    .setColor(0xED4245)
    .setFooter({ text: 'GG Sports • Tournaments' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No open or active tournaments found.');
    return embed;
  }

  const lines = rows.map(row => {
    const buyIn = Number(row.buy_in) > 0 ? `${settings.currency_icon} ${row.buy_in} ${settings.currency_name}` : 'Free Entry';
    const maxEntries = row.max_entries ? `${row.entry_count}/${row.max_entries}` : `${row.entry_count}`;
    const leagueText = row.league_name ? ` • ${row.league_name}` : '';
    return `**${shortTournamentId(row.id)} • ${row.tournament_name}**${leagueText}${NL}${row.game || 'Game TBD'} • ${row.format} • ${row.status} • Entries: ${maxEntries} • Buy-in: ${buyIn}`;
  });

  embed.setDescription(lines.join(`${NL}${NL}`));
  return embed;
}

function buildTournamentInfoEmbed(settings, tournament, entries) {
  const NL = String.fromCharCode(10);
  const buyIn = Number(tournament.buy_in) > 0 ? `${settings.currency_icon} ${tournament.buy_in} ${settings.currency_name}` : 'Free Entry';
  const prizePool = `${settings.currency_icon} ${tournament.prize_pool || 0} ${settings.currency_name}`;
  const maxEntries = tournament.max_entries ? `${entries.length}/${tournament.max_entries}` : `${entries.length}`;
  const entryLines = entries.length
    ? entries.map((entry, index) => {
        const seedLabel = entry.seed ? `Seed ${entry.seed}` : `Entry ${index + 1}`;
        return `**${seedLabel}.** <@${entry.user_id}>${entry.entry_name ? ` — ${entry.entry_name}` : ''}`;
      }).join(NL)
    : 'No entries yet.';

  return new EmbedBuilder()
    .setTitle(`${tournament.tournament_name}`)
    .setColor(0xED4245)
    .addFields(
      { name: 'Tournament ID', value: shortTournamentId(tournament.id), inline: true },
      { name: 'Game', value: tournament.game || 'TBD', inline: true },
      { name: 'Format', value: tournament.format, inline: true },
      { name: 'Status', value: tournament.status, inline: true },
      { name: 'Entries', value: maxEntries, inline: true },
      { name: 'Buy-in', value: buyIn, inline: true },
      { name: 'Prize Pool', value: prizePool, inline: true },
      { name: 'Prize', value: tournament.prize || 'Not listed', inline: true },
      { name: 'Start Date', value: tournament.starts_at || 'TBD', inline: true },
      { name: 'Entries', value: entryLines, inline: false }
    )
    .setFooter({ text: 'GG Sports • Tournament Info' })
    .setTimestamp();
}

function buildTournamentJoinButton(tournamentId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournament_join:${tournamentId}`)
      .setLabel('Join Tournament')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

function buildTournamentAnnouncementEmbed(settings, tournament, entries) {
  const buyIn = Number(tournament.buy_in) > 0 ? `${settings.currency_icon} ${tournament.buy_in} ${settings.currency_name}` : 'Free Entry';
  const maxEntries = tournament.max_entries ? `${entries.length}/${tournament.max_entries}` : `${entries.length}`;

  return new EmbedBuilder()
    .setTitle(`🏆 ${tournament.tournament_name}`)
    .setDescription('Registration is now open. Press the button below to join.')
    .setColor(0xED4245)
    .addFields(
      { name: 'Game', value: tournament.game || 'TBD', inline: true },
      { name: 'Format', value: tournament.format || 'single_elim', inline: true },
      { name: 'Entries', value: maxEntries, inline: true },
      { name: 'Buy-in', value: buyIn, inline: true },
      { name: 'Prize', value: tournament.prize || 'Not listed', inline: true },
      { name: 'Start Date', value: tournament.starts_at || 'TBD', inline: true },
      { name: 'Tournament ID', value: shortTournamentId(tournament.id), inline: true }
    )
    .setFooter({ text: 'GG Sports • Tournament Registration' })
    .setTimestamp();
}

function buildTournamentChampionEmbed(settings, tournament, championUserId, prizePaid = 0) {
  const prizeText = Number(prizePaid) > 0
    ? `${settings.currency_icon} ${prizePaid} ${settings.currency_name}`
    : tournament.prize || 'No prize listed';

  return new EmbedBuilder()
    .setTitle(`🏆 ${tournament.tournament_name} Champion`)
    .setColor(0xFEE75C)
    .addFields(
      { name: 'Champion', value: `<@${championUserId}>`, inline: false },
      { name: 'Game', value: tournament.game || 'TBD', inline: true },
      { name: 'Format', value: tournament.format || 'single_elim', inline: true },
      { name: 'Prize', value: prizeText, inline: true }
    )
    .setFooter({ text: 'GG Sports • Tournament Champion' })
    .setTimestamp();
}

function buildTournamentHistoryEmbed(rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle('Tournament History')
    .setColor(0xFEE75C)
    .setFooter({ text: 'GG Sports • Tournament History' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No completed tournaments have been recorded yet.');
    return embed;
  }

  const lines = rows.map(row => {
    const date = row.completed_at ? new Date(row.completed_at).toLocaleDateString('en-US') : 'Unknown date';
    const mvp = row.mvp_user_id ? ` • MVP: <@${row.mvp_user_id}>` : '';
    return `**${row.tournament_name}** — Champion: <@${row.champion_user_id}>${mvp} • ${row.game || 'Game TBD'} • ${date}`;
  });

  embed.setDescription(lines.join(NL));
  return embed;
}

function buildTournamentRewardsEmbed(settings, rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle('Tournament Rewards')
    .setColor(0xFEE75C)
    .setFooter({ text: 'GG Sports • Tournament Rewards' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No tournament reward records found.');
    return embed;
  }

  const lines = rows.map(row => {
    const championPrize = Number(row.prize_paid || 0) > 0 ? ` • Champion Prize: ${settings.currency_icon} ${row.prize_paid}` : '';
    const mvp = row.mvp_user_id ? ` • MVP: <@${row.mvp_user_id}>` : '';
    const mvpPrize = Number(row.mvp_payout || 0) > 0 ? ` (${settings.currency_icon} ${row.mvp_payout})` : '';
    return `**${row.tournament_name}** — Champion: <@${row.champion_user_id}>${championPrize}${mvp}${mvpPrize}`;
  });

  embed.setDescription(lines.join(NL));
  return embed;
}

function shortMatchId(matchId) {
  return String(matchId || '').split('-')[0];
}

function buildTournamentMatchesEmbed(tournament, matches) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle(`${tournament.tournament_name} • Matches`)
    .setColor(0xED4245)
    .setFooter({ text: 'GG Sports • Tournament Matches' })
    .setTimestamp();

  if (!matches.length) {
    embed.setDescription('No matches have been generated yet.');
    return embed;
  }

  const lines = matches.map(match => {
    const p1 = match.player1_user_id ? `<@${match.player1_user_id}>${match.player1_entry_name ? ` (${match.player1_entry_name})` : ''}` : 'BYE';
    const p2 = match.player2_user_id ? `<@${match.player2_user_id}>${match.player2_entry_name ? ` (${match.player2_entry_name})` : ''}` : 'BYE';
    const winner = match.winner_user_id ? ` • Winner: <@${match.winner_user_id}>` : '';
    return `**${shortMatchId(match.id)}** • Round ${match.round_number}, Match ${match.match_number}${NL}${p1} vs ${p2} • ${match.status}${winner}`;
  });

  embed.setDescription(lines.join(`${NL}${NL}`));
  return embed;
}

function buildTournamentMatchThreadEmbed(tournament, match) {
  const p1 = match.player1_user_id ? `<@${match.player1_user_id}>${match.player1_entry_name ? ` (${match.player1_entry_name})` : ''}` : 'BYE';
  const p2 = match.player2_user_id ? `<@${match.player2_user_id}>${match.player2_entry_name ? ` (${match.player2_entry_name})` : ''}` : 'BYE';

  return new EmbedBuilder()
    .setTitle(`${tournament.tournament_name} • Match ${shortMatchId(match.id)}`)
    .setColor(0xED4245)
    .addFields(
      { name: 'Round', value: String(match.round_number), inline: true },
      { name: 'Match', value: String(match.match_number), inline: true },
      { name: 'Match ID', value: shortMatchId(match.id), inline: true },
      { name: 'Player 1', value: p1, inline: false },
      { name: 'Player 2', value: p2, inline: false },
      { name: 'How to Report', value: 'Staff can click the winner button below, or use `/reportmatch` with this Match ID.', inline: false }
    )
    .setFooter({ text: 'GG Sports • Tournament Match Thread' })
    .setTimestamp();
}

function buildMatchWinnerButtons(match, disabled = false) {
  const row = new ActionRowBuilder();

  if (match.player1_user_id) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`tourney_match_winner:${match.id}:${match.player1_user_id}`)
        .setLabel('Player 1 Won')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled)
    );
  }

  if (match.player2_user_id) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`tourney_match_winner:${match.id}:${match.player2_user_id}`)
        .setLabel('Player 2 Won')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }

  return row;
}

async function finalizeTournamentMatch(guild, match, winnerUserId, reportedByUserId) {
  await pool.query(
    `UPDATE tournament_matches SET winner_user_id = $1, status = 'final', reported_by_user_id = $2, updated_at = NOW() WHERE id = $3`,
    [winnerUserId, reportedByUserId, match.id]
  );

  const allMatches = await getTournamentMatches(match.tournament_id);
  const currentRoundMatches = allMatches.filter(m => Number(m.round_number) === Number(match.round_number));
  const currentRoundComplete = currentRoundMatches.every(m => m.status === 'final' || m.status === 'bye' || m.winner_user_id);

  if (!currentRoundComplete) {
    const refreshedTournament = await findTournament(guild.id, match.tournament_name);
    if (refreshedTournament) await updateTournamentPanel(guild, refreshedTournament);
    return { complete: false, message: `Match reported. Winner: <@${winnerUserId}>.` };
  }

  const winners = currentRoundMatches
    .map(m => ({
      user_id: m.winner_user_id,
      entry_name: m.winner_user_id === m.player1_user_id ? m.player1_entry_name : m.player2_entry_name,
    }))
    .filter(w => w.user_id);

  if (winners.length === 1) {
    await pool.query(`UPDATE tournaments SET status = 'completed', updated_at = NOW() WHERE id = $1`, [match.tournament_id]);
    const settings = await getCurrencySettings(guild.id);
    let payoutText = '';

    if (Number(match.prize_pool) > 0) {
      await addCurrency(guild.id, winners[0].user_id, Number(match.prize_pool), 'tournament_prize', `Won ${match.tournament_name}`, reportedByUserId);
      payoutText = ` ${settings.currency_icon} <@${winners[0].user_id}> earned the prize pool of **${match.prize_pool} ${settings.currency_name}**.`;
    }

    const completedTournament = await findTournament(guild.id, match.tournament_name);
    if (completedTournament) {
      await pool.query(
        `INSERT INTO tournament_history (id, guild_id, league_id, tournament_id, tournament_name, game, format, champion_user_id, prize_paid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [randomUUID(), guild.id, completedTournament.league_id || null, match.tournament_id, match.tournament_name, completedTournament.game, completedTournament.format, winners[0].user_id, Number(match.prize_pool || 0)]
      );
      await updateTournamentPanel(guild, { ...completedTournament, status: 'completed' });

      let announceChannel = null;
      if (completedTournament.league_id) {
        const activeLeague = await getLeagueById(completedTournament.league_id);
        if (activeLeague?.tournament_channel_id) {
          announceChannel = await guild.channels.fetch(activeLeague.tournament_channel_id).catch(() => null);
        }
      }
      if (!announceChannel) {
        const guildTournamentChannelId = await getGuildTournamentChannelId(guild.id);
        if (guildTournamentChannelId) {
          announceChannel = await guild.channels.fetch(guildTournamentChannelId).catch(() => null);
        }
      }
      if (announceChannel && announceChannel.isTextBased()) {
        const championSettings = await getCurrencySettings(guild.id);
        await announceChannel.send({
          embeds: [buildTournamentChampionEmbed(championSettings, completedTournament, winners[0].user_id, Number(match.prize_pool || 0))],
        }).catch(() => null);
      }
    }

    return { complete: true, message: `Tournament complete. Champion: <@${winners[0].user_id}>.${payoutText}` };
  }

  await createTournamentRound({ id: match.tournament_id, guild_id: guild.id }, winners, Number(match.round_number) + 1);
  const refreshedTournament = await findTournament(guild.id, match.tournament_name);
  if (refreshedTournament) {
    const refreshedMatches = await getTournamentMatches(match.tournament_id);
    await createMatchThreads(guild, refreshedTournament, refreshedMatches);
    await updateTournamentPanel(guild, refreshedTournament);
  }

  return {
    complete: true,
    message: `Round ${match.round_number} complete. Round ${Number(match.round_number) + 1} has been generated.`,
  };
}

async function createMatchThreads(guild, tournament, matches) {
  let channel = null;

  if (tournament.league_id) {
    const activeLeague = await getLeagueById(tournament.league_id);
    if (activeLeague?.tournament_channel_id) {
      channel = await guild.channels.fetch(activeLeague.tournament_channel_id).catch(() => null);
    }
  }

  if (!channel) {
    const guildTournamentChannelId = await getGuildTournamentChannelId(guild.id);
    if (guildTournamentChannelId) {
      channel = await guild.channels.fetch(guildTournamentChannelId).catch(() => null);
    }
  }

  if (!channel || !channel.isTextBased()) return;

  for (const match of matches) {
    if (!match.player1_user_id || !match.player2_user_id || match.status === 'final' || match.status === 'bye') continue;
    if (match.thread_id) continue;

    const starter = await channel.send({
      content: `<@${match.player1_user_id}> vs <@${match.player2_user_id}> — Tournament match created.`,
      embeds: [buildTournamentMatchThreadEmbed(tournament, match)],
      components: [buildMatchWinnerButtons(match)],
      allowedMentions: { users: [match.player1_user_id, match.player2_user_id], roles: [] },
    });

    const threadName = `${tournament.tournament_name} R${match.round_number} M${match.match_number}`.slice(0, 90);
    const thread = await starter.startThread({
      name: threadName,
      autoArchiveDuration: 1440,
      reason: 'Tournament match thread',
    }).catch(() => null);

    if (thread) {
      await thread.send({
        content: `<@${match.player1_user_id}> <@${match.player2_user_id}> schedule/play your match here. Staff can click the winner button on the match post, or use Match ID: **${shortMatchId(match.id)}**`,
        allowedMentions: { users: [match.player1_user_id, match.player2_user_id], roles: [] },
      }).catch(() => null);

      await pool.query(`UPDATE tournament_matches SET thread_id = $1, updated_at = NOW() WHERE id = $2`, [thread.id, match.id]);
    }
  }
}

function buildTournamentPanelEmbed(tournament, matches) {
  const NL = String.fromCharCode(10);
  const rounds = new Map();

  for (const match of matches) {
    const round = Number(match.round_number);
    if (!rounds.has(round)) rounds.set(round, []);
    rounds.get(round).push(match);
  }

  const embed = new EmbedBuilder()
    .setTitle(`${tournament.tournament_name} • Bracket Panel`)
    .setColor(0xED4245)
    .addFields(
      { name: 'Status', value: tournament.status || 'unknown', inline: true },
      { name: 'Format', value: tournament.format || 'single_elim', inline: true },
      { name: 'Game', value: tournament.game || 'TBD', inline: true }
    )
    .setFooter({ text: 'GG Sports • Live Tournament Bracket' })
    .setTimestamp();

  if (!matches.length) {
    embed.setDescription('Bracket has not been generated yet. Use /starttournament when registration is ready.');
    return embed;
  }

  for (const [round, roundMatches] of [...rounds.entries()].sort((a, b) => a[0] - b[0])) {
    const value = roundMatches.map(match => {
      const p1 = match.player1_user_id ? `<@${match.player1_user_id}>` : 'BYE';
      const p2 = match.player2_user_id ? `<@${match.player2_user_id}>` : 'BYE';
      const winner = match.winner_user_id ? ` → <@${match.winner_user_id}>` : '';
      return `**${shortMatchId(match.id)}** ${p1} vs ${p2} • ${match.status}${winner}`;
    }).join(NL);

    embed.addFields({ name: `Round ${round}`, value: value || 'No matches', inline: false });
  }

  return embed;
}

async function saveTournamentPanel(tournamentId, guildId, channelId, messageId) {
  await pool.query(
    `INSERT INTO tournament_panels (tournament_id, guild_id, channel_id, message_id, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (tournament_id)
     DO UPDATE SET channel_id = $3, message_id = $4, updated_at = NOW()`,
    [tournamentId, guildId, channelId, messageId]
  );
}

async function updateTournamentPanel(guild, tournament) {
  const panelResult = await pool.query(
    `SELECT channel_id, message_id FROM tournament_panels WHERE tournament_id = $1`,
    [tournament.id]
  );

  if (!panelResult.rows.length) return;

  const channel = await guild.channels.fetch(panelResult.rows[0].channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const message = await channel.messages.fetch(panelResult.rows[0].message_id).catch(() => null);
  if (!message) return;

  const matches = await getTournamentMatches(tournament.id);
  await message.edit({ embeds: [buildTournamentPanelEmbed(tournament, matches)] });
}

async function getTournamentMatches(tournamentId) {
  const result = await pool.query(
    `SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY round_number ASC, match_number ASC`,
    [tournamentId]
  );
  return result.rows;
}

async function findTournamentMatch(guildId, matchInput) {
  const result = await pool.query(
    `SELECT m.*, t.tournament_name, t.prize_pool
     FROM tournament_matches m
     JOIN tournaments t ON t.id = m.tournament_id
     WHERE m.guild_id = $1 AND m.id::text LIKE $2
     ORDER BY m.created_at DESC
     LIMIT 1`,
    [guildId, `${matchInput}%`]
  );
  return result.rows[0] || null;
}

async function createTournamentRound(tournament, entries, roundNumber) {
  const matches = [];
  let matchNumber = 1;

  for (let i = 0; i < entries.length; i += 2) {
    const p1 = entries[i] || null;
    const p2 = entries[i + 1] || null;
    const matchId = randomUUID();

    await pool.query(
      `INSERT INTO tournament_matches (id, tournament_id, guild_id, round_number, match_number, player1_user_id, player1_entry_name, player2_user_id, player2_entry_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        matchId,
        tournament.id,
        tournament.guild_id,
        roundNumber,
        matchNumber,
        p1?.user_id || null,
        p1?.entry_name || null,
        p2?.user_id || null,
        p2?.entry_name || null,
        p1 && p2 ? 'scheduled' : 'bye',
      ]
    );

    if (p1 && !p2) {
      await pool.query(
        `UPDATE tournament_matches SET winner_user_id = $1, status = 'final', updated_at = NOW() WHERE id = $2`,
        [p1.user_id, matchId]
      );
    }

    matches.push(matchId);
    matchNumber += 1;
  }

  return matches;
}

async function getGuildTournamentChannelId(guildId) {
  const result = await pool.query(
    `SELECT tournament_channel_id FROM guild_tournament_settings WHERE guild_id = $1`,
    [guildId]
  );
  return result.rows[0]?.tournament_channel_id || null;
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

    if (message.channel?.isThread() && message.attachments.size > 0) {
      const ticket = await getOpenTicketByThread(message.guild.id, message.channel.id);
      if (ticket) {
        for (const attachment of message.attachments.values()) {
          await saveTicketEvidence({
            ticketId: ticket.id,
            guildId: message.guild.id,
            userId: message.author.id,
            attachmentUrl: attachment.url,
            fileName: attachment.name,
            contentType: attachment.contentType,
            messageId: message.id,
          });
        }
        await message.react('📎').catch(() => null);
      }
    }

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
      if (interaction.customId.startsWith('sportsbook_bet_modal:')) {
        if (!interaction.guild) return;
        const [, gameId, side] = interaction.customId.split(':');
        const amountText = interaction.fields.getTextInputValue('sportsbook_bet_amount');
        const amount = Number.parseInt(amountText, 10);
        const settings = await getCurrencySettings(interaction.guild.id);
        const sportsbookGame = await findSportsbookGame(interaction.guild.id, gameId);

        if (!sportsbookGame || sportsbookGame.status !== 'open') {
          await interaction.reply({ content: 'That sportsbook game is no longer open.', ephemeral: true });
          return;
        }

        if (!Number.isInteger(amount) || amount <= 0) {
          await interaction.reply({ content: 'Bet amount must be a whole number greater than 0.', ephemeral: true });
          return;
        }

        const odds = side === 'home' ? Number(sportsbookGame.home_odds) : Number(sportsbookGame.away_odds);
        const payout = calculateAmericanOddsPayout(amount, odds);
        if (sportsbookGame.max_bet && amount > Number(sportsbookGame.max_bet)) {
          await interaction.reply({ content: 'Max bet for this line is **' + sportsbookGame.max_bet + '**.', ephemeral: true });
          return;
        }
        if (sportsbookGame.max_payout && payout > Number(sportsbookGame.max_payout)) {
          await interaction.reply({ content: 'That bet would exceed the max payout of **' + sportsbookGame.max_payout + '** for this line.', ephemeral: true });
          return;
        }
        const removed = await removeCurrency(interaction.guild.id, interaction.user.id, amount, 'sportsbook_bet', 'Bet on ' + sportsbookGame.game_label, interaction.user.id);

        if (!removed) {
          await interaction.reply({ content: 'You do not have enough ' + settings.currency_name + ' to place that bet.', ephemeral: true });
          return;
        }

        await pool.query(
          `INSERT INTO sportsbook_bets (id, guild_id, sportsbook_game_id, user_id, side, amount, odds, potential_payout)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), interaction.guild.id, sportsbookGame.id, interaction.user.id, side, amount, odds, payout]
        );

        await updateSportsbookPanel(interaction.guild);
        const feedSettings = await getSportsbookSettings(interaction.guild.id);
        await postSportsbookFeed(
          interaction.guild,
          buildSportsbookBetAlertEmbed(settings, interaction.user, sportsbookGame, side, amount, odds, payout, amount >= Number(feedSettings.big_bet_threshold || 500))
        );
        const sideLabel = side === 'home' ? sportsbookGame.home_label : sportsbookGame.away_label;
        await interaction.reply({ content: 'Bet placed: **' + settings.currency_icon + ' ' + amount + '** on **' + sideLabel + ' ML ' + odds + '**. Potential payout: **' + settings.currency_icon + ' ' + payout + '**.', ephemeral: true });
        return;
      }
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
      if (interaction.customId.startsWith('tournament_join:')) {
        if (!interaction.guild) return;
        const tournamentId = interaction.customId.split(':')[1];
        const tournament = await findTournament(interaction.guild.id, tournamentId);
        const settings = await getCurrencySettings(interaction.guild.id);

        if (!tournament) {
          await interaction.reply({ content: 'Could not find that tournament.', ephemeral: true });
          return;
        }

        if (tournament.status !== 'open') {
          await interaction.reply({ content: 'That tournament is not open for registration.', ephemeral: true });
          return;
        }

        const entries = await getTournamentEntries(tournament.id);
        if (tournament.max_entries && entries.length >= Number(tournament.max_entries)) {
          await interaction.reply({ content: 'That tournament is full.', ephemeral: true });
          return;
        }

        if (entries.some(entry => entry.user_id === interaction.user.id)) {
          await interaction.reply({ content: 'You are already registered for that tournament.', ephemeral: true });
          return;
        }

        const buyIn = Number(tournament.buy_in || 0);
        if (buyIn > 0) {
          const removed = await removeCurrency(interaction.guild.id, interaction.user.id, buyIn, 'tournament_buy_in', `Buy-in: ${tournament.tournament_name}`, interaction.user.id);
          if (!removed) {
            await interaction.reply({ content: `You need **${settings.currency_icon} ${buyIn} ${settings.currency_name}** to join this tournament.`, ephemeral: true });
            return;
          }
        }

        await pool.query(
          `INSERT INTO tournament_entries (tournament_id, guild_id, user_id, paid_buy_in)
           VALUES ($1, $2, $3, $4)`,
          [tournament.id, interaction.guild.id, interaction.user.id, buyIn]
        );

        if (buyIn > 0) {
          await pool.query(`UPDATE tournaments SET prize_pool = prize_pool + $1, updated_at = NOW() WHERE id = $2`, [buyIn, tournament.id]);
        }

        const updatedTournament = await findTournament(interaction.guild.id, tournament.id);
        const updatedEntries = await getTournamentEntries(tournament.id);
        await interaction.update({
          embeds: [buildTournamentAnnouncementEmbed(settings, updatedTournament || tournament, updatedEntries)],
          components: [buildTournamentJoinButton(tournament.id, tournament.max_entries && updatedEntries.length >= Number(tournament.max_entries))],
        });
        await interaction.followUp({ content: `You joined **${tournament.tournament_name}**.`, ephemeral: true });
        return;
      }

      if (interaction.customId.startsWith('tourney_match_winner:')) {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Tournament buttons must be used inside the server.', ephemeral: true });
          return;
        }

        const [, matchId, winnerUserId] = interaction.customId.split(':');
        const matchResult = await pool.query(
          `SELECT m.*, t.tournament_name, t.prize_pool
           FROM tournament_matches m
           JOIN tournaments t ON t.id = m.tournament_id
           WHERE m.id = $1`,
          [matchId]
        );

        if (!matchResult.rows.length) {
          await interaction.reply({ content: 'Could not find that tournament match.', ephemeral: true });
          return;
        }

        const match = matchResult.rows[0];
        const tournament = await findTournament(interaction.guild.id, match.tournament_name);
        const activeLeague = tournament?.league_id ? await getLeagueById(tournament.league_id) : await resolveLeague(interaction);
        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (!(await memberHasStaff(member, activeLeague))) {
          await interaction.reply({ content: 'Only staff/admins can confirm tournament match winners.', ephemeral: true });
          return;
        }

        if (match.status === 'final') {
          await interaction.reply({ content: 'That match is already final.', ephemeral: true });
          return;
        }

        const validWinner = winnerUserId === match.player1_user_id || winnerUserId === match.player2_user_id;
        if (!validWinner) {
          await interaction.reply({ content: 'Winner must be one of the two users in that match.', ephemeral: true });
          return;
        }

        const result = await finalizeTournamentMatch(interaction.guild, match, winnerUserId, interaction.user.id);

        await interaction.update({
          embeds: [buildTournamentMatchThreadEmbed(tournament || { tournament_name: match.tournament_name }, { ...match, winner_user_id: winnerUserId, status: 'final' })],
          components: [buildMatchWinnerButtons(match, true)],
        });

        await interaction.followUp({ content: result.message, ephemeral: true });
        return;
      }
      if (interaction.customId.startsWith('ticket_review_approve:') || interaction.customId.startsWith('ticket_review_deny:')) {
        if (!interaction.guild) return;

        const isApproved = interaction.customId.startsWith('ticket_review_approve:');
        const ticketId = interaction.customId.split(':')[1];
        const ticketResult = await pool.query(
          `SELECT * FROM support_tickets WHERE guild_id = $1 AND id = $2 LIMIT 1`,
          [interaction.guild.id, ticketId]
        );

        if (!ticketResult.rows.length) {
          await interaction.reply({ content: 'Could not find that ticket.', ephemeral: true });
          return;
        }

        const ticket = ticketResult.rows[0];
        const activeLeague = ticket.league_id ? await getLeagueById(ticket.league_id) : await resolveLeague(interaction);
        const reviewer = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const isStaff = reviewer ? await memberHasStaff(reviewer, activeLeague) : false;

        if (!isStaff) {
          await interaction.reply({ content: 'Only staff/admins can approve or deny game issue requests.', ephemeral: true });
          return;
        }

        if (ticket.review_decision) {
          await interaction.reply({ content: 'This request already has a decision: **' + ticket.review_decision + '**.', ephemeral: true });
          return;
        }

        const decision = isApproved ? 'approved' : 'denied';
        await pool.query(
          `UPDATE support_tickets
           SET review_decision = $1,
               review_decision_by_user_id = $2,
               review_decision_at = NOW(),
               status = 'resolved'
           WHERE id = $3`,
          [decision, interaction.user.id, ticket.id]
        );

        let applyMessage = '';
        if (isApproved) {
          applyMessage = await applyApprovedGameIssue(ticket, interaction.user.id);
        }

        await updateTicketPanel(interaction.guild);

        await interaction.update({
          content: 'Request **' + decision + '** by <@' + interaction.user.id + '>.' + (applyMessage ? ' ' + applyMessage : ''),
          components: [buildTicketReviewButtons(ticket.id, true)],
        });

        if (interaction.channel?.isTextBased()) {
          await interaction.channel.send({
            content: 'Decision recorded: **' + decision + '** by <@' + interaction.user.id + '>.' + (applyMessage ? String.fromCharCode(10) + applyMessage : '') + String.fromCharCode(10) + 'Use `/closeticket` when the review is fully complete.',
            allowedMentions: { users: [interaction.user.id], roles: [] },
          }).catch(() => null);
        }
        return;
      }

      if (interaction.customId.startsWith('sportsbook_pick_game:')) {
        if (!interaction.guild) return;
        const gameId = interaction.customId.split(':')[1];
        const sportsbookGame = await findSportsbookGame(interaction.guild.id, gameId);

        if (!sportsbookGame || sportsbookGame.status !== 'open') {
          await interaction.reply({ content: 'That sportsbook game is no longer open.', ephemeral: true });
          return;
        }

        await interaction.reply({
          content: 'Choose your side for **' + sportsbookGame.game_label + '**.',
          components: [buildSportsbookSideButtons(sportsbookGame)],
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId.startsWith('sportsbook_pick_side:')) {
        if (!interaction.guild) return;
        const [, gameId, side] = interaction.customId.split(':');
        const sportsbookGame = await findSportsbookGame(interaction.guild.id, gameId);

        if (!sportsbookGame || sportsbookGame.status !== 'open') {
          await interaction.reply({ content: 'That sportsbook game is no longer open.', ephemeral: true });
          return;
        }

        if (!['home', 'away'].includes(side)) {
          await interaction.reply({ content: 'Invalid bet side.', ephemeral: true });
          return;
        }

        const sideLabel = side === 'home' ? sportsbookGame.home_label : sportsbookGame.away_label;
        const odds = side === 'home' ? sportsbookGame.home_odds : sportsbookGame.away_odds;
        const modal = new ModalBuilder()
          .setCustomId('sportsbook_bet_modal:' + sportsbookGame.id + ':' + side)
          .setTitle('Bet ' + sideLabel + ' ML ' + odds);

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('sportsbook_bet_amount')
              .setLabel('Bet amount')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('Example: 100')
              .setMaxLength(10)
          )
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('support_panel_open:')) {
        if (!interaction.guild) return;

        const panelType = interaction.customId.split(':')[1] || 'support';
        const ticketType = panelType === 'dispute' ? 'dispute' : 'support';
        const subjectMap = {
          support: 'Support Request',
          dispute: 'Dispute Review',
          game: 'Game Issue Request',
          shop: 'Shop / Redemption Help',
        };
        const descriptionMap = {
          support: 'Opened from the support panel. Please explain what you need help with in this thread.',
          dispute: 'Opened from the support panel. Please explain the dispute and upload any proof/screenshots in this thread.',
          game: 'Opened from the support panel. Please include league, teams, game ID if available, score/time remaining, and upload proof/screenshots.',
          shop: 'Opened from the support panel. Please explain the shop, inventory, redemption, or reward issue.',
        };

        interaction.options = {
          getString(name) {
            if (name === 'subject') return subjectMap[panelType] || 'Support Request';
            if (name === 'description') return descriptionMap[panelType] || 'Opened from the support panel.';
            if (name === 'league') return null;
            return null;
          }
        };

        await openSupportTicket(interaction, panelType === 'game' ? 'gamerequest' : ticketType);
        return;
      }

      if (interaction.customId.startsWith('ticket_dashboard_filter:')) {
        if (!interaction.guild) return;
        if (!(await userCanUseLeagueSetup(interaction, await resolveLeague(interaction)))) {
          await interaction.reply({ content: 'Only staff/admins can use the ticket dashboard filters.', ephemeral: true });
          return;
        }

        const filter = interaction.customId.split(':')[1] || 'open';
        await interaction.update({
          embeds: [await buildTicketDashboardEmbed(interaction.guild.id, filter)],
          components: [buildTicketDashboardButtons()],
        });
        return;
      }

      if (interaction.customId.startsWith('ticket_quick_claim:') || interaction.customId.startsWith('ticket_quick_reviewing:') || interaction.customId.startsWith('ticket_quick_resolved:')) {
        if (!interaction.guild) return;

        const [action, ticketId] = interaction.customId.split(':');
        const ticketResult = await pool.query(
          `SELECT * FROM support_tickets WHERE guild_id = $1 AND id = $2 LIMIT 1`,
          [interaction.guild.id, ticketId]
        );

        if (!ticketResult.rows.length) {
          await interaction.reply({ content: 'Could not find that ticket.', ephemeral: true });
          return;
        }

        const ticket = ticketResult.rows[0];
        const activeLeague = ticket.league_id ? await getLeagueById(ticket.league_id) : await resolveLeague(interaction);
        const staffMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const isStaff = staffMember ? await memberHasStaff(staffMember, activeLeague) : false;

        if (!isStaff) {
          await interaction.reply({ content: 'Only staff/admins can use quick ticket actions.', ephemeral: true });
          return;
        }

        if (action === 'ticket_quick_claim') {
          await pool.query(`UPDATE support_tickets SET assigned_staff_user_id = $1 WHERE id = $2`, [interaction.user.id, ticket.id]);
          await updateTicketPanel(interaction.guild);
          await interaction.reply({ content: 'Ticket **' + shortTicketId(ticket.id) + '** claimed by <@' + interaction.user.id + '>.', ephemeral: true });
          return;
        }

        const newStatus = action === 'ticket_quick_reviewing' ? 'reviewing' : 'resolved';
        await pool.query(`UPDATE support_tickets SET status = $1 WHERE id = $2`, [newStatus, ticket.id]);
        if (newStatus === 'resolved') {
          await incrementRecognitionStat(interaction.guild.id, interaction.user.id, 'tickets_resolved', 1);
          await addRecognitionPoints(interaction.guild.id, interaction.user.id, 5, 2);
        }
        await updateTicketPanel(interaction.guild);
        await interaction.reply({ content: 'Ticket **' + shortTicketId(ticket.id) + '** marked **' + newStatus + '**.', ephemeral: true });
        return;
      }

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

      if (interaction.commandName === 'league-settournamentchannel') {
        const channel = interaction.options.getChannel('channel');
        const botMember = await interaction.guild.members.fetchMe();
        const permissions = channel?.permissionsFor(botMember);
        if (!channel || !channel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
          await interaction.reply({ content: 'I need View Channel, Send Messages, and Embed Links permissions in that tournament channel.', ephemeral: true });
          return;
        }
        await pool.query(`UPDATE league_settings SET tournament_channel_id = $1, updated_at = NOW() WHERE league_id = $2`, [channel.id, league.league_id]);
        await interaction.reply({ content: `Tournament channel for **${league.league_name}** set to ${channel}.`, ephemeral: true });
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

    if (interaction.commandName === 'ticket') {
      await openSupportTicket(interaction, 'support');
      return;
    }

    if (interaction.commandName === 'dispute') {
      await openSupportTicket(interaction, 'dispute');
      return;
    }

    if (interaction.commandName === 'gamerequest') {
      await openSupportTicket(interaction, 'gamerequest');
      return;
    }

    if (interaction.commandName === 'closeticket') {
      if (!interaction.guild) return;
      if (!interaction.channel?.isThread()) {
        await interaction.reply({ content: 'Use this command inside a ticket thread.', ephemeral: true });
        return;
      }

      const ticketResult = await pool.query(
        `SELECT * FROM support_tickets WHERE guild_id = $1 AND thread_id = $2 AND status = 'open' LIMIT 1`,
        [interaction.guild.id, interaction.channel.id]
      );

      if (!ticketResult.rows.length) {
        await interaction.reply({ content: 'This does not appear to be an open ticket thread.', ephemeral: true });
        return;
      }

      const ticket = ticketResult.rows[0];
      const activeLeague = ticket.league_id ? await getLeagueById(ticket.league_id) : await resolveLeague(interaction);
      const closer = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const isTicketOwner = ticket.user_id === interaction.user.id;
      const isStaff = closer ? await memberHasStaff(closer, activeLeague) : false;

      if (!isTicketOwner && !isStaff) {
        await interaction.reply({ content: 'Only the ticket owner or staff can close this ticket.', ephemeral: true });
        return;
      }

      const closeReason = interaction.options.getString('reason');
      await saveTicketTranscript(interaction.channel, ticket);
      await closeTicketRecord(interaction.channel.id, interaction.user.id);
      if (closeReason) {
        await pool.query(`UPDATE support_tickets SET close_reason = $1 WHERE id = $2`, [closeReason, ticket.id]);
      }
      await updateTicketPanel(interaction.guild);
      await interaction.reply({ content: 'Ticket closed. Transcript saved. This thread will be archived.' + (closeReason ? ' Reason: ' + closeReason : ''), ephemeral: false });
      await interaction.channel.setArchived(true, 'Ticket closed').catch(() => null);
      return;
    }

    if (interaction.commandName === 'setupsupportpanel') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to set up the support panel.', ephemeral: true });
        return;
      }

      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const botMember = await interaction.guild.members.fetchMe();
      const permissions = channel?.permissionsFor(botMember);

      if (!channel || !channel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
        await interaction.reply({ content: 'I need View Channel, Send Messages, and Embed Links permissions in that support panel channel.', ephemeral: true });
        return;
      }

      await channel.send({ embeds: [buildSupportPanelEmbed()], components: [buildSupportPanelButtons()] });
      await interaction.reply({ content: 'Support panel created in ' + channel.toString() + '.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'setupticketpanel') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to set up the ticket dashboard.', ephemeral: true });
        return;
      }

      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const botMember = await interaction.guild.members.fetchMe();
      const permissions = channel?.permissionsFor(botMember);

      if (!channel || !channel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
        await interaction.reply({ content: 'I need View Channel, Send Messages, and Embed Links permissions in that dashboard channel.', ephemeral: true });
        return;
      }

      const message = await channel.send({ embeds: [await buildTicketDashboardEmbed(interaction.guild.id)], components: [buildTicketDashboardButtons()] });
      await saveTicketPanel(interaction.guild.id, channel.id, message.id);
      await interaction.reply({ content: 'Ticket dashboard panel created in ' + channel.toString() + '.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'tickets') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to view ticket logs.', ephemeral: true });
        return;
      }

      const status = interaction.options.getString('status') || 'open';
      const priority = interaction.options.getString('priority');
      const allowedStatuses = ['open', 'pending', 'reviewing', 'resolved', 'closed'];
      const allowedPriorities = ['low', 'normal', 'high', 'urgent'];

      if (!allowedStatuses.includes(status)) {
        await interaction.reply({ content: 'Status must be one of: open, pending, reviewing, resolved, closed.', ephemeral: true });
        return;
      }

      if (priority && !allowedPriorities.includes(priority)) {
        await interaction.reply({ content: 'Priority must be one of: low, normal, high, urgent.', ephemeral: true });
        return;
      }

      const result = priority
        ? await pool.query(
            `SELECT * FROM support_tickets
             WHERE guild_id = $1 AND status = $2 AND priority = $3
             ORDER BY created_at DESC
             LIMIT 20`,
            [interaction.guild.id, status, priority]
          )
        : await pool.query(
            `SELECT * FROM support_tickets
             WHERE guild_id = $1 AND status = $2
             ORDER BY created_at DESC
             LIMIT 20`,
            [interaction.guild.id, status]
          );

      await interaction.reply({ embeds: [buildTicketsEmbed(result.rows, status)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'ticketinfo') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to view ticket info.', ephemeral: true });
        return;
      }

      const ticketInput = interaction.options.getString('ticket_id');
      const result = await pool.query(
        `SELECT * FROM support_tickets
         WHERE guild_id = $1 AND id::text LIKE $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [interaction.guild.id, ticketInput + '%']
      );

      if (!result.rows.length) {
        await interaction.reply({ content: 'Could not find that ticket ID.', ephemeral: true });
        return;
      }

      await interaction.reply({ embeds: [buildTicketInfoEmbed(result.rows[0])], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'claimticket') {
      if (!interaction.guild) return;
      if (!interaction.channel?.isThread()) {
        await interaction.reply({ content: 'Use this command inside an open ticket thread.', ephemeral: true });
        return;
      }

      const ticketResult = await pool.query(
        `SELECT * FROM support_tickets WHERE guild_id = $1 AND thread_id = $2 AND status = 'open' LIMIT 1`,
        [interaction.guild.id, interaction.channel.id]
      );

      if (!ticketResult.rows.length) {
        await interaction.reply({ content: 'This does not appear to be an open ticket thread.', ephemeral: true });
        return;
      }

      const ticket = ticketResult.rows[0];
      const activeLeague = ticket.league_id ? await getLeagueById(ticket.league_id) : await resolveLeague(interaction);
      const staffMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const isStaff = staffMember ? await memberHasStaff(staffMember, activeLeague) : false;

      if (!isStaff) {
        await interaction.reply({ content: 'Only staff/admins can claim tickets.', ephemeral: true });
        return;
      }

      await pool.query(
        `UPDATE support_tickets SET assigned_staff_user_id = $1 WHERE id = $2`,
        [interaction.user.id, ticket.id]
      );

      await updateTicketPanel(interaction.guild);
      await interaction.reply({ content: '<@' + interaction.user.id + '> has claimed this ticket.', ephemeral: false });
      return;
    }

    if (interaction.commandName === 'tickettranscript') {
      if (!interaction.guild) return;
      const ticketInput = interaction.options.getString('ticket_id');
      const ticketResult = await pool.query(
        `SELECT * FROM support_tickets WHERE guild_id = $1 AND id::text LIKE $2 ORDER BY created_at DESC LIMIT 1`,
        [interaction.guild.id, ticketInput + '%']
      );

      if (!ticketResult.rows.length) {
        await interaction.reply({ content: 'Could not find that ticket ID.', ephemeral: true });
        return;
      }

      const ticket = ticketResult.rows[0];
      const activeLeague = ticket.league_id ? await getLeagueById(ticket.league_id) : await resolveLeague(interaction);
      const viewer = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const isTicketOwner = ticket.user_id === interaction.user.id;
      const isStaff = viewer ? await memberHasStaff(viewer, activeLeague) : false;

      if (!isTicketOwner && !isStaff) {
        await interaction.reply({ content: 'Only the ticket owner or staff can view this transcript.', ephemeral: true });
        return;
      }

      const transcriptResult = await pool.query(
        `SELECT * FROM ticket_transcripts WHERE guild_id = $1 AND ticket_id = $2 ORDER BY message_created_at ASC LIMIT 40`,
        [interaction.guild.id, ticket.id]
      );

      await interaction.reply({ embeds: [buildTicketTranscriptEmbed(ticket, transcriptResult.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'setticketstatus') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to update ticket status.', ephemeral: true });
        return;
      }

      const status = interaction.options.getString('status');
      const ticketInput = interaction.options.getString('ticket_id');
      const allowedStatuses = ['open', 'pending', 'reviewing', 'resolved', 'closed'];

      if (!allowedStatuses.includes(status)) {
        await interaction.reply({ content: 'Status must be one of: open, pending, reviewing, resolved, closed.', ephemeral: true });
        return;
      }

      let ticket = null;
      if (ticketInput) {
        const result = await pool.query(
          `SELECT * FROM support_tickets WHERE guild_id = $1 AND id::text LIKE $2 ORDER BY created_at DESC LIMIT 1`,
          [interaction.guild.id, ticketInput + '%']
        );
        ticket = result.rows[0] || null;
      } else if (interaction.channel?.isThread()) {
        const result = await pool.query(
          `SELECT * FROM support_tickets WHERE guild_id = $1 AND thread_id = $2 ORDER BY created_at DESC LIMIT 1`,
          [interaction.guild.id, interaction.channel.id]
        );
        ticket = result.rows[0] || null;
      }

      if (!ticket) {
        await interaction.reply({ content: 'Could not find that ticket. Use this in a ticket thread or provide a ticket ID.', ephemeral: true });
        return;
      }

      await pool.query(`UPDATE support_tickets SET status = $1 WHERE id = $2`, [status, ticket.id]);
      await updateTicketPanel(interaction.guild);
      await interaction.reply({ content: 'Ticket **' + shortTicketId(ticket.id) + '** status set to **' + status + '**.', ephemeral: false });
      return;
    }

    if (interaction.commandName === 'setticketpriority') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to update ticket priority.', ephemeral: true });
        return;
      }

      const priority = interaction.options.getString('priority');
      const ticketInput = interaction.options.getString('ticket_id');
      const allowedPriorities = ['low', 'normal', 'high', 'urgent'];

      if (!allowedPriorities.includes(priority)) {
        await interaction.reply({ content: 'Priority must be one of: low, normal, high, urgent.', ephemeral: true });
        return;
      }

      let ticket = null;
      if (ticketInput) {
        const result = await pool.query(
          `SELECT * FROM support_tickets WHERE guild_id = $1 AND id::text LIKE $2 ORDER BY created_at DESC LIMIT 1`,
          [interaction.guild.id, ticketInput + '%']
        );
        ticket = result.rows[0] || null;
      } else if (interaction.channel?.isThread()) {
        const result = await pool.query(
          `SELECT * FROM support_tickets WHERE guild_id = $1 AND thread_id = $2 ORDER BY created_at DESC LIMIT 1`,
          [interaction.guild.id, interaction.channel.id]
        );
        ticket = result.rows[0] || null;
      }

      if (!ticket) {
        await interaction.reply({ content: 'Could not find that ticket. Use this in a ticket thread or provide a ticket ID.', ephemeral: true });
        return;
      }

      await pool.query(`UPDATE support_tickets SET priority = $1 WHERE id = $2`, [priority, ticket.id]);
      await updateTicketPanel(interaction.guild);
      await interaction.reply({ content: 'Ticket **' + shortTicketId(ticket.id) + '** priority set to **' + priority + '**.', ephemeral: false });
      return;
    }

    if (interaction.commandName === 'ticketevidence') {
      if (!interaction.guild) return;
      const ticketInput = interaction.options.getString('ticket_id');
      let ticket = null;

      if (ticketInput) {
        const ticketResult = await pool.query(
          `SELECT * FROM support_tickets WHERE guild_id = $1 AND id::text LIKE $2 ORDER BY created_at DESC LIMIT 1`,
          [interaction.guild.id, ticketInput + '%']
        );
        ticket = ticketResult.rows[0] || null;
      } else if (interaction.channel?.isThread()) {
        ticket = await getOpenTicketByThread(interaction.guild.id, interaction.channel.id);
      }

      if (!ticket) {
        await interaction.reply({ content: 'Could not find that ticket. Use this in a ticket thread or provide a ticket ID.', ephemeral: true });
        return;
      }

      const activeLeague = ticket.league_id ? await getLeagueById(ticket.league_id) : await resolveLeague(interaction);
      const viewer = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const isTicketOwner = ticket.user_id === interaction.user.id;
      const isStaff = viewer ? await memberHasStaff(viewer, activeLeague) : false;

      if (!isTicketOwner && !isStaff) {
        await interaction.reply({ content: 'Only the ticket owner or staff can view this ticket evidence.', ephemeral: true });
        return;
      }

      const evidenceResult = await pool.query(
        `SELECT * FROM ticket_evidence WHERE guild_id = $1 AND ticket_id = $2 ORDER BY created_at ASC LIMIT 20`,
        [interaction.guild.id, ticket.id]
      );

      await interaction.reply({ embeds: [buildTicketEvidenceEmbed(ticket, evidenceResult.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'gameissuelog') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to view the game issue log.', ephemeral: true });
        return;
      }

      const requestedLeagueName = interaction.options.getString('league');
      const decision = interaction.options.getString('decision');
      const allowedDecisions = ['approved', 'denied'];

      if (decision && !allowedDecisions.includes(decision)) {
        await interaction.reply({ content: 'Decision must be approved or denied.', ephemeral: true });
        return;
      }

      let activeLeague = null;
      if (requestedLeagueName) {
        activeLeague = await getLeagueByName(interaction.guild.id, requestedLeagueName);
        if (!activeLeague) {
          await interaction.reply({ content: 'Could not find league **' + requestedLeagueName + '**.', ephemeral: true });
          return;
        }
      }

      let result;
      if (activeLeague && decision) {
        result = await pool.query(
          `SELECT * FROM support_tickets
           WHERE guild_id = $1 AND league_id = $2 AND ticket_type = 'gamerequest'
             AND request_action IN ('lagout', 'quit', 'reset')
             AND review_decision = $3
           ORDER BY review_decision_at DESC NULLS LAST, created_at DESC
           LIMIT 25`,
          [interaction.guild.id, activeLeague.league_id, decision]
        );
      } else if (activeLeague) {
        result = await pool.query(
          `SELECT * FROM support_tickets
           WHERE guild_id = $1 AND league_id = $2 AND ticket_type = 'gamerequest'
             AND request_action IN ('lagout', 'quit', 'reset')
           ORDER BY review_decision_at DESC NULLS LAST, created_at DESC
           LIMIT 25`,
          [interaction.guild.id, activeLeague.league_id]
        );
      } else if (decision) {
        result = await pool.query(
          `SELECT * FROM support_tickets
           WHERE guild_id = $1 AND ticket_type = 'gamerequest'
             AND request_action IN ('lagout', 'quit', 'reset')
             AND review_decision = $2
           ORDER BY review_decision_at DESC NULLS LAST, created_at DESC
           LIMIT 25`,
          [interaction.guild.id, decision]
        );
      } else {
        result = await pool.query(
          `SELECT * FROM support_tickets
           WHERE guild_id = $1 AND ticket_type = 'gamerequest'
             AND request_action IN ('lagout', 'quit', 'reset')
           ORDER BY review_decision_at DESC NULLS LAST, created_at DESC
           LIMIT 25`,
          [interaction.guild.id]
        );
      }

      await interaction.reply({ embeds: [buildGameIssueLogEmbed(result.rows, activeLeague?.league_name || null, decision || null)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'lagoutrequest') {
      await openGameIssueTicket(interaction, 'lagout');
      return;
    }

    if (interaction.commandName === 'quitrequest') {
      await openGameIssueTicket(interaction, 'quit');
      return;
    }

    if (interaction.commandName === 'resetrequest') {
      await openGameIssueTicket(interaction, 'reset');
      return;
    }

    if (interaction.commandName === 'setsportsbookfeed') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to set the sportsbook feed.', ephemeral: true });
        return;
      }

      const channel = interaction.options.getChannel('channel');
      const threshold = interaction.options.getInteger('big_bet_threshold') ?? 500;
      const botMember = await interaction.guild.members.fetchMe();
      const permissions = channel?.permissionsFor(botMember);

      if (!channel || !channel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
        await interaction.reply({ content: 'I need View Channel, Send Messages, and Embed Links permissions in that sportsbook feed channel.', ephemeral: true });
        return;
      }

      if (threshold <= 0) {
        await interaction.reply({ content: 'Big bet threshold must be greater than 0.', ephemeral: true });
        return;
      }

      await pool.query(
        `INSERT INTO sportsbook_settings (guild_id, feed_channel_id, big_bet_threshold, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (guild_id)
         DO UPDATE SET feed_channel_id = $2, big_bet_threshold = $3, updated_at = NOW()`,
        [interaction.guild.id, channel.id, threshold]
      );

      await interaction.reply({ content: 'Sportsbook feed set to ' + channel.toString() + '. Big bet threshold: **' + threshold + '**.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'setupsportsbookpanel') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to set up the sportsbook board.', ephemeral: true });
        return;
      }

      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const botMember = await interaction.guild.members.fetchMe();
      const permissions = channel?.permissionsFor(botMember);

      if (!channel || !channel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
        await interaction.reply({ content: 'I need View Channel, Send Messages, and Embed Links permissions in that sportsbook channel.', ephemeral: true });
        return;
      }

      const openSportsbookResult = await pool.query(
        `SELECT * FROM sportsbook_games WHERE guild_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 5`,
        [interaction.guild.id]
      );
      const message = await channel.send({ embeds: [await buildSportsbookPanelEmbed(interaction.guild.id)], components: buildSportsbookBetBoardButtons(openSportsbookResult.rows) });
      await saveSportsbookPanel(interaction.guild.id, channel.id, message.id);
      await interaction.reply({ content: 'Sportsbook board created in ' + channel.toString() + '.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'bettinghistory') {
      if (!interaction.guild) return;
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const settings = await getCurrencySettings(interaction.guild.id);

      const summaryResult = await pool.query(
        `SELECT
           COUNT(*)::int AS total_bets,
           COUNT(*) FILTER (WHERE status = 'won')::int AS wins,
           COUNT(*) FILTER (WHERE status = 'lost')::int AS losses,
           COUNT(*) FILTER (WHERE status = 'open')::int AS open_bets,
           COALESCE(SUM(amount), 0)::int AS total_wagered,
           COALESCE(SUM(CASE WHEN status = 'won' THEN potential_payout ELSE 0 END), 0)::int AS total_won
         FROM sportsbook_bets
         WHERE guild_id = $1 AND user_id = $2`,
        [interaction.guild.id, targetUser.id]
      );

      const recentResult = await pool.query(
        `SELECT b.*, g.game_label, g.home_label, g.away_label
         FROM sportsbook_bets b
         JOIN sportsbook_games g ON g.id = b.sportsbook_game_id
         WHERE b.guild_id = $1 AND b.user_id = $2
         ORDER BY b.created_at DESC
         LIMIT 10`,
        [interaction.guild.id, targetUser.id]
      );

      await interaction.reply({ embeds: [buildBettingHistoryEmbed(settings, targetUser, summaryResult.rows[0] || {}, recentResult.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'bettingleaderboard') {
      if (!interaction.guild) return;
      const settings = await getCurrencySettings(interaction.guild.id);
      const result = await pool.query(
        `SELECT
           user_id,
           COUNT(*) FILTER (WHERE status = 'won')::int AS wins,
           COUNT(*) FILTER (WHERE status = 'lost')::int AS losses,
           COALESCE(SUM(amount), 0)::int AS total_wagered,
           COALESCE(SUM(CASE WHEN status = 'won' THEN potential_payout ELSE 0 END), 0)::int AS total_won,
           (COALESCE(SUM(CASE WHEN status = 'won' THEN potential_payout ELSE 0 END), 0) - COALESCE(SUM(amount), 0))::int AS net_profit
         FROM sportsbook_bets
         WHERE guild_id = $1 AND status IN ('won', 'lost')
         GROUP BY user_id
         ORDER BY net_profit DESC, wins DESC, total_wagered DESC
         LIMIT 10`,
        [interaction.guild.id]
      );

      await interaction.reply({ embeds: [buildBettingLeaderboardEmbed(settings, result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'activity') {
      if (!interaction.guild) return;
      const targetUser = interaction.options.getUser('user') || interaction.user;
      await ensureRecognitionProfile(interaction.guild.id, targetUser.id);

      const result = await pool.query(
        `SELECT * FROM user_recognition WHERE guild_id = $1 AND user_id = $2 LIMIT 1`,
        [interaction.guild.id, targetUser.id]
      );

      await interaction.reply({ embeds: [buildActivityEmbed(targetUser, result.rows[0] || {})], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'activityleaderboard') {
      if (!interaction.guild) return;

      const result = await pool.query(
        `SELECT * FROM user_recognition
         WHERE guild_id = $1
         ORDER BY activity_points DESC, activity_streak DESC, legacy_score DESC
         LIMIT 15`,
        [interaction.guild.id]
      );

      await interaction.reply({ embeds: [buildActivityLeaderboardEmbed(result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'milestones') {
      if (!interaction.guild) return;
      const targetUser = interaction.options.getUser('user') || interaction.user;
      await ensureRecognitionProfile(interaction.guild.id, targetUser.id);

      const profileResult = await pool.query(
        `SELECT activity_points FROM user_recognition WHERE guild_id = $1 AND user_id = $2 LIMIT 1`,
        [interaction.guild.id, targetUser.id]
      );
      const claimedResult = await pool.query(
        `SELECT milestone_key FROM activity_milestones_claimed WHERE guild_id = $1 AND user_id = $2`,
        [interaction.guild.id, targetUser.id]
      );

      await interaction.reply({
        embeds: [buildMilestonesEmbed(targetUser, profileResult.rows[0]?.activity_points || 0, claimedResult.rows.map(row => row.milestone_key))],
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'setactivitychannel') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to set the activity channel.', ephemeral: true });
        return;
      }

      const channel = interaction.options.getChannel('channel');
      const botMember = await interaction.guild.members.fetchMe();
      const permissions = channel?.permissionsFor(botMember);

      if (!channel || !channel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
        await interaction.reply({ content: 'I need View Channel, Send Messages, and Embed Links permissions in that activity channel.', ephemeral: true });
        return;
      }

      await pool.query(
        `INSERT INTO activity_settings (guild_id, milestone_channel_id, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (guild_id)
         DO UPDATE SET milestone_channel_id = $2, updated_at = NOW()`,
        [interaction.guild.id, channel.id]
      );

      await interaction.reply({ content: 'Activity milestone channel set to ' + channel.toString() + '.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'legacy') {
      if (!interaction.guild) return;

      const result = await pool.query(
        `SELECT * FROM user_recognition
         WHERE guild_id = $1
         ORDER BY legacy_score DESC, activity_points DESC
         LIMIT 15`,
        [interaction.guild.id]
      );

      await interaction.reply({ embeds: [buildLegacyLeaderboardEmbed(result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'createparlay') {
      if (!interaction.guild) return;
      const settings = await getCurrencySettings(interaction.guild.id);
      const amount = interaction.options.getInteger('amount');

      if (!Number.isInteger(amount) || amount <= 0) {
        await interaction.reply({ content: 'Parlay amount must be greater than 0.', ephemeral: true });
        return;
      }

      const legInputs = [
        { game: interaction.options.getString('leg1_game'), side: interaction.options.getString('leg1_side') },
        { game: interaction.options.getString('leg2_game'), side: interaction.options.getString('leg2_side') },
        { game: interaction.options.getString('leg3_game'), side: interaction.options.getString('leg3_side') },
        { game: interaction.options.getString('leg4_game'), side: interaction.options.getString('leg4_side') },
      ].filter(leg => leg.game || leg.side);

      if (legInputs.length < 2 || legInputs.length > 4) {
        await interaction.reply({ content: 'Parlays must have 2 to 4 legs.', ephemeral: true });
        return;
      }

      if (legInputs.some(leg => !leg.game || !['home', 'away'].includes(leg.side))) {
        await interaction.reply({ content: 'Each parlay leg needs a game ID and side must be home or away.', ephemeral: true });
        return;
      }

      const usedGameIds = new Set();
      const legs = [];
      for (const legInput of legInputs) {
        const sportsbookGame = await findSportsbookGame(interaction.guild.id, legInput.game);
        if (!sportsbookGame) {
          await interaction.reply({ content: 'Could not find sportsbook game **' + legInput.game + '**.', ephemeral: true });
          return;
        }
        if (sportsbookGame.status !== 'open') {
          await interaction.reply({ content: 'Sportsbook game **' + sportsbookGame.game_label + '** is not open for betting.', ephemeral: true });
          return;
        }
        if (usedGameIds.has(sportsbookGame.id)) {
          await interaction.reply({ content: 'You cannot use the same game twice in one parlay.', ephemeral: true });
          return;
        }
        usedGameIds.add(sportsbookGame.id);
        const odds = legInput.side === 'home' ? Number(sportsbookGame.home_odds) : Number(sportsbookGame.away_odds);
        legs.push({ sportsbookGame, side: legInput.side, odds });
      }

      const payoutData = calculateParlayPayout(amount, legs.map(leg => leg.odds));
      const removed = await removeCurrency(interaction.guild.id, interaction.user.id, amount, 'sportsbook_parlay_bet', 'Parlay bet', interaction.user.id);
      if (!removed) {
        await interaction.reply({ content: 'You do not have enough ' + settings.currency_name + ' to create that parlay.', ephemeral: true });
        return;
      }

      const parlayId = randomUUID();
      await pool.query(
        `INSERT INTO sportsbook_parlays (id, guild_id, user_id, amount, combined_decimal, potential_payout)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [parlayId, interaction.guild.id, interaction.user.id, amount, payoutData.combinedDecimal, payoutData.payout]
      );

      for (const leg of legs) {
        await pool.query(
          `INSERT INTO sportsbook_parlay_legs (id, parlay_id, sportsbook_game_id, side, odds)
           VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), parlayId, leg.sportsbookGame.id, leg.side, leg.odds]
        );
      }

      const NL = String.fromCharCode(10);
      const legText = legs.map((leg, index) => {
        const sideLabel = leg.side === 'home' ? leg.sportsbookGame.home_label : leg.sportsbookGame.away_label;
        return (index + 1) + '. ' + sideLabel + ' ML ' + leg.odds + ' — ' + leg.sportsbookGame.game_label;
      }).join(NL);

      await updateSportsbookPanel(interaction.guild);
      await postSportsbookFeed(interaction.guild, buildParlayCreatedAlertEmbed(settings, interaction.user, parlayId, amount, payoutData.payout, legs.length));
      await interaction.reply({ content: 'Parlay created: **' + shortSportsbookId(parlayId) + '**' + NL + legText + NL + 'Stake: **' + settings.currency_icon + ' ' + amount + '** • Potential payout: **' + settings.currency_icon + ' ' + payoutData.payout + '**', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'createsportsbookgame') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to create sportsbook games.', ephemeral: true });
        return;
      }

      const label = interaction.options.getString('label');
      const home = interaction.options.getString('home');
      const away = interaction.options.getString('away');
      const homeOdds = interaction.options.getInteger('home_odds') ?? -110;
      const awayOdds = interaction.options.getInteger('away_odds') ?? -110;
      const maxBet = interaction.options.getInteger('max_bet');
      const maxPayout = interaction.options.getInteger('max_payout');
      const leagueName = interaction.options.getString('league');
      const activeLeague = leagueName ? await getLeagueByName(interaction.guild.id, leagueName) : null;

      if (leagueName && !activeLeague) {
        await interaction.reply({ content: 'Could not find league **' + leagueName + '**.', ephemeral: true });
        return;
      }

      if (homeOdds === 0 || awayOdds === 0) {
        await interaction.reply({ content: 'Odds cannot be 0. Use American odds like -110, -150, +120, or 120.', ephemeral: true });
        return;
      }

      if ((maxBet !== null && maxBet <= 0) || (maxPayout !== null && maxPayout <= 0)) {
        await interaction.reply({ content: 'Max bet and max payout must be greater than 0 when provided.', ephemeral: true });
        return;
      }

      const sportsbookGameId = randomUUID();
      await pool.query(
        `INSERT INTO sportsbook_games (id, guild_id, league_id, game_label, home_label, away_label, home_odds, away_odds, max_bet, max_payout, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [sportsbookGameId, interaction.guild.id, activeLeague?.league_id || null, label, home, away, homeOdds, awayOdds, maxBet, maxPayout, interaction.user.id]
      );

      await updateSportsbookPanel(interaction.guild);
      await interaction.reply({ content: 'Sportsbook game created: **' + shortSportsbookId(sportsbookGameId) + ' • ' + label + '**.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'sportsbook') {
      if (!interaction.guild) return;
      const settings = await getCurrencySettings(interaction.guild.id);
      const result = await pool.query(
        `SELECT * FROM sportsbook_games WHERE guild_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 20`,
        [interaction.guild.id]
      );
      await interaction.reply({ embeds: [buildSportsbookEmbed(settings, result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'placebet') {
      if (!interaction.guild) return;
      const gameInput = interaction.options.getString('game_id');
      const side = interaction.options.getString('side');
      const amount = interaction.options.getInteger('amount');
      const settings = await getCurrencySettings(interaction.guild.id);

      if (!['home', 'away'].includes(side)) {
        await interaction.reply({ content: 'Side must be home or away.', ephemeral: true });
        return;
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        await interaction.reply({ content: 'Bet amount must be greater than 0.', ephemeral: true });
        return;
      }

      const sportsbookGame = await findSportsbookGame(interaction.guild.id, gameInput);
      if (!sportsbookGame) {
        await interaction.reply({ content: 'Could not find that sportsbook game.', ephemeral: true });
        return;
      }

      if (sportsbookGame.status !== 'open') {
        await interaction.reply({ content: 'That sportsbook game is not open for betting.', ephemeral: true });
        return;
      }

      const odds = side === 'home' ? Number(sportsbookGame.home_odds) : Number(sportsbookGame.away_odds);
      const payout = calculateAmericanOddsPayout(amount, odds);
      if (sportsbookGame.max_bet && amount > Number(sportsbookGame.max_bet)) {
        await interaction.reply({ content: 'Max bet for this line is **' + sportsbookGame.max_bet + '**.', ephemeral: true });
        return;
      }
      if (sportsbookGame.max_payout && payout > Number(sportsbookGame.max_payout)) {
        await interaction.reply({ content: 'That bet would exceed the max payout of **' + sportsbookGame.max_payout + '** for this line.', ephemeral: true });
        return;
      }
      const removed = await removeCurrency(interaction.guild.id, interaction.user.id, amount, 'sportsbook_bet', 'Bet on ' + sportsbookGame.game_label, interaction.user.id);

      if (!removed) {
        await interaction.reply({ content: 'You do not have enough ' + settings.currency_name + ' to place that bet.', ephemeral: true });
        return;
      }

      const betId = randomUUID();
      await pool.query(
        `INSERT INTO sportsbook_bets (id, guild_id, sportsbook_game_id, user_id, side, amount, odds, potential_payout)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [betId, interaction.guild.id, sportsbookGame.id, interaction.user.id, side, amount, odds, payout]
      );

      const sideLabel = side === 'home' ? sportsbookGame.home_label : sportsbookGame.away_label;
      await updateSportsbookPanel(interaction.guild);
      const feedSettings = await getSportsbookSettings(interaction.guild.id);
      await postSportsbookFeed(
        interaction.guild,
        buildSportsbookBetAlertEmbed(settings, interaction.user, sportsbookGame, side, amount, odds, payout, amount >= Number(feedSettings.big_bet_threshold || 500))
      );
      await interaction.reply({ content: 'Bet placed: **' + settings.currency_icon + ' ' + amount + '** on **' + sideLabel + ' ML ' + odds + '**. Potential payout: **' + settings.currency_icon + ' ' + payout + '**.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'settlebet') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to settle sportsbook games.', ephemeral: true });
        return;
      }

      const gameInput = interaction.options.getString('game_id');
      const winner = interaction.options.getString('winner');
      if (!['home', 'away'].includes(winner)) {
        await interaction.reply({ content: 'Winner must be home or away.', ephemeral: true });
        return;
      }

      const sportsbookGame = await findSportsbookGame(interaction.guild.id, gameInput);
      if (!sportsbookGame) {
        await interaction.reply({ content: 'Could not find that sportsbook game.', ephemeral: true });
        return;
      }

      if (sportsbookGame.status !== 'open') {
        await interaction.reply({ content: 'That sportsbook game has already been settled or closed.', ephemeral: true });
        return;
      }

      const bets = await pool.query(
        `SELECT * FROM sportsbook_bets WHERE guild_id = $1 AND sportsbook_game_id = $2 AND status = 'open'`,
        [interaction.guild.id, sportsbookGame.id]
      );

      let winners = 0;
      let losers = 0;
      let totalPaid = 0;
      for (const bet of bets.rows) {
        if (bet.side === winner) {
          await addCurrency(interaction.guild.id, bet.user_id, Number(bet.potential_payout), 'sportsbook_win', 'Won bet: ' + sportsbookGame.game_label, interaction.user.id);
          await incrementRecognitionStat(interaction.guild.id, bet.user_id, 'sportsbook_wins', 1);
          await incrementRecognitionStat(interaction.guild.id, bet.user_id, 'sportsbook_profit', Number(bet.potential_payout) - Number(bet.amount));
          await addRecognitionPoints(interaction.guild.id, bet.user_id, 10, 5);
          await pool.query(`UPDATE sportsbook_bets SET status = 'won', settled_at = NOW() WHERE id = $1`, [bet.id]);
          winners += 1;
          totalPaid += Number(bet.potential_payout);
        } else {
          await pool.query(`UPDATE sportsbook_bets SET status = 'lost', settled_at = NOW() WHERE id = $1`, [bet.id]);
          losers += 1;
        }
      }

      await pool.query(
        `UPDATE sportsbook_games SET status = 'settled', winner_side = $1, settled_at = NOW() WHERE id = $2`,
        [winner, sportsbookGame.id]
      );

      const parlayResult = await settleParlaysForSportsbookGame(interaction.guild.id, sportsbookGame.id, winner, interaction.user.id);

      const winnerLabel = winner === 'home' ? sportsbookGame.home_label : sportsbookGame.away_label;
      await updateSportsbookPanel(interaction.guild);
      await postSportsbookFeed(interaction.guild, buildSportsbookSettlementAlertEmbed(sportsbookGame, winnerLabel, winners, losers, totalPaid, parlayResult));
      await interaction.reply({ content: 'Sportsbook settled. Winner: **' + winnerLabel + '**. Winning bets: **' + winners + '**. Losing bets: **' + losers + '**. Total paid: **' + totalPaid + '**. Parlays settled: **' + parlayResult.settledCount + '**. Parlay paid: **' + parlayResult.parlayPaid + '**.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'sportsbookline') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to control sportsbook lines.', ephemeral: true });
        return;
      }

      const gameInput = interaction.options.getString('game_id');
      const action = interaction.options.getString('action');

      if (!['open', 'closed'].includes(action)) {
        await interaction.reply({ content: 'Action must be open or closed.', ephemeral: true });
        return;
      }

      const sportsbookGame = await findSportsbookGame(interaction.guild.id, gameInput);
      if (!sportsbookGame) {
        await interaction.reply({ content: 'Could not find that sportsbook game.', ephemeral: true });
        return;
      }

      if (sportsbookGame.status === 'settled' || sportsbookGame.status === 'cancelled') {
        await interaction.reply({ content: 'Settled or cancelled sportsbook games cannot be reopened/closed.', ephemeral: true });
        return;
      }

      await pool.query(`UPDATE sportsbook_games SET status = $1 WHERE id = $2`, [action, sportsbookGame.id]);
      await updateSportsbookPanel(interaction.guild);
      await interaction.reply({ content: 'Sportsbook line **' + shortSportsbookId(sportsbookGame.id) + ' • ' + sportsbookGame.game_label + '** is now **' + action + '**.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'cancelsportsbookgame') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to cancel sportsbook games.', ephemeral: true });
        return;
      }

      const gameInput = interaction.options.getString('game_id');
      const reason = interaction.options.getString('reason') || 'Sportsbook game cancelled';
      const sportsbookGame = await findSportsbookGame(interaction.guild.id, gameInput);

      if (!sportsbookGame) {
        await interaction.reply({ content: 'Could not find that sportsbook game.', ephemeral: true });
        return;
      }

      if (sportsbookGame.status === 'settled' || sportsbookGame.status === 'cancelled') {
        await interaction.reply({ content: 'That sportsbook game is already settled or cancelled.', ephemeral: true });
        return;
      }

      const openBets = await pool.query(
        `SELECT * FROM sportsbook_bets WHERE guild_id = $1 AND sportsbook_game_id = $2 AND status = 'open'`,
        [interaction.guild.id, sportsbookGame.id]
      );

      let refunded = 0;
      let refundCount = 0;
      for (const bet of openBets.rows) {
        await addCurrency(interaction.guild.id, bet.user_id, Number(bet.amount), 'sportsbook_refund', reason + ': ' + sportsbookGame.game_label, interaction.user.id);
        await pool.query(`UPDATE sportsbook_bets SET status = 'refunded', settled_at = NOW() WHERE id = $1`, [bet.id]);
        refunded += Number(bet.amount);
        refundCount += 1;
      }

      await pool.query(`UPDATE sportsbook_games SET status = 'cancelled', settled_at = NOW() WHERE id = $1`, [sportsbookGame.id]);
      await updateSportsbookPanel(interaction.guild);
      await interaction.reply({ content: 'Sportsbook game cancelled: **' + sportsbookGame.game_label + '**. Refunded **' + refundCount + '** bets totaling **' + refunded + '**.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'mybets') {
      if (!interaction.guild) return;
      const settings = await getCurrencySettings(interaction.guild.id);
      const result = await pool.query(
        `SELECT b.*, g.game_label, g.home_label, g.away_label
         FROM sportsbook_bets b
         JOIN sportsbook_games g ON g.id = b.sportsbook_game_id
         WHERE b.guild_id = $1 AND b.user_id = $2
         ORDER BY b.created_at DESC
         LIMIT 15`,
        [interaction.guild.id, interaction.user.id]
      );
      await interaction.reply({ embeds: [buildMyBetsEmbed(settings, result.rows)], ephemeral: true });
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

      const settings = await getCurrencySettings(interaction.guild.id);
      const winnerOwner = await findTeamOwnerByRoleId(interaction.guild, winnerRoleId);
      const homeOwner = await findTeamOwnerByRoleId(interaction.guild, game.home_team_role_id);
      const awayOwner = await findTeamOwnerByRoleId(interaction.guild, game.away_team_role_id);
      const payoutLines = [];

      if (Number(settings.game_played_payout) > 0) {
        const paidOwners = new Set();

        for (const owner of [homeOwner, awayOwner]) {
          if (owner && !paidOwners.has(owner.id)) {
            paidOwners.add(owner.id);
            await addCurrency(
              interaction.guild.id,
              owner.id,
              Number(settings.game_played_payout),
              'game_played',
              `Game played: ${game.away_team_name} @ ${game.home_team_name}`,
              interaction.user.id
            );
            payoutLines.push(`${settings.currency_icon} <@${owner.id}> earned **${settings.game_played_payout} ${settings.currency_name}** for playing.`);
          }
        }
      }

      if (winnerOwner && Number(settings.win_payout) > 0) {
        await addCurrency(
          interaction.guild.id,
          winnerOwner.id,
          Number(settings.win_payout),
          'game_win',
          `Game win: ${winnerName}`,
          interaction.user.id
        );
        payoutLines.push(`${settings.currency_icon} <@${winnerOwner.id}> earned **${settings.win_payout} ${settings.currency_name}** win bonus.`);
      }

      const payoutText = payoutLines.length ? `${String.fromCharCode(10)}${payoutLines.join(String.fromCharCode(10))}` : '';

      await interaction.reply({ content: `Final recorded: **${game.away_team_name} ${awayScore} @ ${game.home_team_name} ${homeScore}**. Winner: **${winnerName}**${payoutText}`, ephemeral: true });
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

    if (interaction.commandName === 'setcurrency') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to configure server currency.', ephemeral: true });
        return;
      }

      const name = interaction.options.getString('name');
      const icon = interaction.options.getString('icon') || '🪙';
      const winPayout = interaction.options.getInteger('win_payout') ?? 100;
      const gamePlayedPayout = interaction.options.getInteger('game_played_payout') ?? 25;

      if (winPayout < 0 || gamePlayedPayout < 0) {
        await interaction.reply({ content: 'Payout amounts cannot be negative.', ephemeral: true });
        return;
      }

      await pool.query(
        `INSERT INTO guild_currency_settings (guild_id, currency_name, currency_icon, win_payout, game_played_payout, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (guild_id)
         DO UPDATE SET currency_name = $2, currency_icon = $3, win_payout = $4, game_played_payout = $5, updated_at = NOW()`,
        [interaction.guild.id, name, icon, winPayout, gamePlayedPayout]
      );

      await interaction.reply({ content: `Server currency set to **${icon} ${name}**. Win bonus: **${winPayout}**. Game played payout: **${gamePlayedPayout}**.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'balance') {
      if (!interaction.guild) return;
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const settings = await getCurrencySettings(interaction.guild.id);
      const balanceRow = await getBalance(interaction.guild.id, targetUser.id);
      await interaction.reply({ embeds: [buildBalanceEmbed(settings, targetUser, balanceRow)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'transfer') {
      if (!interaction.guild) return;
      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const reason = interaction.options.getString('reason') || 'User transfer';
      const settings = await getCurrencySettings(interaction.guild.id);

      if (targetUser.bot || targetUser.id === interaction.user.id) {
        await interaction.reply({ content: 'You cannot transfer currency to yourself or a bot.', ephemeral: true });
        return;
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        await interaction.reply({ content: 'Transfer amount must be greater than 0.', ephemeral: true });
        return;
      }

      const removed = await removeCurrency(interaction.guild.id, interaction.user.id, amount, 'transfer_out', reason, interaction.user.id);
      if (!removed) {
        await interaction.reply({ content: `You do not have enough ${settings.currency_name}.`, ephemeral: true });
        return;
      }

      await addCurrency(interaction.guild.id, targetUser.id, amount, 'transfer_in', reason, interaction.user.id);
      await interaction.reply({ content: `Transferred **${settings.currency_icon} ${amount} ${settings.currency_name}** to ${targetUser}.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'givecurrency' || interaction.commandName === 'takecurrency') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to use bank controls.', ephemeral: true });
        return;
      }

      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const reason = interaction.options.getString('reason') || 'Admin bank adjustment';
      const settings = await getCurrencySettings(interaction.guild.id);

      if (targetUser.bot) {
        await interaction.reply({ content: 'You cannot adjust currency for bots.', ephemeral: true });
        return;
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        await interaction.reply({ content: 'Amount must be greater than 0.', ephemeral: true });
        return;
      }

      if (interaction.commandName === 'givecurrency') {
        await addCurrency(interaction.guild.id, targetUser.id, amount, 'admin_give', reason, interaction.user.id);
        await interaction.reply({ content: `Gave **${settings.currency_icon} ${amount} ${settings.currency_name}** to ${targetUser}.`, ephemeral: true });
        return;
      }

      const removed = await removeCurrency(interaction.guild.id, targetUser.id, amount, 'admin_take', reason, interaction.user.id);
      if (!removed) {
        await interaction.reply({ content: `${targetUser} does not have enough ${settings.currency_name}.`, ephemeral: true });
        return;
      }

      await interaction.reply({ content: `Removed **${settings.currency_icon} ${amount} ${settings.currency_name}** from ${targetUser}.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'createshopitem') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to create shop items.', ephemeral: true });
        return;
      }

      const name = interaction.options.getString('name');
      const price = interaction.options.getInteger('price');
      const description = interaction.options.getString('description');
      const stock = interaction.options.getInteger('stock');

      if (!Number.isInteger(price) || price <= 0) {
        await interaction.reply({ content: 'Price must be greater than 0.', ephemeral: true });
        return;
      }

      if (stock !== null && stock < 0) {
        await interaction.reply({ content: 'Stock cannot be negative.', ephemeral: true });
        return;
      }

      const itemId = randomUUID();
      await pool.query(
        `INSERT INTO shop_items (id, guild_id, item_name, description, price, stock, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [itemId, interaction.guild.id, name, description, price, stock, interaction.user.id]
      );

      const settings = await getCurrencySettings(interaction.guild.id);
      await interaction.reply({ content: `Shop item created: **${shortItemId(itemId)} • ${name}** for **${settings.currency_icon} ${price} ${settings.currency_name}**.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'shop') {
      if (!interaction.guild) return;
      const settings = await getCurrencySettings(interaction.guild.id);
      const result = await pool.query(
        `SELECT * FROM shop_items WHERE guild_id = $1 AND is_active = TRUE ORDER BY created_at DESC LIMIT 25`,
        [interaction.guild.id]
      );
      await interaction.reply({ embeds: [buildShopEmbed(settings, result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'buy') {
      if (!interaction.guild) return;
      const itemInput = interaction.options.getString('item');
      const item = await findShopItem(interaction.guild.id, itemInput);
      const settings = await getCurrencySettings(interaction.guild.id);

      if (!item) {
        await interaction.reply({ content: 'Could not find that active shop item. Use /shop to see item IDs and names.', ephemeral: true });
        return;
      }

      if (item.stock !== null && Number(item.stock) <= 0) {
        await interaction.reply({ content: 'That item is out of stock.', ephemeral: true });
        return;
      }

      const removed = await removeCurrency(interaction.guild.id, interaction.user.id, Number(item.price), 'shop_purchase', `Purchased ${item.item_name}`, interaction.user.id);
      if (!removed) {
        await interaction.reply({ content: `You do not have enough ${settings.currency_name} to buy **${item.item_name}**.`, ephemeral: true });
        return;
      }

      await pool.query(
        `INSERT INTO user_inventory (id, guild_id, user_id, item_id, item_name, price_paid)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), interaction.guild.id, interaction.user.id, item.id, item.item_name, item.price]
      );

      if (item.stock !== null) {
        await pool.query(
          `UPDATE shop_items SET stock = GREATEST(stock - 1, 0), updated_at = NOW() WHERE id = $1`,
          [item.id]
        );
      }

      await interaction.reply({ content: `Purchased **${item.item_name}** for **${settings.currency_icon} ${item.price} ${settings.currency_name}**.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'inventory') {
      if (!interaction.guild) return;
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const settings = await getCurrencySettings(interaction.guild.id);
      const result = await pool.query(
        `SELECT * FROM user_inventory WHERE guild_id = $1 AND user_id = $2 ORDER BY purchased_at DESC LIMIT 25`,
        [interaction.guild.id, targetUser.id]
      );
      await interaction.reply({ embeds: [buildInventoryEmbed(settings, targetUser, result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'removeshopitem') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to remove shop items.', ephemeral: true });
        return;
      }
      const itemInput = interaction.options.getString('item');
      const item = await findShopItem(interaction.guild.id, itemInput);
      if (!item) {
        await interaction.reply({ content: 'Could not find that active shop item.', ephemeral: true });
        return;
      }
      await pool.query(`UPDATE shop_items SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [item.id]);
      await interaction.reply({ content: `Removed shop item **${item.item_name}**.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'useitem') {
      if (!interaction.guild) return;
      const itemInput = interaction.options.getString('item');
      const note = interaction.options.getString('note');
      const item = await findInventoryItem(interaction.guild.id, interaction.user.id, itemInput);

      if (!item) {
        await interaction.reply({ content: 'Could not find that item in your inventory. Use /inventory to see item IDs.', ephemeral: true });
        return;
      }

      if (item.status === 'requested') {
        await interaction.reply({ content: 'That item is already marked as requested.', ephemeral: true });
        return;
      }

      if (item.status === 'redeemed' || item.status === 'used') {
        await interaction.reply({ content: `That item has already been marked as ${item.status}.`, ephemeral: true });
        return;
      }

      await pool.query(
        `UPDATE user_inventory
         SET status = 'requested', request_note = $1, updated_at = NOW()
         WHERE id = $2`,
        [note || null, item.id]
      );

      await interaction.reply({ content: `Redemption requested for **${item.item_name}**. Staff can fulfill it with /redeemitem.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'redeemitem') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to redeem shop items.', ephemeral: true });
        return;
      }

      const targetUser = interaction.options.getUser('user');
      const itemInput = interaction.options.getString('item');
      const status = interaction.options.getString('status') || 'redeemed';
      const note = interaction.options.getString('note');

      const allowedStatuses = ['owned', 'requested', 'redeemed', 'used'];
      if (!allowedStatuses.includes(status)) {
        await interaction.reply({ content: 'Status must be one of: owned, requested, redeemed, used.', ephemeral: true });
        return;
      }

      const item = await findInventoryItem(interaction.guild.id, targetUser.id, itemInput);
      if (!item) {
        await interaction.reply({ content: 'Could not find that item in the user inventory.', ephemeral: true });
        return;
      }

      await pool.query(
        `UPDATE user_inventory
         SET status = $1,
             fulfillment_note = $2,
             fulfilled_by_user_id = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [status, note || null, interaction.user.id, item.id]
      );

      await interaction.reply({ content: `Inventory item **${item.item_name}** for ${targetUser} marked as **${status}**.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'settournamentchannel') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to set the server tournament channel.', ephemeral: true });
        return;
      }

      const channel = interaction.options.getChannel('channel');
      const botMember = await interaction.guild.members.fetchMe();
      const permissions = channel?.permissionsFor(botMember);

      if (!channel || !channel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
        await interaction.reply({ content: 'I need View Channel, Send Messages, and Embed Links permissions in that tournament channel.', ephemeral: true });
        return;
      }

      await pool.query(
        `INSERT INTO guild_tournament_settings (guild_id, tournament_channel_id, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (guild_id)
         DO UPDATE SET tournament_channel_id = $2, updated_at = NOW()`,
        [interaction.guild.id, channel.id]
      );

      await interaction.reply({ content: `Default server tournament channel set to ${channel}.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'createtournament') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to create tournaments.', ephemeral: true });
        return;
      }

      const name = interaction.options.getString('name');
      const game = interaction.options.getString('game');
      const format = interaction.options.getString('format') || 'single_elim';
      const maxEntries = interaction.options.getInteger('max_entries');
      const buyIn = interaction.options.getInteger('buy_in') ?? 0;
      const prize = interaction.options.getString('prize');
      const startsAt = interaction.options.getString('date');
      const leagueName = interaction.options.getString('league');
      const activeLeague = leagueName ? await getLeagueByName(interaction.guild.id, leagueName) : null;

      const allowedFormats = ['single_elim', 'double_elim', 'round_robin'];
      if (!allowedFormats.includes(format)) {
        await interaction.reply({ content: 'Format must be one of: single_elim, double_elim, round_robin.', ephemeral: true });
        return;
      }

      if (maxEntries !== null && maxEntries <= 0) {
        await interaction.reply({ content: 'Max entries must be greater than 0.', ephemeral: true });
        return;
      }

      if (buyIn < 0) {
        await interaction.reply({ content: 'Buy-in cannot be negative.', ephemeral: true });
        return;
      }

      if (leagueName && !activeLeague) {
        await interaction.reply({ content: `Could not find league **${leagueName}**.`, ephemeral: true });
        return;
      }

      const tournamentId = randomUUID();
      await pool.query(
        `INSERT INTO tournaments (id, guild_id, league_id, tournament_name, game, format, max_entries, buy_in, prize, starts_at, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [tournamentId, interaction.guild.id, activeLeague?.league_id || null, name, game, format, maxEntries, buyIn, prize, startsAt, interaction.user.id]
      );

      await interaction.reply({ content: `Tournament created: **${shortTournamentId(tournamentId)} • ${name}**. Members can join with /jointournament.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'tournaments') {
      if (!interaction.guild) return;
      const settings = await getCurrencySettings(interaction.guild.id);
      const result = await pool.query(
        `SELECT t.*, l.league_name, COUNT(e.user_id)::int AS entry_count
         FROM tournaments t
         LEFT JOIN leagues l ON l.league_id = t.league_id
         LEFT JOIN tournament_entries e ON e.tournament_id = t.id
         WHERE t.guild_id = $1 AND t.status IN ('open', 'active')
         GROUP BY t.id, l.league_name
         ORDER BY t.created_at DESC
         LIMIT 15`,
        [interaction.guild.id]
      );
      await interaction.reply({ embeds: [buildTournamentsEmbed(settings, result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'tournamentinfo') {
      if (!interaction.guild) return;
      const input = interaction.options.getString('tournament');
      const tournament = await findTournament(interaction.guild.id, input);
      if (!tournament) {
        await interaction.reply({ content: 'Could not find that tournament. Use /tournaments to see active tournament IDs.', ephemeral: true });
        return;
      }
      const settings = await getCurrencySettings(interaction.guild.id);
      const entries = await getTournamentEntries(tournament.id);
      await interaction.reply({ embeds: [buildTournamentInfoEmbed(settings, tournament, entries)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'jointournament') {
      if (!interaction.guild) return;
      const input = interaction.options.getString('tournament');
      const entryName = interaction.options.getString('entry_name');
      const tournament = await findTournament(interaction.guild.id, input);
      const settings = await getCurrencySettings(interaction.guild.id);

      if (!tournament) {
        await interaction.reply({ content: 'Could not find that tournament. Use /tournaments to see active tournament IDs.', ephemeral: true });
        return;
      }

      if (tournament.status !== 'open') {
        await interaction.reply({ content: 'That tournament is not open for registration.', ephemeral: true });
        return;
      }

      const entries = await getTournamentEntries(tournament.id);
      if (tournament.max_entries && entries.length >= Number(tournament.max_entries)) {
        await interaction.reply({ content: 'That tournament is full.', ephemeral: true });
        return;
      }

      const existingEntry = entries.find(entry => entry.user_id === interaction.user.id);
      if (existingEntry) {
        await interaction.reply({ content: 'You are already registered for that tournament.', ephemeral: true });
        return;
      }

      const buyIn = Number(tournament.buy_in || 0);
      if (buyIn > 0) {
        const removed = await removeCurrency(interaction.guild.id, interaction.user.id, buyIn, 'tournament_buy_in', `Buy-in: ${tournament.tournament_name}`, interaction.user.id);
        if (!removed) {
          await interaction.reply({ content: `You need **${settings.currency_icon} ${buyIn} ${settings.currency_name}** to join this tournament.`, ephemeral: true });
          return;
        }
      }

      await pool.query(
        `INSERT INTO tournament_entries (tournament_id, guild_id, user_id, entry_name, paid_buy_in)
         VALUES ($1, $2, $3, $4, $5)`,
        [tournament.id, interaction.guild.id, interaction.user.id, entryName, buyIn]
      );

      if (buyIn > 0) {
        await pool.query(`UPDATE tournaments SET prize_pool = prize_pool + $1, updated_at = NOW() WHERE id = $2`, [buyIn, tournament.id]);
      }

      await interaction.reply({ content: `You joined **${tournament.tournament_name}**${buyIn > 0 ? ` for **${settings.currency_icon} ${buyIn} ${settings.currency_name}**` : ''}.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'closetournament') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to close tournaments.', ephemeral: true });
        return;
      }
      const input = interaction.options.getString('tournament');
      const tournament = await findTournament(interaction.guild.id, input);
      if (!tournament) {
        await interaction.reply({ content: 'Could not find that tournament.', ephemeral: true });
        return;
      }
      await pool.query(`UPDATE tournaments SET status = 'closed', updated_at = NOW() WHERE id = $1`, [tournament.id]);
      await interaction.reply({ content: `Registration closed for **${tournament.tournament_name}**.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'announcetournament') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to announce tournaments.', ephemeral: true });
        return;
      }

      const input = interaction.options.getString('tournament');
      const tournament = await findTournament(interaction.guild.id, input);
      const channelOption = interaction.options.getChannel('channel');

      if (!tournament) {
        await interaction.reply({ content: 'Could not find that tournament.', ephemeral: true });
        return;
      }

      let channel = channelOption || null;
      if (!channel) {
        const guildTournamentChannelId = await getGuildTournamentChannelId(interaction.guild.id);
        if (guildTournamentChannelId) channel = await interaction.guild.channels.fetch(guildTournamentChannelId).catch(() => null);
      }
      if (!channel) channel = interaction.channel;

      const botMember = await interaction.guild.members.fetchMe();
      const permissions = channel?.permissionsFor(botMember);
      if (!channel || !channel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
        await interaction.reply({ content: 'I cannot post in that announcement channel. Check permissions.', ephemeral: true });
        return;
      }

      const settings = await getCurrencySettings(interaction.guild.id);
      const entries = await getTournamentEntries(tournament.id);
      const message = await channel.send({
        embeds: [buildTournamentAnnouncementEmbed(settings, tournament, entries)],
        components: [buildTournamentJoinButton(tournament.id, tournament.max_entries && entries.length >= Number(tournament.max_entries))],
      });

      await pool.query(
        `INSERT INTO tournament_panels (tournament_id, guild_id, channel_id, message_id, announcement_channel_id, announcement_message_id, updated_at)
         VALUES ($1, $2, $3, $4, $3, $4, NOW())
         ON CONFLICT (tournament_id)
         DO UPDATE SET announcement_channel_id = $3, announcement_message_id = $4, updated_at = NOW()`,
        [tournament.id, interaction.guild.id, channel.id, message.id]
      );

      await interaction.reply({ content: `Tournament announcement posted for **${tournament.tournament_name}** in ${channel}.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'tournamenthistory') {
      if (!interaction.guild) return;
      const requestedLeagueName = interaction.options.getString('league');
      let activeLeague = null;
      if (requestedLeagueName) {
        activeLeague = await getLeagueByName(interaction.guild.id, requestedLeagueName);
        if (!activeLeague) {
          await interaction.reply({ content: `Could not find league **${requestedLeagueName}**.`, ephemeral: true });
          return;
        }
      }

      const result = activeLeague
        ? await pool.query(
            `SELECT * FROM tournament_history WHERE guild_id = $1 AND league_id = $2 ORDER BY completed_at DESC LIMIT 20`,
            [interaction.guild.id, activeLeague.league_id]
          )
        : await pool.query(
            `SELECT * FROM tournament_history WHERE guild_id = $1 ORDER BY completed_at DESC LIMIT 20`,
            [interaction.guild.id]
          );

      await interaction.reply({ embeds: [buildTournamentHistoryEmbed(result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'settournamentmvp') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to set tournament MVPs.', ephemeral: true });
        return;
      }

      const input = interaction.options.getString('tournament');
      const mvpUser = interaction.options.getUser('user');
      const payout = interaction.options.getInteger('payout') ?? 0;
      const tournament = await findTournament(interaction.guild.id, input);

      if (!tournament) {
        await interaction.reply({ content: 'Could not find that tournament.', ephemeral: true });
        return;
      }

      if (payout < 0) {
        await interaction.reply({ content: 'MVP payout cannot be negative.', ephemeral: true });
        return;
      }

      const historyResult = await pool.query(
        `SELECT * FROM tournament_history WHERE guild_id = $1 AND tournament_id = $2 ORDER BY completed_at DESC LIMIT 1`,
        [interaction.guild.id, tournament.id]
      );

      if (!historyResult.rows.length) {
        await interaction.reply({ content: 'This tournament has not been completed yet, so an MVP cannot be recorded.', ephemeral: true });
        return;
      }

      await pool.query(
        `UPDATE tournament_history SET mvp_user_id = $1, mvp_payout = $2 WHERE id = $3`,
        [mvpUser.id, payout, historyResult.rows[0].id]
      );

      if (payout > 0) {
        await addCurrency(interaction.guild.id, mvpUser.id, payout, 'tournament_mvp', `Tournament MVP: ${tournament.tournament_name}`, interaction.user.id);
      }

      await interaction.reply({ content: `${mvpUser} set as MVP for **${tournament.tournament_name}**${payout > 0 ? ` and awarded **${payout}** currency.` : '.'}`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'tournamentrewards') {
      if (!interaction.guild) return;
      const requestedLeagueName = interaction.options.getString('league');
      let activeLeague = null;
      if (requestedLeagueName) {
        activeLeague = await getLeagueByName(interaction.guild.id, requestedLeagueName);
        if (!activeLeague) {
          await interaction.reply({ content: `Could not find league **${requestedLeagueName}**.`, ephemeral: true });
          return;
        }
      }

      const settings = await getCurrencySettings(interaction.guild.id);
      const result = activeLeague
        ? await pool.query(
            `SELECT * FROM tournament_history WHERE guild_id = $1 AND league_id = $2 ORDER BY completed_at DESC LIMIT 20`,
            [interaction.guild.id, activeLeague.league_id]
          )
        : await pool.query(
            `SELECT * FROM tournament_history WHERE guild_id = $1 ORDER BY completed_at DESC LIMIT 20`,
            [interaction.guild.id]
          );

      await interaction.reply({ embeds: [buildTournamentRewardsEmbed(settings, result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'tournamentseeds') {
      if (!interaction.guild) return;
      const input = interaction.options.getString('tournament');
      const tournament = await findTournament(interaction.guild.id, input);
      if (!tournament) {
        await interaction.reply({ content: 'Could not find that tournament.', ephemeral: true });
        return;
      }

      const entries = await getTournamentEntries(tournament.id);
      const NL = String.fromCharCode(10);
      const seedText = entries.length
        ? entries.map((entry, index) => `**${entry.seed || index + 1}.** <@${entry.user_id}>${entry.entry_name ? ` — ${entry.entry_name}` : ''}`).join(NL)
        : 'No entries yet.';

      const embed = new EmbedBuilder()
        .setTitle(`${tournament.tournament_name} • Seeds`)
        .setColor(0xED4245)
        .setDescription(seedText)
        .setFooter({ text: 'GG Sports • Tournament Seeding' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'shuffletournament') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to seed tournaments.', ephemeral: true });
        return;
      }

      const input = interaction.options.getString('tournament');
      const tournament = await findTournament(interaction.guild.id, input);
      if (!tournament) {
        await interaction.reply({ content: 'Could not find that tournament.', ephemeral: true });
        return;
      }

      if (!['open', 'closed'].includes(tournament.status)) {
        await interaction.reply({ content: 'You can only shuffle seeds before a tournament starts.', ephemeral: true });
        return;
      }

      const matches = await getTournamentMatches(tournament.id);
      if (matches.length > 0) {
        await interaction.reply({ content: 'This tournament already has matches generated, so seeds can no longer be changed.', ephemeral: true });
        return;
      }

      const entries = await getTournamentEntries(tournament.id);
      if (entries.length < 2) {
        await interaction.reply({ content: 'Need at least 2 entries to seed a tournament.', ephemeral: true });
        return;
      }

      const shuffled = [...entries].sort(() => Math.random() - 0.5);
      for (let i = 0; i < shuffled.length; i++) {
        await pool.query(
          `UPDATE tournament_entries SET seed = $1 WHERE tournament_id = $2 AND user_id = $3`,
          [i + 1, tournament.id, shuffled[i].user_id]
        );
      }

      await interaction.reply({ content: `Random seeds assigned for **${tournament.tournament_name}**. Use /tournamentseeds to review.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'settournamentseed') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to seed tournaments.', ephemeral: true });
        return;
      }

      const input = interaction.options.getString('tournament');
      const targetUser = interaction.options.getUser('user');
      const seed = interaction.options.getInteger('seed');
      const tournament = await findTournament(interaction.guild.id, input);

      if (!tournament) {
        await interaction.reply({ content: 'Could not find that tournament.', ephemeral: true });
        return;
      }

      if (!['open', 'closed'].includes(tournament.status)) {
        await interaction.reply({ content: 'You can only set seeds before a tournament starts.', ephemeral: true });
        return;
      }

      const matches = await getTournamentMatches(tournament.id);
      if (matches.length > 0) {
        await interaction.reply({ content: 'This tournament already has matches generated, so seeds can no longer be changed.', ephemeral: true });
        return;
      }

      if (seed <= 0) {
        await interaction.reply({ content: 'Seed must be greater than 0.', ephemeral: true });
        return;
      }

      const entries = await getTournamentEntries(tournament.id);
      const targetEntry = entries.find(entry => entry.user_id === targetUser.id);
      if (!targetEntry) {
        await interaction.reply({ content: 'That user is not entered in this tournament.', ephemeral: true });
        return;
      }

      const existingSeed = entries.find(entry => entry.seed === seed && entry.user_id !== targetUser.id);
      if (existingSeed) {
        await pool.query(
          `UPDATE tournament_entries SET seed = NULL WHERE tournament_id = $1 AND user_id = $2`,
          [tournament.id, existingSeed.user_id]
        );
      }

      await pool.query(
        `UPDATE tournament_entries SET seed = $1 WHERE tournament_id = $2 AND user_id = $3`,
        [seed, tournament.id, targetUser.id]
      );

      await interaction.reply({ content: `${targetUser} is now seed **${seed}** for **${tournament.tournament_name}**.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'starttournament') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to start tournaments.', ephemeral: true });
        return;
      }

      const input = interaction.options.getString('tournament');
      const tournament = await findTournament(interaction.guild.id, input);
      if (!tournament) {
        await interaction.reply({ content: 'Could not find that tournament.', ephemeral: true });
        return;
      }

      if (tournament.format !== 'single_elim') {
        await interaction.reply({ content: 'Bracket generation currently supports single_elim first. Other formats will be added next.', ephemeral: true });
        return;
      }

      if (!['open', 'closed'].includes(tournament.status)) {
        await interaction.reply({ content: 'That tournament has already been started or completed.', ephemeral: true });
        return;
      }

      const existingMatches = await getTournamentMatches(tournament.id);
      if (existingMatches.length > 0) {
        await interaction.reply({ content: 'This tournament already has generated matches.', ephemeral: true });
        return;
      }

      const entries = await getTournamentEntries(tournament.id);
      if (entries.length < 2) {
        await interaction.reply({ content: 'A tournament needs at least 2 entries to start.', ephemeral: true });
        return;
      }

      await createTournamentRound(tournament, entries, 1);
      await pool.query(`UPDATE tournaments SET status = 'active', updated_at = NOW() WHERE id = $1`, [tournament.id]);

      const matches = await getTournamentMatches(tournament.id);
      await createMatchThreads(interaction.guild, { ...tournament, status: 'active' }, matches);
      await updateTournamentPanel(interaction.guild, { ...tournament, status: 'active' });
      await interaction.reply({ embeds: [buildTournamentMatchesEmbed({ ...tournament, status: 'active' }, matches)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'tournamentmatches') {
      if (!interaction.guild) return;
      const input = interaction.options.getString('tournament');
      const tournament = await findTournament(interaction.guild.id, input);
      if (!tournament) {
        await interaction.reply({ content: 'Could not find that tournament.', ephemeral: true });
        return;
      }
      const matches = await getTournamentMatches(tournament.id);
      await interaction.reply({ embeds: [buildTournamentMatchesEmbed(tournament, matches)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'setuptournamentpanel') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to set up tournament panels.', ephemeral: true });
        return;
      }

      const input = interaction.options.getString('tournament');
      const tournament = await findTournament(interaction.guild.id, input);
      if (!tournament) {
        await interaction.reply({ content: 'Could not find that tournament.', ephemeral: true });
        return;
      }

      let channel = null;
      if (tournament.league_id) {
        const activeLeague = await getLeagueById(tournament.league_id);
        if (activeLeague?.tournament_channel_id) {
          channel = await interaction.guild.channels.fetch(activeLeague.tournament_channel_id).catch(() => null);
        }
      }

      if (!channel) {
        const guildTournamentChannelId = await getGuildTournamentChannelId(interaction.guild.id);
        if (guildTournamentChannelId) {
          channel = await interaction.guild.channels.fetch(guildTournamentChannelId).catch(() => null);
        }
      }

      if (!channel) {
        channel = interaction.channel;
      }

      const botMember = await interaction.guild.members.fetchMe();
      const permissions = channel?.permissionsFor(botMember);
      if (!channel || !channel.isTextBased() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
        await interaction.reply({ content: 'I cannot post in the selected tournament channel. Check my permissions.', ephemeral: true });
        return;
      }

      const matches = await getTournamentMatches(tournament.id);
      const message = await channel.send({ embeds: [buildTournamentPanelEmbed(tournament, matches)] });
      await saveTournamentPanel(tournament.id, interaction.guild.id, channel.id, message.id);

      await interaction.reply({ content: `Tournament panel created for **${tournament.tournament_name}** in ${channel}.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'reportmatch') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to report tournament matches.', ephemeral: true });
        return;
      }

      const matchInput = interaction.options.getString('match_id');
      const winner = interaction.options.getUser('winner');
      const match = await findTournamentMatch(interaction.guild.id, matchInput);

      if (!match) {
        await interaction.reply({ content: 'Could not find that match ID. Use /tournamentmatches.', ephemeral: true });
        return;
      }

      if (match.status === 'final') {
        await interaction.reply({ content: 'That match is already final.', ephemeral: true });
        return;
      }

      const validWinner = winner.id === match.player1_user_id || winner.id === match.player2_user_id;
      if (!validWinner) {
        await interaction.reply({ content: 'Winner must be one of the two users in that match.', ephemeral: true });
        return;
      }

      const result = await finalizeTournamentMatch(interaction.guild, match, winner.id, interaction.user.id);
      await interaction.reply({ content: result.message, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'economy') {
      if (!interaction.guild) return;
      const settings = await getCurrencySettings(interaction.guild.id);
      const totalResult = await pool.query(
        `SELECT COALESCE(SUM(balance), 0)::int AS total_balance, COUNT(*)::int AS users_with_balance
         FROM guild_currency_balances
         WHERE guild_id = $1 AND balance > 0`,
        [interaction.guild.id]
      );
      const txResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM currency_transactions WHERE guild_id = $1`,
        [interaction.guild.id]
      );
      const shopResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM shop_items WHERE guild_id = $1 AND is_active = TRUE`,
        [interaction.guild.id]
      );
      await interaction.reply({
        embeds: [buildEconomyEmbed(settings, {
          totalBalance: totalResult.rows[0]?.total_balance || 0,
          usersWithBalance: totalResult.rows[0]?.users_with_balance || 0,
          transactionCount: txResult.rows[0]?.count || 0,
          activeShopItems: shopResult.rows[0]?.count || 0,
        })],
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'richest') {
      if (!interaction.guild) return;
      const settings = await getCurrencySettings(interaction.guild.id);
      const result = await pool.query(
        `SELECT user_id, balance
         FROM guild_currency_balances
         WHERE guild_id = $1 AND balance > 0
         ORDER BY balance DESC, lifetime_earned DESC
         LIMIT 10`,
        [interaction.guild.id]
      );
      await interaction.reply({ embeds: [buildRichestEmbed(settings, result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'transactions') {
      if (!interaction.guild) return;
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const settings = await getCurrencySettings(interaction.guild.id);
      const result = await pool.query(
        `SELECT * FROM currency_transactions
         WHERE guild_id = $1 AND user_id = $2
         ORDER BY created_at DESC
         LIMIT 15`,
        [interaction.guild.id, targetUser.id]
      );
      await interaction.reply({ embeds: [buildTransactionsEmbed(settings, `${targetUser.username}'s Transactions`, result.rows)], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'banklog') {
      if (!interaction.guild) return;
      if (!(await userCanUseLeagueSetup(interaction, league))) {
        await interaction.reply({ content: 'You do not have permission to view the bank log.', ephemeral: true });
        return;
      }
      const settings = await getCurrencySettings(interaction.guild.id);
      const result = await pool.query(
        `SELECT * FROM currency_transactions
         WHERE guild_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [interaction.guild.id]
      );
      await interaction.reply({ embeds: [buildTransactionsEmbed(settings, 'Server Bank Log', result.rows)], ephemeral: true });
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
      let tournamentWins = 0;
      let tournamentMvps = 0;
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

      const tournamentWinsResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM tournament_history WHERE guild_id = $1 AND champion_user_id = $2`,
        [interaction.guild.id, targetUser.id]
      );
      tournamentWins = tournamentWinsResult.rows[0]?.count || 0;

      const tournamentMvpResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM tournament_history WHERE guild_id = $1 AND mvp_user_id = $2`,
        [interaction.guild.id, targetUser.id]
      );
      tournamentMvps = tournamentMvpResult.rows[0]?.count || 0;

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
          tournamentWins,
          tournamentMvps,
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

// =========================
// PHASE 5A - TICKET SYSTEM
// =========================

const ACTIVE_TICKET_TYPES = ['support', 'dispute', 'gamerequest'];

async function createTicketRecord({ guildId, leagueId, userId, ticketType, subject, description, channelId, threadId }) {
  const id = randomUUID();

  await pool.query(
    `INSERT INTO support_tickets (
      id,
      guild_id,
      league_id,
      user_id,
      ticket_type,
      subject,
      description,
      channel_id,
      thread_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      guildId,
      leagueId,
      userId,
      ticketType,
      subject,
      description || null,
      channelId || null,
      threadId || null
    ]
  );

  return id;
}

async function closeTicketRecord(threadId, closedByUserId) {
  await pool.query(
    `UPDATE support_tickets
     SET status = 'closed',
         closed_by_user_id = $1,
         closed_at = NOW()
     WHERE thread_id = $2`,
    [closedByUserId, threadId]
  );
}

function buildTicketEmbed({ type, subject, description, creator }) {
  return new EmbedBuilder()
    .setColor(0xffcc00)
    .setTitle(`🎫 ${type.toUpperCase()} TICKET`)
    .addFields(
      { name: 'Subject', value: subject },
      { name: 'Opened By', value: `<@${creator.id}>` }
    )
    .setDescription(description || 'No additional description provided.')
    .setFooter({ text: 'GG Sports Ticket System' })
    .setTimestamp();
}

function buildTicketReviewButtons(ticketId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_review_approve:' + ticketId)
      .setLabel('Approve Request')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('ticket_review_deny:' + ticketId)
      .setLabel('Deny Request')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function shortTicketId(ticketId) {
  return String(ticketId || '').split('-')[0];
}

function buildTicketsEmbed(rows, status) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle('Tickets • ' + status)
    .setColor(0xffcc00)
    .setFooter({ text: 'GG Sports • Ticket Log' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No tickets found.');
    return embed;
  }

  const lines = rows.map(row => {
    const assigned = row.assigned_staff_user_id ? ' • Claimed by <@' + row.assigned_staff_user_id + '>' : '';
    const thread = row.thread_id ? ' • <#' + row.thread_id + '>' : '';
    return '**' + shortTicketId(row.id) + '** — ' + row.ticket_type + ' • ' + row.subject + ' • ' + (row.priority || 'normal') + assigned + thread;
  });

  embed.setDescription(lines.join(NL));
  return embed;
}

function buildTicketInfoEmbed(row) {
  const embed = new EmbedBuilder()
    .setTitle('Ticket ' + shortTicketId(row.id) + ' • ' + row.ticket_type)
    .setColor(row.status === 'open' ? 0xffcc00 : 0x57f287)
    .addFields(
      { name: 'Status', value: row.status || 'unknown', inline: true },
      { name: 'Priority', value: row.priority || 'normal', inline: true },
      { name: 'Opened By', value: '<@' + row.user_id + '>', inline: true },
      { name: 'Claimed By', value: row.assigned_staff_user_id ? '<@' + row.assigned_staff_user_id + '>' : 'Unclaimed', inline: true },
      { name: 'Subject', value: row.subject || 'No subject', inline: false },
      { name: 'Description', value: row.description || 'No description', inline: false },
      { name: 'Thread', value: row.thread_id ? '<#' + row.thread_id + '>' : 'No thread saved', inline: false }
    )
    .setFooter({ text: 'GG Sports • Ticket Info' })
    .setTimestamp();

  if (row.closed_by_user_id) {
    embed.addFields({ name: 'Closed By', value: '<@' + row.closed_by_user_id + '>', inline: true });
  }

  return embed;
}

function buildTicketEvidenceEmbed(ticket, rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle('Ticket Evidence • ' + shortTicketId(ticket.id))
    .setColor(0x5865F2)
    .setFooter({ text: 'GG Sports • Ticket Evidence' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No evidence has been uploaded to this ticket yet.');
    return embed;
  }

  const lines = rows.map((row, index) => {
    const date = row.created_at ? new Date(row.created_at).toLocaleDateString('en-US') : 'Unknown date';
    const fileName = row.file_name || 'Attachment';
    return '**' + (index + 1) + '. ' + fileName + '** — uploaded by <@' + row.user_id + '> • ' + date + NL + row.attachment_url;
  });

  embed.setDescription(lines.join(NL + NL).slice(0, 4000));
  return embed;
}

async function getOpenTicketByThread(guildId, threadId) {
  const result = await pool.query(
    `SELECT * FROM support_tickets WHERE guild_id = $1 AND thread_id = $2 AND status = 'open' LIMIT 1`,
    [guildId, threadId]
  );
  return result.rows[0] || null;
}

async function saveTicketEvidence({ ticketId, guildId, userId, attachmentUrl, fileName, contentType, messageId }) {
  await pool.query(
    `INSERT INTO ticket_evidence (id, ticket_id, guild_id, user_id, attachment_url, file_name, content_type, message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), ticketId, guildId, userId, attachmentUrl, fileName || null, contentType || null, messageId || null]
  );
}

async function saveTicketTranscript(thread, ticket) {
  const messages = await thread.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return;

  const ordered = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  for (const msg of ordered) {
    if (msg.author?.bot && !msg.content && msg.attachments.size === 0) continue;
    const attachmentUrls = msg.attachments.size > 0 ? [...msg.attachments.values()].map(a => a.url).join(String.fromCharCode(10)) : null;
    await pool.query(
      `INSERT INTO ticket_transcripts (id, ticket_id, guild_id, message_author_id, message_author_tag, message_content, attachment_urls, message_created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))`,
      [
        randomUUID(),
        ticket.id,
        ticket.guild_id,
        msg.author?.id || null,
        msg.author?.tag || null,
        msg.content || null,
        attachmentUrls,
        msg.createdTimestamp,
      ]
    );
  }
}

function buildTicketTranscriptEmbed(ticket, rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle('Ticket Transcript • ' + shortTicketId(ticket.id))
    .setColor(0x57f287)
    .setFooter({ text: 'GG Sports • Ticket Transcript' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No transcript messages were saved for this ticket.');
    return embed;
  }

  const lines = rows.map(row => {
    const author = row.message_author_id ? '<@' + row.message_author_id + '>' : (row.message_author_tag || 'Unknown');
    const content = row.message_content || '[no text]';
    const attachments = row.attachment_urls ? NL + 'Attachments: ' + row.attachment_urls : '';
    return '**' + author + ':** ' + content + attachments;
  });

  embed.setDescription(lines.join(NL + NL).slice(0, 4000));
  if (ticket.close_reason) embed.addFields({ name: 'Close Reason', value: ticket.close_reason, inline: false });
  return embed;
}

async function buildGameIssueLogEmbed(rows, leagueName = null, decision = null) {
  const NL = String.fromCharCode(10);
  const titleParts = ['Game Issue Review Log'];
  if (leagueName) titleParts.push(leagueName);
  if (decision) titleParts.push(decision);

  const embed = new EmbedBuilder()
    .setTitle(titleParts.join(' • '))
    .setColor(0x5865F2)
    .setFooter({ text: 'GG Sports • Game Issue Review Log' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No game issue rulings found.');
    return embed;
  }

  const lines = rows.map(row => {
    const gameText = row.game_id ? 'Game ' + row.game_id : 'No game ID';
    const teamText = row.requested_team_role_id ? ' • Team <@&' + row.requested_team_role_id + '>' : '';
    const opponentText = row.opponent_user_id ? ' • Opponent <@' + row.opponent_user_id + '>' : '';
    const reviewerText = row.review_decision_by_user_id ? ' • Reviewed by <@' + row.review_decision_by_user_id + '>' : '';
    const threadText = row.thread_id ? ' • <#' + row.thread_id + '>' : '';
    return '**' + shortTicketId(row.id) + '** — ' + (row.request_action || row.ticket_type) + ' • **' + (row.review_decision || 'pending') + '** • ' + gameText + teamText + opponentText + reviewerText + threadText;
  });

  embed.setDescription(lines.join(NL).slice(0, 4000));
  return embed;
}

function buildSupportPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('🎫 GG Sports Support Center')
    .setColor(0xffcc00)
    .setDescription('Need help? Choose the button that best matches your issue. A ticket thread will be created for you and staff will be notified.')
    .addFields(
      { name: 'Support Ticket', value: 'General help, questions, or setup issues.', inline: false },
      { name: 'Dispute', value: 'Rule issues, trade concerns, league conflicts, or staff review needs.', inline: false },
      { name: 'Game Issue', value: 'Lag out, quit, disconnect, reset, or game result review.', inline: false },
      { name: 'Shop Help', value: 'Currency shop, inventory, redemption, or reward fulfillment help.', inline: false }
    )
    .setFooter({ text: 'GG Sports • Support Center' })
    .setTimestamp();
}

function buildSupportPanelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('support_panel_open:support')
      .setLabel('Support Ticket')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('support_panel_open:dispute')
      .setLabel('Dispute')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('support_panel_open:game')
      .setLabel('Game Issue')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('support_panel_open:shop')
      .setLabel('Shop Help')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildTicketDashboardButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_dashboard_filter:open')
      .setLabel('Open')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ticket_dashboard_filter:urgent')
      .setLabel('Urgent/High')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ticket_dashboard_filter:unclaimed')
      .setLabel('Unclaimed')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ticket_dashboard_filter:reviewing')
      .setLabel('Reviewing')
      .setStyle(ButtonStyle.Success)
  );
}

function buildTicketInfoButtons(ticket) {
  const row = new ActionRowBuilder();

  if (ticket.status !== 'closed' && !ticket.assigned_staff_user_id) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_quick_claim:' + ticket.id)
        .setLabel('Claim Ticket')
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (ticket.status !== 'closed') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_quick_reviewing:' + ticket.id)
        .setLabel('Mark Reviewing')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('ticket_quick_resolved:' + ticket.id)
        .setLabel('Mark Resolved')
        .setStyle(ButtonStyle.Success)
    );
  }

  return row.components.length ? row : null;
}

async function buildTicketDashboardEmbed(guildId, filter = 'open') {
  const summary = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status != 'closed')::int AS active_count,
       COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
       COUNT(*) FILTER (WHERE priority IN ('high', 'urgent') AND status != 'closed')::int AS high_priority_count,
       COUNT(*) FILTER (WHERE assigned_staff_user_id IS NULL AND status != 'closed')::int AS unclaimed_count,
       COUNT(*) FILTER (WHERE assigned_staff_user_id IS NOT NULL AND status != 'closed')::int AS claimed_count
     FROM support_tickets
     WHERE guild_id = $1`,
    [guildId]
  );

  let latest;
  if (filter === 'urgent') {
    latest = await pool.query(
      `SELECT * FROM support_tickets
       WHERE guild_id = $1 AND status != 'closed' AND priority IN ('high', 'urgent')
       ORDER BY created_at DESC
       LIMIT 8`,
      [guildId]
    );
  } else if (filter === 'unclaimed') {
    latest = await pool.query(
      `SELECT * FROM support_tickets
       WHERE guild_id = $1 AND status != 'closed' AND assigned_staff_user_id IS NULL
       ORDER BY created_at DESC
       LIMIT 8`,
      [guildId]
    );
  } else if (filter === 'reviewing') {
    latest = await pool.query(
      `SELECT * FROM support_tickets
       WHERE guild_id = $1 AND status = 'reviewing'
       ORDER BY created_at DESC
       LIMIT 8`,
      [guildId]
    );
  } else {
    latest = await pool.query(
      `SELECT * FROM support_tickets
       WHERE guild_id = $1 AND status != 'closed'
       ORDER BY created_at DESC
       LIMIT 8`,
      [guildId]
    );
  }

  const row = summary.rows[0] || {};
  const NL = String.fromCharCode(10);
  const latestText = latest.rows.length
    ? latest.rows.map(ticket => {
        const assigned = ticket.assigned_staff_user_id ? ' • <@' + ticket.assigned_staff_user_id + '>' : ' • Unclaimed';
        return '**' + shortTicketId(ticket.id) + '** — ' + ticket.ticket_type + ' • ' + ticket.priority + ' • ' + ticket.status + assigned;
      }).join(NL)
    : 'No active tickets.';

  return new EmbedBuilder()
    .setTitle('🎫 Ticket Dashboard')
    .setColor(0xffcc00)
    .addFields(
      { name: 'Active', value: String(row.active_count || 0), inline: true },
      { name: 'Open', value: String(row.open_count || 0), inline: true },
      { name: 'High/Urgent', value: String(row.high_priority_count || 0), inline: true },
      { name: 'Claimed', value: String(row.claimed_count || 0), inline: true },
      { name: 'Unclaimed', value: String(row.unclaimed_count || 0), inline: true },
      { name: 'Current View', value: filter, inline: true },
      { name: 'Latest Active Tickets', value: latestText, inline: false }
    )
    .setFooter({ text: 'GG Sports • Live Ticket Dashboard' })
    .setTimestamp();
}

async function saveTicketPanel(guildId, channelId, messageId) {
  await pool.query(
    `INSERT INTO ticket_panels (guild_id, channel_id, message_id, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (guild_id)
     DO UPDATE SET channel_id = $2, message_id = $3, updated_at = NOW()`,
    [guildId, channelId, messageId]
  );
}

async function updateTicketPanel(guild) {
  const panelResult = await pool.query(
    `SELECT channel_id, message_id FROM ticket_panels WHERE guild_id = $1`,
    [guild.id]
  );

  if (!panelResult.rows.length) return;
  const channel = await guild.channels.fetch(panelResult.rows[0].channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  const message = await channel.messages.fetch(panelResult.rows[0].message_id).catch(() => null);
  if (!message) return;
  await message.edit({ embeds: [await buildTicketDashboardEmbed(guild.id)], components: [buildTicketDashboardButtons()] }).catch(() => null);
}

function shortSportsbookId(gameId) {
  return String(gameId || '').split('-')[0];
}

function calculateAmericanOddsPayout(amount, odds) {
  const stake = Number(amount);
  const americanOdds = Number(odds);
  if (!Number.isInteger(stake) || stake <= 0 || !Number.isInteger(americanOdds) || americanOdds === 0) return 0;
  if (americanOdds > 0) return stake + Math.floor((stake * americanOdds) / 100);
  return stake + Math.floor((stake * 100) / Math.abs(americanOdds));
}

function americanOddsToDecimal(odds) {
  const americanOdds = Number(odds);
  if (americanOdds > 0) return 1 + americanOdds / 100;
  return 1 + 100 / Math.abs(americanOdds);
}

function calculateParlayPayout(amount, oddsList) {
  const stake = Number(amount);
  if (!Number.isInteger(stake) || stake <= 0 || !oddsList.length) return { combinedDecimal: 0, payout: 0 };
  const combinedDecimal = oddsList.reduce((total, odds) => total * americanOddsToDecimal(odds), 1);
  return { combinedDecimal, payout: Math.floor(stake * combinedDecimal) };
}

async function settleParlaysForSportsbookGame(guildId, sportsbookGameId, winnerSide, issuedByUserId) {
  const parlayResult = await pool.query(
    `SELECT DISTINCT p.*
     FROM sportsbook_parlays p
     JOIN sportsbook_parlay_legs l ON l.parlay_id = p.id
     WHERE p.guild_id = $1 AND l.sportsbook_game_id = $2 AND p.status = 'open'`,
    [guildId, sportsbookGameId]
  );

  let settledCount = 0;
  let parlayPaid = 0;

  for (const parlay of parlayResult.rows) {
    await pool.query(
      `UPDATE sportsbook_parlay_legs
       SET status = CASE WHEN side = $1 THEN 'won' ELSE 'lost' END
       WHERE parlay_id = $2 AND sportsbook_game_id = $3`,
      [winnerSide, parlay.id, sportsbookGameId]
    );

    const legs = await pool.query(`SELECT * FROM sportsbook_parlay_legs WHERE parlay_id = $1`, [parlay.id]);
    const anyLost = legs.rows.some(leg => leg.status === 'lost');
    const allSettled = legs.rows.every(leg => leg.status === 'won' || leg.status === 'lost');

    if (anyLost) {
      await pool.query(`UPDATE sportsbook_parlays SET status = 'lost', settled_at = NOW() WHERE id = $1`, [parlay.id]);
      settledCount += 1;
    } else if (allSettled) {
      await pool.query(`UPDATE sportsbook_parlays SET status = 'won', settled_at = NOW() WHERE id = $1`, [parlay.id]);
      await addCurrency(guildId, parlay.user_id, Number(parlay.potential_payout), 'sportsbook_parlay_win', 'Won parlay', issuedByUserId);
      await incrementRecognitionStat(guildId, parlay.user_id, 'sportsbook_wins', 1);
      await incrementRecognitionStat(guildId, parlay.user_id, 'sportsbook_profit', Number(parlay.potential_payout) - Number(parlay.amount));
      await addRecognitionPoints(guildId, parlay.user_id, 50, 25);
      settledCount += 1;
      parlayPaid += Number(parlay.potential_payout);
    }
  }

  return { settledCount, parlayPaid };
}

function buildSportsbookBetBoardButtons(rows) {
  const openRows = rows.slice(0, 5);
  if (!openRows.length) return [];

  const row = new ActionRowBuilder();
  for (const game of openRows) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('sportsbook_pick_game:' + game.id)
        .setLabel(shortSportsbookId(game.id))
        .setStyle(ButtonStyle.Primary)
    );
  }
  return [row];
}

function buildSportsbookSideButtons(game) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('sportsbook_pick_side:' + game.id + ':away')
      .setLabel(game.away_label + ' ML ' + game.away_odds)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('sportsbook_pick_side:' + game.id + ':home')
      .setLabel(game.home_label + ' ML ' + game.home_odds)
      .setStyle(ButtonStyle.Success)
  );
}

function buildSportsbookEmbed(settings, rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle('Sportsbook')
    .setColor(0x57F287)
    .setFooter({ text: 'GG Sports • Sportsbook' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No open sportsbook games right now.');
    return embed;
  }

  const lines = rows.map(row => {
    return '**' + shortSportsbookId(row.id) + ' • ' + row.game_label + '**' + NL +
      row.away_label + ' ML ' + row.away_odds + ' vs ' + row.home_label + ' ML ' + row.home_odds + NL +
      'Status: **' + row.status + '** • Bet with `/placebet`';
  });

  embed.setDescription(lines.join(NL + NL));
  return embed;
}

async function buildSportsbookPanelEmbed(guildId) {
  const NL = String.fromCharCode(10);
  const openResult = await pool.query(
    `SELECT g.*,
       COALESCE(SUM(b.amount), 0)::int AS total_handle,
       COUNT(b.id)::int AS bet_count
     FROM sportsbook_games g
     LEFT JOIN sportsbook_bets b ON b.sportsbook_game_id = g.id
     WHERE g.guild_id = $1 AND g.status = 'open'
     GROUP BY g.id
     ORDER BY g.created_at DESC
     LIMIT 10`,
    [guildId]
  );

  const recentResult = await pool.query(
    `SELECT * FROM sportsbook_games
     WHERE guild_id = $1 AND status = 'settled'
     ORDER BY settled_at DESC NULLS LAST
     LIMIT 5`,
    [guildId]
  );

  const openLines = openResult.rows.length
    ? openResult.rows.map(row => {
        return '**' + shortSportsbookId(row.id) + ' • ' + row.game_label + '**' + NL +
          row.away_label + ' ML ' + row.away_odds + ' vs ' + row.home_label + ' ML ' + row.home_odds + NL +
          'Bets: ' + row.bet_count + ' • Handle: ' + row.total_handle;
      }).join(NL + NL)
    : 'No open sportsbook lines.';

  const recentLines = recentResult.rows.length
    ? recentResult.rows.map(row => {
        const winnerLabel = row.winner_side === 'home' ? row.home_label : row.away_label;
        return '**' + row.game_label + '** — Winner: ' + winnerLabel;
      }).join(NL)
    : 'No settled results yet.';

  return new EmbedBuilder()
    .setTitle('📈 Live Sportsbook Board')
    .setColor(0x57F287)
    .addFields(
      { name: 'Open Lines', value: openLines.slice(0, 3000), inline: false },
      { name: 'Recent Results', value: recentLines.slice(0, 1000), inline: false }
    )
    .setFooter({ text: 'GG Sports • Live Sportsbook Board' })
    .setTimestamp();
}

async function saveSportsbookPanel(guildId, channelId, messageId) {
  await pool.query(
    `INSERT INTO sportsbook_panels (guild_id, channel_id, message_id, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (guild_id)
     DO UPDATE SET channel_id = $2, message_id = $3, updated_at = NOW()`,
    [guildId, channelId, messageId]
  );
}

async function updateSportsbookPanel(guild) {
  const panelResult = await pool.query(
    `SELECT channel_id, message_id FROM sportsbook_panels WHERE guild_id = $1`,
    [guild.id]
  );

  if (!panelResult.rows.length) return;
  const channel = await guild.channels.fetch(panelResult.rows[0].channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  const message = await channel.messages.fetch(panelResult.rows[0].message_id).catch(() => null);
  if (!message) return;
  const openResult = await pool.query(
    `SELECT * FROM sportsbook_games WHERE guild_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 5`,
    [guild.id]
  );
  await message.edit({ embeds: [await buildSportsbookPanelEmbed(guild.id)], components: buildSportsbookBetBoardButtons(openResult.rows) }).catch(() => null);
}

function buildMyBetsEmbed(settings, rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle('My Sportsbook Bets')
    .setColor(0x5865F2)
    .setFooter({ text: 'GG Sports • My Bets' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No recent bets found.');
    return embed;
  }

  const lines = rows.map(row => {
    const sideLabel = row.side === 'home' ? row.home_label : row.away_label;
    return '**' + shortSportsbookId(row.id) + '** — ' + row.game_label + ' • ' + sideLabel + ' ML ' + row.odds + NL +
      'Stake: ' + settings.currency_icon + ' ' + row.amount + ' • Potential payout: ' + settings.currency_icon + ' ' + row.potential_payout + ' • ' + row.status;
  });

  embed.setDescription(lines.join(NL + NL));
  return embed;
}

function buildBettingHistoryEmbed(settings, user, summary, rows) {
  const NL = String.fromCharCode(10);
  const totalBets = Number(summary.total_bets || 0);
  const wins = Number(summary.wins || 0);
  const losses = Number(summary.losses || 0);
  const open = Number(summary.open_bets || 0);
  const totalWagered = Number(summary.total_wagered || 0);
  const totalWon = Number(summary.total_won || 0);
  const netProfit = totalWon - totalWagered;

  const embed = new EmbedBuilder()
    .setTitle(user.username + ' • Betting History')
    .setColor(0x5865F2)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'Bets', value: String(totalBets), inline: true },
      { name: 'Record', value: wins + '-' + losses, inline: true },
      { name: 'Open Bets', value: String(open), inline: true },
      { name: 'Total Wagered', value: settings.currency_icon + ' ' + totalWagered, inline: true },
      { name: 'Total Won', value: settings.currency_icon + ' ' + totalWon, inline: true },
      { name: 'Net Profit', value: settings.currency_icon + ' ' + netProfit, inline: true }
    )
    .setFooter({ text: 'GG Sports • Betting History' })
    .setTimestamp();

  if (!rows.length) {
    embed.addFields({ name: 'Recent Bets', value: 'No recent bets found.', inline: false });
    return embed;
  }

  const lines = rows.map(row => {
    const sideLabel = row.side === 'home' ? row.home_label : row.away_label;
    const wonText = row.status === 'won' ? ' • Paid: ' + settings.currency_icon + ' ' + row.potential_payout : '';
    return '**' + shortSportsbookId(row.id) + '** — ' + row.game_label + ' • ' + sideLabel + ' ML ' + row.odds + NL +
      'Stake: ' + settings.currency_icon + ' ' + row.amount + ' • ' + row.status + wonText;
  });

  embed.addFields({ name: 'Recent Bets', value: lines.join(NL + NL).slice(0, 3000), inline: false });
  return embed;
}

function buildBettingLeaderboardEmbed(settings, rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle('Sportsbook Leaderboard')
    .setColor(0xFEE75C)
    .setFooter({ text: 'GG Sports • Betting Leaderboard' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No settled betting results yet.');
    return embed;
  }

  const lines = rows.map((row, index) => {
    const totalWagered = Number(row.total_wagered || 0);
    const totalWon = Number(row.total_won || 0);
    const netProfit = totalWon - totalWagered;
    const wins = Number(row.wins || 0);
    const losses = Number(row.losses || 0);
    return '**' + (index + 1) + '. <@' + row.user_id + '>** — Net: ' + settings.currency_icon + ' ' + netProfit +
      ' • Record: ' + wins + '-' + losses + ' • Wagered: ' + settings.currency_icon + ' ' + totalWagered + ' • Won: ' + settings.currency_icon + ' ' + totalWon;
  });

  embed.setDescription(lines.join(NL));
  return embed;
}

const ACTIVITY_MILESTONES = [
  { key: 'activity_100', points: 100, title: 'Active Member', reward: 50 },
  { key: 'activity_500', points: 500, title: 'Veteran Grinder', reward: 150 },
  { key: 'activity_1000', points: 1000, title: 'Certified Grinder', reward: 300 },
  { key: 'activity_2500', points: 2500, title: 'Elite Contributor', reward: 750 },
  { key: 'activity_5000', points: 5000, title: 'Community Icon', reward: 1500 },
];

async function getActivitySettings(guildId) {
  await pool.query(
    `INSERT INTO activity_settings (guild_id)
     VALUES ($1)
     ON CONFLICT (guild_id) DO NOTHING`,
    [guildId]
  );

  const result = await pool.query(`SELECT * FROM activity_settings WHERE guild_id = $1`, [guildId]);
  return result.rows[0] || { guild_id: guildId, milestone_channel_id: null };
}

function buildMilestonesEmbed(user, activityPoints, claimedKeys) {
  const NL = String.fromCharCode(10);
  const claimed = new Set(claimedKeys || []);
  const lines = ACTIVITY_MILESTONES.map(milestone => {
    const unlocked = Number(activityPoints || 0) >= milestone.points;
    const claimedText = claimed.has(milestone.key) ? '✅ Claimed' : unlocked ? '🎁 Unlocked' : '🔒 Locked';
    return '**' + milestone.title + '** — ' + milestone.points + ' Activity Points • Reward: ' + milestone.reward + ' • ' + claimedText;
  });

  return new EmbedBuilder()
    .setTitle(user.username + ' • Activity Milestones')
    .setColor(0x57F287)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setDescription(lines.join(NL))
    .setFooter({ text: 'GG Sports • Activity Milestones' })
    .setTimestamp();
}

function buildMilestoneAnnouncementEmbed(userId, milestone, settings) {
  return new EmbedBuilder()
    .setTitle('⚡ Activity Milestone Unlocked')
    .setColor(0xFEE75C)
    .addFields(
      { name: 'Member', value: '<@' + userId + '>', inline: true },
      { name: 'Milestone', value: milestone.title, inline: true },
      { name: 'Activity Required', value: String(milestone.points), inline: true },
      { name: 'Reward', value: settings.currency_icon + ' ' + milestone.reward + ' ' + settings.currency_name, inline: false }
    )
    .setFooter({ text: 'GG Sports • Activity Rewards' })
    .setTimestamp();
}

async function checkActivityMilestones(guildId, userId) {
  const profileResult = await pool.query(
    `SELECT activity_points FROM user_recognition WHERE guild_id = $1 AND user_id = $2 LIMIT 1`,
    [guildId, userId]
  );

  const activityPoints = Number(profileResult.rows[0]?.activity_points || 0);
  const settings = await getCurrencySettings(guildId);
  const activitySettings = await getActivitySettings(guildId);

  for (const milestone of ACTIVITY_MILESTONES) {
    if (activityPoints < milestone.points) continue;

    const claimedResult = await pool.query(
      `INSERT INTO activity_milestones_claimed (guild_id, user_id, milestone_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, user_id, milestone_key) DO NOTHING
       RETURNING milestone_key`,
      [guildId, userId, milestone.key]
    );

    if (!claimedResult.rows.length) continue;

    if (milestone.reward > 0) {
      await addCurrency(guildId, userId, milestone.reward, 'activity_milestone', milestone.title, null);
    }

    if (activitySettings.milestone_channel_id) {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      const channel = guild ? await guild.channels.fetch(activitySettings.milestone_channel_id).catch(() => null) : null;
      if (channel && channel.isTextBased()) {
        await channel.send({ embeds: [buildMilestoneAnnouncementEmbed(userId, milestone, settings)] }).catch(() => null);
      }
    }
  }
}

async function ensureRecognitionProfile(guildId, userId) {
  await pool.query(
    `INSERT INTO user_recognition (guild_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );
}

async function addActivityPoints(guildId, userId, points, legacyPoints = 0) {
  await ensureRecognitionProfile(guildId, userId);

  await pool.query(
    `UPDATE user_recognition
     SET activity_points = activity_points + $3,
         legacy_score = legacy_score + $4,
         updated_at = NOW(),
         last_activity_at = NOW()
     WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId, Number(points || 0), Number(legacyPoints || 0)]
  );

  await checkActivityMilestones(guildId, userId).catch(() => null);
}

async function addRecognitionPoints(guildId, userId, points, legacyPoints = 0) {
  return addActivityPoints(guildId, userId, points, legacyPoints);
}

async function incrementRecognitionStat(guildId, userId, field, amount = 1) {
  const allowedFields = [
    'championships',
    'tournament_titles',
    'sportsbook_wins',
    'sportsbook_profit',
    'tickets_resolved',
    'games_played',
    'activity_streak'
  ];

  if (!allowedFields.includes(field)) return;

  await ensureRecognitionProfile(guildId, userId);
  await pool.query(
    `UPDATE user_recognition
     SET ${field} = ${field} + $3,
         updated_at = NOW(),
         last_activity_at = NOW()
     WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId, Number(amount || 1)]
  );
}

function getLegacyTier(score) {
  const legacyScore = Number(score || 0);
  if (legacyScore >= 5000) return 'GOAT';
  if (legacyScore >= 2500) return 'Legend';
  if (legacyScore >= 1000) return 'Elite';
  if (legacyScore >= 500) return 'Veteran';
  if (legacyScore >= 100) return 'Rising Star';
  return 'Rookie';
}

function getActivityTier(score) {
  const activityScore = Number(score || 0);
  if (activityScore >= 5000) return 'Icon';
  if (activityScore >= 2500) return 'Elite';
  if (activityScore >= 1000) return 'Grinder';
  if (activityScore >= 500) return 'Veteran';
  if (activityScore >= 100) return 'Active';
  return 'Rookie';
}

function getRecognitionTier(score) {
  return getLegacyTier(score);
}

function buildActivityEmbed(user, row) {
  const profile = row || {};
  const activityPoints = Number(profile.activity_points || profile.recognition_points || 0);
  const legacyScore = Number(profile.legacy_score || 0);

  return new EmbedBuilder()
    .setTitle(user.username + ' • Activity & Legacy Profile')
    .setColor(0xFEE75C)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'Activity Tier', value: getActivityTier(activityPoints), inline: true },
      { name: 'Activity Points', value: String(activityPoints), inline: true },
      { name: 'Activity Streak', value: String(profile.activity_streak || 0), inline: true },
      { name: 'Legacy Tier', value: getLegacyTier(legacyScore), inline: true },
      { name: 'Legacy Score', value: String(legacyScore), inline: true },
      { name: 'Championships', value: String(profile.championships || 0), inline: true },
      { name: 'Tournament Titles', value: String(profile.tournament_titles || 0), inline: true },
      { name: 'Sportsbook Wins', value: String(profile.sportsbook_wins || 0), inline: true },
      { name: 'Sportsbook Profit', value: String(profile.sportsbook_profit || 0), inline: true },
      { name: 'Tickets Resolved', value: String(profile.tickets_resolved || 0), inline: true },
      { name: 'Games Played', value: String(profile.games_played || 0), inline: true }
    )
    .setFooter({ text: 'GG Sports • Activity & Legacy System' })
    .setTimestamp();
}

function buildRecognitionEmbed(user, row) {
  return buildActivityEmbed(user, row);
}

function buildLegacyLeaderboardEmbed(rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle('🏆 Legacy Leaderboard')
    .setColor(0xFEE75C)
    .setFooter({ text: 'GG Sports • Legacy Rankings' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No legacy profiles found yet.');
    return embed;
  }

  embed.setDescription(
    rows.map((row, index) => {
      const activityPoints = Number(row.activity_points || row.recognition_points || 0);
      return '**' + (index + 1) + '. <@' + row.user_id + '>** — Legacy: ' + row.legacy_score + ' • Activity: ' + activityPoints + ' • Tier: ' + getLegacyTier(row.legacy_score);
    }).join(NL)
  );

  return embed;
}

function buildActivityLeaderboardEmbed(rows) {
  const NL = String.fromCharCode(10);
  const embed = new EmbedBuilder()
    .setTitle('⚡ Activity Leaderboard')
    .setColor(0x57F287)
    .setFooter({ text: 'GG Sports • Activity Rankings' })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription('No activity profiles found yet.');
    return embed;
  }

  embed.setDescription(
    rows.map((row, index) => {
      const activityPoints = Number(row.activity_points || row.recognition_points || 0);
      return '**' + (index + 1) + '. <@' + row.user_id + '>** — Activity: ' + activityPoints + ' • Streak: ' + (row.activity_streak || 0) + ' • Tier: ' + getActivityTier(activityPoints);
    }).join(NL)
  );

  return embed;
}

async function getSportsbookSettings(guildId) {
  await pool.query(
    `INSERT INTO sportsbook_settings (guild_id)
     VALUES ($1)
     ON CONFLICT (guild_id) DO NOTHING`,
    [guildId]
  );

  const result = await pool.query(`SELECT * FROM sportsbook_settings WHERE guild_id = $1`, [guildId]);
  return result.rows[0] || { guild_id: guildId, feed_channel_id: null, big_bet_threshold: 500 };
}

async function postSportsbookFeed(guild, embed) {
  const settings = await getSportsbookSettings(guild.id);
  if (!settings.feed_channel_id) return;

  const channel = await guild.channels.fetch(settings.feed_channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ embeds: [embed] }).catch(() => null);
}

function buildSportsbookBetAlertEmbed(settings, user, game, side, amount, odds, payout, isBigBet = false) {
  const sideLabel = side === 'home' ? game.home_label : game.away_label;
  return new EmbedBuilder()
    .setTitle(isBigBet ? '🚨 Big Bet Alert' : '🎟️ Bet Placed')
    .setColor(isBigBet ? 0xED4245 : 0x5865F2)
    .addFields(
      { name: 'User', value: '<@' + user.id + '>', inline: true },
      { name: 'Pick', value: sideLabel + ' ML ' + odds, inline: true },
      { name: 'Stake', value: settings.currency_icon + ' ' + amount, inline: true },
      { name: 'Game', value: game.game_label, inline: false },
      { name: 'Potential Payout', value: settings.currency_icon + ' ' + payout, inline: true }
    )
    .setFooter({ text: 'GG Sports • Sportsbook Feed' })
    .setTimestamp();
}

function buildSportsbookSettlementAlertEmbed(game, winnerLabel, winners, losers, totalPaid, parlayResult) {
  return new EmbedBuilder()
    .setTitle('✅ Sportsbook Result Settled')
    .setColor(0x57F287)
    .addFields(
      { name: 'Game', value: game.game_label, inline: false },
      { name: 'Winner', value: winnerLabel, inline: true },
      { name: 'Winning Bets', value: String(winners), inline: true },
      { name: 'Losing Bets', value: String(losers), inline: true },
      { name: 'Straight Bet Payouts', value: String(totalPaid), inline: true },
      { name: 'Parlays Settled', value: String(parlayResult?.settledCount || 0), inline: true },
      { name: 'Parlay Payouts', value: String(parlayResult?.parlayPaid || 0), inline: true }
    )
    .setFooter({ text: 'GG Sports • Sportsbook Feed' })
    .setTimestamp();
}

function buildParlayCreatedAlertEmbed(settings, user, parlayId, amount, payout, legCount) {
  return new EmbedBuilder()
    .setTitle(legCount >= 4 ? '🔥 Monster Parlay Placed' : '🎲 Parlay Placed')
    .setColor(0xFEE75C)
    .addFields(
      { name: 'User', value: '<@' + user.id + '>', inline: true },
      { name: 'Parlay ID', value: shortSportsbookId(parlayId), inline: true },
      { name: 'Legs', value: String(legCount), inline: true },
      { name: 'Stake', value: settings.currency_icon + ' ' + amount, inline: true },
      { name: 'Potential Payout', value: settings.currency_icon + ' ' + payout, inline: true }
    )
    .setFooter({ text: 'GG Sports • Sportsbook Feed' })
    .setTimestamp();
}

async function findSportsbookGame(guildId, input) {
  const result = await pool.query(
    `SELECT * FROM sportsbook_games
     WHERE guild_id = $1 AND (id::text LIKE $2 OR LOWER(game_label) = LOWER($3))
     ORDER BY created_at DESC
     LIMIT 1`,
    [guildId, input + '%', input]
  );
  return result.rows[0] || null;
}

async function applyApprovedGameIssue(ticket, reviewerUserId) {
  if (!ticket.game_id || !ticket.league_id || !ticket.request_action) {
    return 'Decision saved. No game update was applied because this ticket is missing game metadata.';
  }

  const gameResult = await pool.query(
    `SELECT * FROM league_games
     WHERE guild_id = $1 AND league_id = $2 AND id::text LIKE $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [ticket.guild_id, ticket.league_id, ticket.game_id + '%']
  );

  if (!gameResult.rows.length) {
    return 'Decision saved, but no matching game was found for Game ID **' + ticket.game_id + '**.';
  }

  const game = gameResult.rows[0];
  const league = await getLeagueById(ticket.league_id);

  if (ticket.request_action === 'reset') {
    await pool.query(
      `UPDATE league_games
       SET status = 'scheduled', home_score = NULL, away_score = NULL, winner_team_role_id = NULL, reported_by_user_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [reviewerUserId, game.id]
    );
    return 'Game **' + shortGameId(game.id) + '** has been reset/reopened.';
  }

  const requestedTeamRoleId = ticket.requested_team_role_id;
  if (!requestedTeamRoleId) {
    return 'Decision saved. No force win was applied because no requesting team role was saved.';
  }

  if (![game.home_team_role_id, game.away_team_role_id].includes(requestedTeamRoleId)) {
    return 'Decision saved. No force win was applied because the requesting team is not part of this game.';
  }

  const homeWins = requestedTeamRoleId === game.home_team_role_id;
  const homeScore = homeWins ? 1 : 0;
  const awayScore = homeWins ? 0 : 1;
  const winnerRoleId = requestedTeamRoleId;
  const loserRoleId = homeWins ? game.away_team_role_id : game.home_team_role_id;
  const winnerName = homeWins ? game.home_team_name : game.away_team_name;
  const loserName = homeWins ? game.away_team_name : game.home_team_name;

  if (game.status === 'final') {
    return 'Decision saved. Game **' + shortGameId(game.id) + '** was already final, so standings were not changed automatically.';
  }

  await pool.query(
    `UPDATE league_games
     SET status = 'final', home_score = $1, away_score = $2, winner_team_role_id = $3, reported_by_user_id = $4, updated_at = NOW()
     WHERE id = $5`,
    [homeScore, awayScore, winnerRoleId, reviewerUserId, game.id]
  );

  await pool.query(
    `INSERT INTO league_standings (guild_id, league_id, team_role_id, team_name, wins, losses)
     VALUES ($1, $2, $3, $4, 1, 0)
     ON CONFLICT (guild_id, league_id, team_role_id)
     DO UPDATE SET wins = league_standings.wins + 1, updated_at = NOW()`,
    [ticket.guild_id, ticket.league_id, winnerRoleId, winnerName]
  );

  await pool.query(
    `INSERT INTO league_standings (guild_id, league_id, team_role_id, team_name, wins, losses)
     VALUES ($1, $2, $3, $4, 0, 1)
     ON CONFLICT (guild_id, league_id, team_role_id)
     DO UPDATE SET losses = league_standings.losses + 1, updated_at = NOW()`,
    [ticket.guild_id, ticket.league_id, loserRoleId, loserName]
  );

  const guild = await client.guilds.fetch(ticket.guild_id).catch(() => null);
  if (guild && league) await updateStandingsPanel(guild, league);

  return 'Approved ruling applied: **' + winnerName + '** receives a force win over **' + loserName + '** for Game **' + shortGameId(game.id) + '**.';
}

async function openGameIssueTicket(interaction, ticketType) {
  if (!interaction.guild) return;

  const leagueName = interaction.options.getString('league');
  const gameId = interaction.options.getString('game_id');
  const opponent = interaction.options.getUser('opponent');
  const team = interaction.options.getRole('team');
  const details = interaction.options.getString('details');
  const activeLeague = await getLeagueByName(interaction.guild.id, leagueName);

  if (!activeLeague) {
    await interaction.reply({ content: 'Could not find league **' + leagueName + '**.', ephemeral: true });
    return;
  }

  const subject = ticketType + ' review' + (gameId ? ' • Game ' + gameId : '');
  const NL = String.fromCharCode(10);
  let description = '**League:** ' + activeLeague.league_name;
  if (gameId) description += NL + '**Game ID:** ' + gameId;
  if (team) description += NL + '**Requesting Team:** ' + team.toString();
  if (opponent) description += NL + '**Opponent:** ' + opponent.toString();
  description += NL + '**Request Type:** ' + ticketType;
  description += NL + '**Details:** ' + (details || 'No details provided yet.');
  description += NL + NL + 'Please upload proof/screenshots in this ticket thread. Attachments will be saved automatically as evidence.';

  const originalGetString = interaction.options.getString.bind(interaction.options);
  interaction.options.getString = function(name) {
    if (name === 'subject') return subject;
    if (name === 'description') return description;
    if (name === 'league') return activeLeague.league_name;
    return originalGetString(name);
  };

  const requestedTeamRoleId = team?.id || null;
  const opponentUserId = opponent?.id || null;

  interaction.ggSportsReviewButtons = true;
  interaction.ggSportsGameIssueMeta = {
    gameId,
    requestAction: ticketType,
    requestedTeamRoleId,
    opponentUserId,
  };

  await openSupportTicket(interaction, 'gamerequest');
  delete interaction.ggSportsReviewButtons;
  delete interaction.ggSportsGameIssueMeta;
}

async function openSupportTicket(interaction, ticketType) {
  if (!interaction.guild) return;

  const shouldAddReviewButtons = interaction.ggSportsReviewButtons === true;
  const gameIssueMeta = interaction.ggSportsGameIssueMeta || null;

  const subject = interaction.options.getString('subject');
  const description = interaction.options.getString('description');
  const leagueName = interaction.options.getString('league');
  const activeLeague = leagueName ? await getLeagueByName(interaction.guild.id, leagueName) : await resolveLeague(interaction);

  if (leagueName && !activeLeague) {
    await interaction.reply({ content: 'Could not find league **' + leagueName + '**.', ephemeral: true });
    return;
  }

  const baseChannel = interaction.channel;
  if (!baseChannel || !baseChannel.isTextBased()) {
    await interaction.reply({ content: 'Tickets can only be opened from a text channel.', ephemeral: true });
    return;
  }

  const botMember = await interaction.guild.members.fetchMe();
  const permissions = baseChannel.permissionsFor(botMember);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.CreatePublicThreads)) {
    await interaction.reply({ content: 'I need View Channel, Send Messages, and Create Public Threads permissions here to open tickets.', ephemeral: true });
    return;
  }

  const safeSubject = subject.replace(/[^a-zA-Z0-9 -]/g, '').trim().slice(0, 40) || ticketType;
  const threadName = (ticketType + '-' + interaction.user.username + '-' + safeSubject).slice(0, 90);
  const staffRoleId = activeLeague?.staff_role_id || null;

  const starterPayload = {
    content: '<@' + interaction.user.id + '> opened a **' + ticketType + '** ticket.' + (staffRoleId ? ' <@&' + staffRoleId + '>' : ''),
    embeds: [buildTicketEmbed({ type: ticketType, subject, description, creator: interaction.user })],
    allowedMentions: {
      users: [interaction.user.id],
      roles: staffRoleId ? [staffRoleId] : [],
    },
  };

  const starter = await baseChannel.send(starterPayload);

  const thread = await starter.startThread({
    name: threadName,
    autoArchiveDuration: 1440,
    reason: 'GG Sports ' + ticketType + ' ticket',
  }).catch(() => null);

  if (!thread) {
    await interaction.reply({ content: 'I could not create the ticket thread. Make sure I have Create Public Threads permission.', ephemeral: true });
    return;
  }

  const NL = String.fromCharCode(10);
  await thread.send({
    content: '<@' + interaction.user.id + '> your ticket is open here.' + (staffRoleId ? ' Staff: <@&' + staffRoleId + '>' : '') + NL + NL + 'Use **/closeticket** in this thread when it is resolved.',
    allowedMentions: {
      users: [interaction.user.id],
      roles: staffRoleId ? [staffRoleId] : [],
    },
  }).catch(() => null);

  const ticketId = await createTicketRecord({
    guildId: interaction.guild.id,
    leagueId: activeLeague?.league_id || null,
    userId: interaction.user.id,
    ticketType,
    subject,
    description,
    channelId: baseChannel.id,
    threadId: thread.id,
  });

  if (gameIssueMeta) {
    await pool.query(
      `UPDATE support_tickets
       SET game_id = $1,
           request_action = $2,
           requested_team_role_id = $3,
           opponent_user_id = $4
       WHERE id = $5`,
      [gameIssueMeta.gameId || null, gameIssueMeta.requestAction || null, gameIssueMeta.requestedTeamRoleId || null, gameIssueMeta.opponentUserId || null, ticketId]
    );
  }

  if (shouldAddReviewButtons) {
    await thread.send({
      content: 'Staff review action required for this game issue request.',
      components: [buildTicketReviewButtons(ticketId)],
    }).catch(() => null);
  }

  await updateTicketPanel(interaction.guild);
  await interaction.reply({ content: 'Ticket opened: ' + thread.toString() + '. Ticket ID: **' + ticketId.split('-')[0] + '**', ephemeral: true });
}

