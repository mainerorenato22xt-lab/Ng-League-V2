create type public.match_phase as enum ('regular','quarterfinal','semifinal','final','relegation');
create type public.match_status as enum ('scheduled','played','void');
create type public.match_event_kind as enum ('goal','own_goal','assist','yellow_card','red_card');
create type public.negotiation_kind as enum ('purchase','loan','swap');
create type public.negotiation_status as enum ('sent','negotiating','accepted','rejected','cancelled','completed');
create type public.loan_option as enum ('none','voluntary','mandatory');
create type public.loan_status as enum ('active','returning','returned','bought');
create type public.transfer_kind as enum ('purchase','free_signing','club_release','loan_start','loan_return','loan_purchase','swap','release_clause','admin');
create type public.ledger_kind as enum ('opening','prize','bonus','signing','release','transfer','release_clause','loan_fee','adjustment');
create type public.news_category as enum ('official','transfer','statement','result','preview','chronicle','communique','club');
create type public.news_status as enum ('draft','published','hidden');

create table public.matches (
  id bigint generated always as identity primary key,
  season_id integer not null references public.seasons(id),
  phase public.match_phase not null default 'regular',
  round smallint check (round > 0),
  bracket_code text,
  home_club integer references public.clubs(id),
  away_club integer references public.clubs(id),
  home_source text,
  away_source text,
  scheduled_at timestamptz,
  status public.match_status not null default 'scheduled',
  home_goals smallint check (home_goals >= 0),
  away_goals smallint check (away_goals >= 0),
  home_penalties smallint check (home_penalties >= 0),
  away_penalties smallint check (away_penalties >= 0),
  winner_club integer references public.clubs(id),
  notes text,
  data_quality public.data_quality not null default 'verified',
  legacy_key text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (home_club is null or away_club is null or home_club <> away_club),
  check ((phase = 'regular') = (bracket_code is null)),
  check (phase <> 'regular' or round is not null)
);
create unique index matches_regular_key on public.matches (season_id, round, home_club, away_club) where phase = 'regular';
create unique index matches_bracket_key on public.matches (season_id, bracket_code) where bracket_code is not null;
create unique index matches_legacy_key on public.matches (season_id, legacy_key) where legacy_key is not null;
create index matches_season_status_idx on public.matches (season_id, status, round);
create index matches_home_idx on public.matches (home_club);
create index matches_away_idx on public.matches (away_club);
create index matches_winner_idx on public.matches (winner_club);
create index matches_updated_by_idx on public.matches (updated_by);

create table public.match_events (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches(id) on delete cascade,
  kind public.match_event_kind not null,
  club_id integer not null references public.clubs(id),
  player_id integer references public.players(id),
  raw_player_name text,
  minute smallint check (minute between 0 and 200),
  created_at timestamptz not null default now(),
  check (player_id is not null or raw_player_name is not null)
);
create index match_events_match_idx on public.match_events (match_id);
create index match_events_player_idx on public.match_events (player_id);
create index match_events_club_idx on public.match_events (club_id);

create table public.match_lineups (
  match_id bigint not null references public.matches(id) on delete cascade,
  club_id integer not null references public.clubs(id),
  player_id integer not null references public.players(id),
  is_starter boolean not null default true,
  position_id smallint references public.positions(id),
  primary key (match_id, player_id)
);
create index match_lineups_club_idx on public.match_lineups (club_id);
create index match_lineups_player_idx on public.match_lineups (player_id);
create index match_lineups_position_idx on public.match_lineups (position_id);

create table public.season_archives (
  season_id integer primary key references public.seasons(id) on delete cascade,
  champion_club integer references public.clubs(id),
  runner_up_club integer references public.clubs(id),
  relegated_clubs integer[] not null default '{}',
  final_score text,
  format_notes text,
  source public.data_quality not null default 'imported',
  closed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index season_archives_champion_idx on public.season_archives (champion_club);
create index season_archives_runner_idx on public.season_archives (runner_up_club);
create index season_archives_closed_by_idx on public.season_archives (closed_by);

create table public.season_table_snapshots (
  season_id integer not null references public.seasons(id) on delete cascade,
  club_id integer not null references public.clubs(id),
  club_name text not null,
  position smallint not null check (position > 0),
  played smallint not null, won smallint not null, drawn smallint not null, lost smallint not null,
  goals_for smallint not null, goals_against smallint not null, points smallint not null,
  final_rank smallint,
  primary key (season_id, club_id)
);
create index season_table_club_idx on public.season_table_snapshots (club_id);

create table public.season_scorer_snapshots (
  id bigint generated always as identity primary key,
  season_id integer not null references public.seasons(id) on delete cascade,
  club_id integer references public.clubs(id),
  player_id integer references public.players(id),
  raw_player_name text not null,
  goals smallint not null check (goals >= 0)
);
create index season_scorers_season_idx on public.season_scorer_snapshots (season_id);
create index season_scorers_club_idx on public.season_scorer_snapshots (club_id);
create index season_scorers_player_idx on public.season_scorer_snapshots (player_id);

create table public.awards (
  id bigint generated always as identity primary key,
  season_id integer not null references public.seasons(id) on delete cascade,
  category text not null,
  label text not null,
  club_id integer references public.clubs(id),
  player_id integer references public.players(id),
  coach_id integer references public.coaches(id),
  votes smallint,
  value numeric(12,1),
  unique (season_id, category, label)
);
create index awards_club_idx on public.awards (club_id);
create index awards_player_idx on public.awards (player_id);
create index awards_coach_idx on public.awards (coach_id);

create table public.award_votes (
  season_id integer not null references public.seasons(id) on delete cascade,
  category text not null check (category in ('mvp','revelation','coach')),
  voter_id uuid not null references public.profiles(id) on delete cascade,
  player_id integer references public.players(id),
  club_id integer references public.clubs(id),
  created_at timestamptz not null default now(),
  primary key (season_id, category, voter_id),
  check (num_nonnulls(player_id, club_id) = 1)
);
create index award_votes_voter_idx on public.award_votes (voter_id);
create index award_votes_player_idx on public.award_votes (player_id);
create index award_votes_club_idx on public.award_votes (club_id);

create table public.market_windows (
  id integer generated always as identity primary key,
  season_id integer not null references public.seasons(id),
  opens_at timestamptz not null default now(),
  closes_at timestamptz,
  is_open boolean not null default true,
  check (closes_at is null or closes_at > opens_at)
);
create unique index market_one_open on public.market_windows (is_open) where is_open;
create index market_windows_season_idx on public.market_windows (season_id);

create table public.negotiations (
  id bigint generated always as identity primary key,
  window_id integer not null references public.market_windows(id),
  kind public.negotiation_kind not null,
  player_id integer not null references public.players(id),
  seller_club integer not null references public.clubs(id),
  buyer_club integer not null references public.clubs(id),
  status public.negotiation_status not null default 'sent',
  turn_club integer references public.clubs(id),
  created_by uuid references public.profiles(id) on delete set null,
  legacy_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (seller_club <> buyer_club)
);
create unique index negotiations_one_open on public.negotiations (player_id, buyer_club) where status in ('sent','negotiating');
create index negotiations_window_idx on public.negotiations (window_id);
create index negotiations_seller_idx on public.negotiations (seller_club);
create index negotiations_buyer_idx on public.negotiations (buyer_club);
create index negotiations_turn_idx on public.negotiations (turn_club);
create index negotiations_created_by_idx on public.negotiations (created_by);

create table public.negotiation_offers (
  id bigint generated always as identity primary key,
  negotiation_id bigint not null references public.negotiations(id) on delete cascade,
  from_club integer not null references public.clubs(id),
  amount numeric(10,1) not null check (amount >= 0),
  swap_player_id integer references public.players(id),
  loan_seasons smallint check (loan_seasons in (1,2)),
  option_kind public.loan_option not null default 'none',
  option_price numeric(10,1) check (option_price >= 0),
  option_goal jsonb,
  message text check (length(message) <= 280),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index negotiation_offers_negotiation_idx on public.negotiation_offers (negotiation_id);
create index negotiation_offers_from_idx on public.negotiation_offers (from_club);
create index negotiation_offers_swap_idx on public.negotiation_offers (swap_player_id);
create index negotiation_offers_created_by_idx on public.negotiation_offers (created_by);

create table public.loans (
  id bigint generated always as identity primary key,
  player_id integer not null references public.players(id),
  owner_club integer not null references public.clubs(id),
  borrower_club integer not null references public.clubs(id),
  negotiation_id bigint references public.negotiations(id),
  start_season integer not null references public.seasons(id),
  end_season integer not null references public.seasons(id),
  fee numeric(10,1) not null default 0 check (fee >= 0),
  option_kind public.loan_option not null default 'none',
  option_price numeric(10,1) check (option_price >= 0),
  option_goal jsonb,
  status public.loan_status not null default 'active',
  created_at timestamptz not null default now(),
  check (owner_club <> borrower_club)
);
create unique index loans_one_active on public.loans (player_id) where status in ('active','returning');
create index loans_owner_idx on public.loans (owner_club);
create index loans_borrower_idx on public.loans (borrower_club);
create index loans_negotiation_idx on public.loans (negotiation_id);
create index loans_start_idx on public.loans (start_season);
create index loans_end_idx on public.loans (end_season);

create table public.transfers (
  id bigint generated always as identity primary key,
  season_id integer references public.seasons(id),
  window_id integer references public.market_windows(id),
  kind public.transfer_kind not null,
  player_id integer not null references public.players(id),
  from_club integer references public.clubs(id),
  to_club integer references public.clubs(id),
  amount numeric(10,1) not null default 0 check (amount >= 0),
  negotiation_id bigint references public.negotiations(id),
  is_anomaly boolean not null default false,
  note text,
  legacy_id text unique,
  occurred_at timestamptz not null default now()
);
create index transfers_recent_idx on public.transfers (occurred_at desc);
create index transfers_season_idx on public.transfers (season_id);
create index transfers_window_idx on public.transfers (window_id);
create index transfers_player_idx on public.transfers (player_id);
create index transfers_from_idx on public.transfers (from_club);
create index transfers_to_idx on public.transfers (to_club);
create index transfers_negotiation_idx on public.transfers (negotiation_id);

create table public.club_ledger (
  id bigint generated always as identity primary key,
  club_id integer not null references public.clubs(id),
  season_id integer references public.seasons(id),
  kind public.ledger_kind not null,
  amount numeric(10,1) not null,
  transfer_id bigint references public.transfers(id),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index club_ledger_club_idx on public.club_ledger (club_id);
create index club_ledger_season_idx on public.club_ledger (season_id);
create index club_ledger_transfer_idx on public.club_ledger (transfer_id);
create index club_ledger_created_by_idx on public.club_ledger (created_by);

create table public.news_posts (
  id bigint generated always as identity primary key,
  club_id integer references public.clubs(id),
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null,
  category public.news_category not null default 'club',
  title text check (length(title) <= 160),
  body text not null check (length(body) between 1 and 20000),
  image_path text,
  status public.news_status not null default 'published',
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_id text unique
);
create index news_published_idx on public.news_posts (published_at desc) where status = 'published';
create index news_club_idx on public.news_posts (club_id);
create index news_author_idx on public.news_posts (author_id);

create table public.post_likes (
  post_id bigint not null references public.news_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes (user_id);

create table public.bets (
  id bigint generated always as identity primary key,
  season_id integer not null references public.seasons(id),
  match_id bigint not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pick text not null check (pick in ('home','draw','away')),
  odds numeric(6,2) not null check (odds >= 1),
  stake integer not null check (stake >= 10),
  created_at timestamptz not null default now(),
  unique (match_id, user_id)
);
create index bets_season_idx on public.bets (season_id);
create index bets_user_idx on public.bets (user_id);

create table public.regulations (
  id integer generated always as identity primary key,
  version integer not null unique check (version > 0),
  title text not null default 'Reglamento de NG League',
  body text not null,
  is_current boolean not null default false,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default now()
);
create unique index regulations_one_current on public.regulations (is_current) where is_current;
create index regulations_published_by_idx on public.regulations (published_by);

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  action text not null,
  table_name text not null,
  row_key text,
  old_data jsonb,
  new_data jsonb
);
create index audit_log_recent_idx on public.audit_log (occurred_at desc);
create index audit_log_table_idx on public.audit_log (table_name, row_key);

create table public.import_batches (
  id bigint generated always as identity primary key,
  kind text not null,
  file_name text,
  file_sha256 text,
  status text not null default 'pending' check (status in ('pending','applied','failed')),
  stats jsonb not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index import_batches_created_by_idx on public.import_batches (created_by);

create table public.import_issues (
  id bigint generated always as identity primary key,
  batch_id bigint not null references public.import_batches(id) on delete cascade,
  severity text not null default 'review' check (severity in ('info','review','error')),
  entity text not null,
  legacy_ref text,
  message text not null,
  payload jsonb,
  resolved_at timestamptz
);
create index import_issues_batch_idx on public.import_issues (batch_id);

create table public.legacy_ids (
  source text not null,
  legacy_id text not null,
  entity text not null,
  entity_id text not null,
  batch_id bigint references public.import_batches(id) on delete set null,
  primary key (source, legacy_id)
);
create index legacy_ids_batch_idx on public.legacy_ids (batch_id);

create table private.bootstrap_admins (email text primary key check (email = lower(email)));
