create function private.require_admin() returns void language plpgsql stable set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Acceso solo para administración' using errcode = '42501'; end if;
end $$;

create function private.source_club(p_season integer, p_source text, p_current integer) returns integer
language plpgsql stable set search_path = '' as $$
declare m public.matches; v_kind text := split_part(coalesce(p_source, ''), ':', 1); v_code text := split_part(coalesce(p_source, ''), ':', 2);
begin
  if v_kind not in ('winner', 'loser') then return p_current; end if;
  select * into m from public.matches where season_id = p_season and bracket_code = v_code;
  if not found or m.status <> 'played' then return null; end if;
  if v_kind = 'winner' then return m.winner_club; end if;
  return case when m.winner_club = m.home_club then m.away_club else m.home_club end;
end $$;

create function private.advance_bracket(p_season integer) returns void
language plpgsql set search_path = '' as $$
declare m public.matches; v_home integer; v_away integer;
begin
  for m in select * from public.matches where season_id = p_season and bracket_code is not null order by phase, bracket_code loop
    v_home := private.source_club(p_season, m.home_source, m.home_club);
    v_away := private.source_club(p_season, m.away_source, m.away_club);
    if (v_home, v_away) is distinct from (m.home_club, m.away_club) then
      if m.status = 'played' then raise exception 'Primero hay que borrar el resultado de %', m.bracket_code using errcode = 'P0001'; end if;
      update public.matches set home_club = v_home, away_club = v_away where id = m.id;
    end if;
  end loop;
end $$;

create function public.admin_generate_fixture(p_season integer, p_replace boolean default false) returns integer
language plpgsql set search_path = '' as $$
declare v_clubs integer[]; n integer; m integer; r integer; x integer; y integer; v_rounds integer; v_home integer; v_away integer; v_total integer := 0; leg integer;
begin
  perform private.require_admin();
  if exists (select 1 from public.matches where season_id = p_season and status = 'played') then
    raise exception 'La temporada ya tiene resultados cargados' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.matches where season_id = p_season) and not p_replace then
    raise exception 'La temporada ya tiene fixture' using errcode = 'P0001';
  end if;
  delete from public.matches where season_id = p_season;
  select array_agg(club_id order by random()) into v_clubs from public.season_clubs where season_id = p_season and is_active;
  n := coalesce(cardinality(v_clubs), 0);
  if n < 2 then raise exception 'Hacen falta al menos 2 clubes activos' using errcode = 'P0001'; end if;
  m := case when n % 2 = 1 then n else n - 1 end;
  select rounds into v_rounds from public.season_rules where season_id = p_season;
  for leg in 0 .. coalesce(v_rounds, 1) - 1 loop
    for r in 0 .. m - 1 loop
      for x in 0 .. m - 2 loop
        for y in x + 1 .. m - 1 loop
          if (x + y) % m = (2 * r) % m then
            if (y - x) <= (m - 1) / 2 then v_home := v_clubs[x + 1]; v_away := v_clubs[y + 1]; else v_home := v_clubs[y + 1]; v_away := v_clubs[x + 1]; end if;
            if leg = 1 then select v_away, v_home into v_home, v_away; end if;
            insert into public.matches (season_id, round, home_club, away_club) values (p_season, leg * m + r + 1, v_home, v_away);
            v_total := v_total + 1;
          end if;
        end loop;
      end loop;
      if n % 2 = 0 then
        if (r % 2 = 0) = (leg = 0) then v_home := v_clubs[n]; v_away := v_clubs[r + 1]; else v_home := v_clubs[r + 1]; v_away := v_clubs[n]; end if;
        insert into public.matches (season_id, round, home_club, away_club) values (p_season, leg * m + r + 1, v_home, v_away);
        v_total := v_total + 1;
      end if;
    end loop;
  end loop;
  update public.seasons set status = 'regular', started_at = coalesce(started_at, now()) where id = p_season and status = 'draft';
  return v_total;
end $$;

create function public.admin_save_result(p_match bigint, p_home integer, p_away integer, p_home_penalties integer default null, p_away_penalties integer default null, p_events jsonb default '[]', p_notes text default null) returns void
language plpgsql set search_path = '' as $$
declare m public.matches; v_home_scored integer; v_away_scored integer;
begin
  perform private.require_admin();
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'El partido no existe' using errcode = 'P0001'; end if;
  if m.home_club is null or m.away_club is null then raise exception 'Este cruce todavía no tiene rivales' using errcode = 'P0001'; end if;
  update public.matches set status = 'played', home_goals = p_home, away_goals = p_away, home_penalties = p_home_penalties, away_penalties = p_away_penalties, notes = p_notes where id = p_match;
  delete from public.match_events where match_id = p_match;
  insert into public.match_events (match_id, kind, club_id, player_id, raw_player_name, minute)
  select p_match, (e->>'kind')::public.match_event_kind, (e->>'club_id')::integer, nullif(e->>'player_id', '')::integer, nullif(e->>'raw_player_name', ''), nullif(e->>'minute', '')::smallint
  from jsonb_array_elements(coalesce(p_events, '[]')) e;
  if exists (select 1 from public.match_events where match_id = p_match and club_id not in (m.home_club, m.away_club)) then
    raise exception 'Hay eventos de un club que no juega este partido' using errcode = 'P0001';
  end if;
  select count(*) filter (where (kind = 'goal' and club_id = m.home_club) or (kind = 'own_goal' and club_id = m.away_club)),
         count(*) filter (where (kind = 'goal' and club_id = m.away_club) or (kind = 'own_goal' and club_id = m.home_club))
    into v_home_scored, v_away_scored from public.match_events where match_id = p_match;
  if v_home_scored > p_home or v_away_scored > p_away then
    raise exception 'Hay más goleadores que goles' using errcode = 'P0001';
  end if;
  perform private.advance_bracket(m.season_id);
end $$;

create function public.admin_clear_result(p_match bigint) returns void
language plpgsql set search_path = '' as $$
declare v_season integer;
begin
  perform private.require_admin();
  select season_id into v_season from public.matches where id = p_match for update;
  if v_season is null then raise exception 'El partido no existe' using errcode = 'P0001'; end if;
  delete from public.match_events where match_id = p_match;
  update public.matches set status = 'scheduled', home_goals = null, away_goals = null, home_penalties = null, away_penalties = null where id = p_match;
  perform private.advance_bracket(v_season);
end $$;

create function public.admin_seed_playoffs(p_season integer) returns integer
language plpgsql set search_path = '' as $$
declare n integer; seeds integer[];
begin
  perform private.require_admin();
  if not exists (select 1 from public.matches where season_id = p_season and phase = 'regular') or exists (select 1 from public.matches where season_id = p_season and phase = 'regular' and status <> 'played') then
    raise exception 'Faltan resultados de la fase regular' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.matches where season_id = p_season and phase <> 'regular' and status = 'played') then
    raise exception 'Los playoffs ya tienen resultados' using errcode = 'P0001';
  end if;
  select array_agg(s.club_id order by s.table_position) into seeds from public.season_standings(p_season) s;
  n := coalesce(cardinality(seeds), 0);
  if n < 6 then raise exception 'Los playoffs necesitan al menos 6 clubes' using errcode = 'P0001'; end if;
  delete from public.matches where season_id = p_season and phase <> 'regular';
  insert into public.matches (season_id, phase, bracket_code, home_club, away_club, home_source, away_source) values
    (p_season, 'quarterfinal', 'QA', seeds[3], seeds[6], 'seed:3', 'seed:6'),
    (p_season, 'quarterfinal', 'QB', seeds[4], seeds[5], 'seed:4', 'seed:5'),
    (p_season, 'semifinal', 'S1', seeds[1], null, 'seed:1', 'winner:QB'),
    (p_season, 'semifinal', 'S2', seeds[2], null, 'seed:2', 'winner:QA'),
    (p_season, 'final', 'F', null, null, 'winner:S1', 'winner:S2');
  if n >= 10 then
    insert into public.matches (season_id, phase, bracket_code, home_club, away_club, home_source, away_source) values
      (p_season, 'relegation', 'RA', seeds[n], seeds[n - 3], 'seed:' || n, 'seed:' || (n - 3)),
      (p_season, 'relegation', 'RB', seeds[n - 2], seeds[n - 1], 'seed:' || (n - 2), 'seed:' || (n - 1));
  end if;
  update public.seasons set status = 'playoffs' where id = p_season;
  return n;
end $$;

create function public.admin_set_tie(p_season integer, p_code text, p_home integer, p_away integer) returns void
language plpgsql set search_path = '' as $$
declare v_phase public.match_phase;
begin
  perform private.require_admin();
  if p_code not in ('QA','QB','S1','S2','F','RA','RB') then raise exception 'Cruce desconocido' using errcode = 'P0001'; end if;
  v_phase := case left(p_code, 1) when 'Q' then 'quarterfinal' when 'S' then 'semifinal' when 'F' then 'final' else 'relegation' end;
  if exists (select 1 from public.matches where season_id = p_season and bracket_code = p_code and status = 'played') then
    raise exception 'Primero hay que borrar el resultado del cruce' using errcode = 'P0001';
  end if;
  insert into public.matches (season_id, phase, bracket_code, home_club, away_club, home_source, away_source)
  values (p_season, v_phase, p_code, p_home, p_away, 'manual', 'manual')
  on conflict (season_id, bracket_code) where bracket_code is not null
  do update set home_club = excluded.home_club, away_club = excluded.away_club, home_source = 'manual', away_source = 'manual';
end $$;

create function public.admin_close_season(p_season integer) returns void
language plpgsql set search_path = '' as $$
declare v_final public.matches; v_runner integer; v_rules public.season_rules; r record; v_prize numeric; v_relegated integer[];
begin
  perform private.require_admin();
  if exists (select 1 from public.seasons where id = p_season and status = 'closed') then raise exception 'La temporada ya está cerrada' using errcode = 'P0001'; end if;
  select * into v_final from public.matches where season_id = p_season and bracket_code = 'F';
  if not found or v_final.status <> 'played' then raise exception 'Falta jugar la final' using errcode = 'P0001'; end if;
  if exists (select 1 from public.matches where season_id = p_season and status <> 'played') then raise exception 'Quedan partidos sin resultado' using errcode = 'P0001'; end if;
  select * into v_rules from public.season_rules where season_id = p_season;
  v_runner := case when v_final.winner_club = v_final.home_club then v_final.away_club else v_final.home_club end;
  select coalesce(array_agg(case when winner_club = home_club then away_club else home_club end), '{}') into v_relegated
    from public.matches where season_id = p_season and bracket_code in ('RA','RB');
  delete from public.season_table_snapshots where season_id = p_season;
  for r in
    with st as (select * from public.season_standings(p_season)),
    losers as (select case when winner_club = home_club then away_club else home_club end as club_id, phase, bracket_code from public.matches where season_id = p_season and phase <> 'regular'),
    grouped as (
      select st.*, case
        when st.club_id = v_final.winner_club then 1 when st.club_id = v_runner then 2
        when exists (select 1 from losers l where l.club_id = st.club_id and l.phase = 'semifinal') then 3
        when exists (select 1 from losers l where l.club_id = st.club_id and l.phase = 'quarterfinal') then 4
        when st.club_id = any(v_relegated) then 7
        when exists (select 1 from public.matches m where m.season_id = p_season and m.phase = 'relegation' and st.club_id in (m.home_club, m.away_club)) then 6
        else 5 end as grp from st)
    select g.*, row_number() over (order by g.grp, g.table_position) as final_rank from grouped g
  loop
    insert into public.season_table_snapshots (season_id, club_id, club_name, position, played, won, drawn, lost, goals_for, goals_against, points, final_rank)
    values (p_season, r.club_id, r.club_name, r.table_position, r.played, r.won, r.drawn, r.lost, r.goals_for, r.goals_against, r.points, r.final_rank);
    v_prize := coalesce(v_rules.league_prizes[r.table_position], 0) + coalesce(v_rules.playoff_prizes[case when r.grp <= 4 then r.grp else 5 end], 0);
    if v_prize > 0 then
      insert into public.club_ledger (club_id, season_id, kind, amount, note, created_by)
      values (r.club_id, p_season, 'prize', v_prize, 'Premio de fin de temporada', (select auth.uid()));
    end if;
  end loop;
  delete from public.season_scorer_snapshots where season_id = p_season;
  insert into public.season_scorer_snapshots (season_id, club_id, player_id, raw_player_name, goals)
  select p_season, e.club_id, e.player_id, coalesce(p.name, e.raw_player_name), count(*)
  from public.match_events e join public.matches m on m.id = e.match_id left join public.players p on p.id = e.player_id
  where m.season_id = p_season and e.kind = 'goal' group by e.club_id, e.player_id, coalesce(p.name, e.raw_player_name);
  insert into public.season_archives (season_id, champion_club, runner_up_club, relegated_clubs, final_score, source, closed_by)
  values (p_season, v_final.winner_club, v_runner, v_relegated,
    (select h.name || ' ' || v_final.home_goals || '-' || v_final.away_goals || ' ' || a.name from public.clubs h, public.clubs a where h.id = v_final.home_club and a.id = v_final.away_club),
    'verified', (select auth.uid()))
  on conflict (season_id) do update set champion_club = excluded.champion_club, runner_up_club = excluded.runner_up_club, relegated_clubs = excluded.relegated_clubs, final_score = excluded.final_score, source = excluded.source, closed_by = excluded.closed_by;
  update public.seasons set status = 'closed', closed_at = now() where id = p_season;
end $$;

create function public.admin_create_next_season() returns integer
language plpgsql set search_path = '' as $$
declare v_old public.seasons; v_new integer;
begin
  perform private.require_admin();
  select * into v_old from public.seasons where is_current;
  if v_old.status <> 'closed' then raise exception 'Primero hay que cerrar la temporada actual' using errcode = 'P0001'; end if;
  update public.seasons set is_current = false where id = v_old.id;
  insert into public.seasons (number, status, is_current) values (v_old.number + 1, 'draft', true) returning id into v_new;
  insert into public.season_rules (season_id, squad_size, starters, bench, budget, enforce_balance, star_rating, required_stars, clause_premium_pct, release_discount_pct, points_win, points_draw, points_loss, rounds, tiebreakers, playoff_spots, relegation_spots, league_prizes, playoff_prizes)
  select v_new, squad_size, starters, bench, budget, enforce_balance, star_rating, required_stars, clause_premium_pct, release_discount_pct, points_win, points_draw, points_loss, rounds, tiebreakers, playoff_spots, relegation_spots, league_prizes, playoff_prizes
  from public.season_rules where season_id = v_old.id;
  insert into public.price_scales (season_id, overall, value) select v_new, overall, value from public.price_scales where season_id = v_old.id;
  insert into public.season_clubs (season_id, club_id, is_active) select v_new, club_id, is_active from public.season_clubs where season_id = v_old.id;
  insert into public.lineups (club_id, season_id, formation) select l.club_id, v_new, l.formation from public.lineups l where l.season_id = v_old.id;
  insert into public.lineup_slots (lineup_id, slot, player_id, position_id, x, y)
  select n.id, s.slot, s.player_id, s.position_id, s.x, s.y from public.lineup_slots s
  join public.lineups o on o.id = s.lineup_id and o.season_id = v_old.id
  join public.lineups n on n.club_id = o.club_id and n.season_id = v_new;
  return v_new;
end $$;

create function public.save_lineup(p_club integer, p_formation text, p_slots jsonb) returns integer
language plpgsql set search_path = '' as $$
declare v_season integer; v_lineup integer;
begin
  if not (private.is_admin() or private.my_club_id() = p_club) then raise exception 'Solo podés editar tu club' using errcode = '42501'; end if;
  select id into v_season from public.seasons where is_current;
  insert into public.lineups (club_id, season_id, formation) values (p_club, v_season, p_formation)
  on conflict (club_id, season_id) do update set formation = excluded.formation returning id into v_lineup;
  delete from public.lineup_slots where lineup_id = v_lineup;
  insert into public.lineup_slots (lineup_id, slot, player_id, position_id, x, y)
  select v_lineup, (s->>'slot')::smallint, nullif(s->>'player_id', '')::integer, nullif(s->>'position_id', '')::smallint, nullif(s->>'x', '')::numeric, nullif(s->>'y', '')::numeric
  from jsonb_array_elements(p_slots) s;
  return v_lineup;
end $$;

create function public.set_lineup_status(p_club integer, p_status public.lineup_status) returns void
language plpgsql set search_path = '' as $$
declare v_rules public.season_rules; v_season integer; v_count integer; v_stars integer; v_over integer; v_starters integer; v_placed integer;
begin
  if not (private.is_admin() or private.my_club_id() = p_club) then raise exception 'Solo podés editar tu club' using errcode = '42501'; end if;
  select id into v_season from public.seasons where is_current;
  select * into v_rules from public.season_rules where season_id = v_season;
  if p_status = 'submitted' then
    select count(*), count(*) filter (where p.overall = v_rules.star_rating), count(*) filter (where p.overall > v_rules.star_rating)
      into v_count, v_stars, v_over from public.squad_memberships m join public.players p on p.id = m.player_id where m.club_id = p_club and m.left_at is null;
    select count(*) filter (where s.slot < v_rules.starters and s.player_id is not null), count(s.player_id) into v_starters, v_placed
      from public.lineups l join public.lineup_slots s on s.lineup_id = l.id where l.club_id = p_club and l.season_id = v_season;
    if v_count <> v_rules.squad_size then raise exception 'La plantilla debe tener % jugadores', v_rules.squad_size using errcode = 'P0001'; end if;
    if v_stars <> v_rules.required_stars then raise exception 'Debe haber % jugador de media %', v_rules.required_stars, v_rules.star_rating using errcode = 'P0001'; end if;
    if v_over > 0 then raise exception 'Hay jugadores por encima de la media permitida' using errcode = 'P0001'; end if;
    if v_starters <> v_rules.starters or v_placed <> v_count then raise exception 'Faltan ubicar jugadores en la alineación' using errcode = 'P0001'; end if;
  end if;
  update public.lineups set status = p_status where club_id = p_club and season_id = v_season;
end $$;

create function private.market_context(p_club integer, out v_season integer, out v_window integer, out v_rules public.season_rules)
language plpgsql set search_path = '' as $$
begin
  if not (private.is_admin() or private.my_club_id() = p_club) then raise exception 'Solo podés operar con tu club' using errcode = '42501'; end if;
  select id into v_season from public.seasons where is_current;
  select id into v_window from public.market_windows where is_open and season_id = v_season and (closes_at is null or closes_at > now());
  if v_window is null then raise exception 'El mercado está cerrado' using errcode = 'P0001'; end if;
  select * into v_rules from public.season_rules where season_id = v_season;
  perform 1 from public.clubs where id = p_club for update;
end $$;

create function private.sign_free_player(p_club integer, p_player integer) returns numeric
language plpgsql security definer set search_path = '' as $$
declare c record; d record; v_balance numeric; v_transfer bigint; v_stars integer;
begin
  select * into c from private.market_context(p_club);
  select * into d from public.player_directory where id = p_player;
  if not found then raise exception 'El jugador no existe' using errcode = 'P0001'; end if;
  if not d.is_eligible or d.market_value is null then raise exception 'Este jugador no es elegible' using errcode = 'P0001'; end if;
  if d.club_id is not null then raise exception 'Este jugador ya tiene club' using errcode = 'P0001'; end if;
  if d.reserved_club_id is not null then raise exception 'Este jugador está reservado' using errcode = 'P0001'; end if;
  if d.overall = (c.v_rules).star_rating then
    select count(*) into v_stars from public.squad_memberships m join public.players p on p.id = m.player_id where m.club_id = p_club and m.left_at is null and p.overall = (c.v_rules).star_rating;
    if v_stars >= (c.v_rules).required_stars then raise exception 'Ya tenés el jugador de media % permitido', (c.v_rules).star_rating using errcode = 'P0001'; end if;
  end if;
  select coalesce(sum(amount), 0) into v_balance from public.club_ledger where club_id = p_club;
  if (c.v_rules).enforce_balance and d.market_value > v_balance then raise exception 'Saldo insuficiente: tenés % M', v_balance using errcode = 'P0001'; end if;
  insert into public.squad_memberships (club_id, player_id, acquisition) values (p_club, p_player, 'signing');
  insert into public.transfers (season_id, window_id, kind, player_id, to_club, amount) values (c.v_season, c.v_window, 'free_signing', p_player, p_club, d.market_value) returning id into v_transfer;
  insert into public.club_ledger (club_id, season_id, kind, amount, transfer_id, created_by) values (p_club, c.v_season, 'signing', -d.market_value, v_transfer, (select auth.uid()));
  update public.lineups set status = 'draft' where club_id = p_club and season_id = c.v_season;
  return v_balance - d.market_value;
end $$;

create function private.release_player(p_club integer, p_player integer) returns numeric
language plpgsql security definer set search_path = '' as $$
declare c record; d record; v_amount numeric; v_transfer bigint;
begin
  select * into c from private.market_context(p_club);
  select * into d from public.player_directory where id = p_player;
  if not found or d.club_id is distinct from p_club then raise exception 'El jugador no pertenece a este club' using errcode = 'P0001'; end if;
  if exists (select 1 from public.squad_adjustments a where a.player_id = p_player and a.club_id = p_club and a.action = 'remove' and a.status = 'pending') then
    raise exception 'Este jugador ya fue vendido: quitalo desde Por completar' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.loans l where l.player_id = p_player and l.status in ('active','returning')) then raise exception 'Este jugador está a préstamo' using errcode = 'P0001'; end if;
  v_amount := round(coalesce(d.market_value, 0) * (1 - (c.v_rules).release_discount_pct / 100), 1);
  update public.lineups set status = 'draft' where club_id = p_club and season_id = c.v_season;
  update public.lineup_slots s set player_id = null from public.lineups l where l.id = s.lineup_id and l.club_id = p_club and s.player_id = p_player;
  update public.squad_memberships set left_at = now() where player_id = p_player and club_id = p_club and left_at is null;
  insert into public.transfers (season_id, window_id, kind, player_id, from_club, amount) values (c.v_season, c.v_window, 'club_release', p_player, p_club, v_amount) returning id into v_transfer;
  insert into public.club_ledger (club_id, season_id, kind, amount, transfer_id, created_by) values (p_club, c.v_season, 'release', v_amount, v_transfer, (select auth.uid()));
  return v_amount;
end $$;

create function public.sign_free_player(p_club integer, p_player integer) returns numeric language sql security invoker set search_path = '' as $$ select private.sign_free_player(p_club, p_player) $$;
create function public.release_player(p_club integer, p_player integer) returns numeric language sql security invoker set search_path = '' as $$ select private.release_player(p_club, p_player) $$;

revoke all on function private.require_admin(), private.source_club(integer, text, integer), private.advance_bracket(integer), private.market_context(integer), private.sign_free_player(integer, integer), private.release_player(integer, integer) from public, anon;
grant execute on function private.require_admin(), private.source_club(integer, text, integer), private.advance_bracket(integer), private.market_context(integer), private.sign_free_player(integer, integer), private.release_player(integer, integer) to authenticated;
revoke all on function public.admin_generate_fixture(integer, boolean), public.admin_save_result(bigint, integer, integer, integer, integer, jsonb, text), public.admin_clear_result(bigint), public.admin_seed_playoffs(integer), public.admin_set_tie(integer, text, integer, integer), public.admin_close_season(integer), public.admin_create_next_season(), public.save_lineup(integer, text, jsonb), public.set_lineup_status(integer, public.lineup_status), public.sign_free_player(integer, integer), public.release_player(integer, integer) from public, anon;
grant execute on function public.admin_generate_fixture(integer, boolean), public.admin_save_result(bigint, integer, integer, integer, integer, jsonb, text), public.admin_clear_result(bigint), public.admin_seed_playoffs(integer), public.admin_set_tie(integer, text, integer, integer), public.admin_close_season(integer), public.admin_create_next_season(), public.save_lineup(integer, text, jsonb), public.set_lineup_status(integer, public.lineup_status), public.sign_free_player(integer, integer), public.release_player(integer, integer) to authenticated;

insert into public.club_ledger (club_id, season_id, kind, amount, note)
select v.c, s.id, 'opening', v.a, 'Saldo mostrado por la web anterior el 18/11/2026'
from public.seasons s cross join (values (1,1.4),(2,33.6),(3,2.4),(4,0.8),(5,20.8),(6,0.4),(7,7.2),(8,9.6),(9,7.2),(10,3.4),(11,150.0)) v(c, a)
where s.is_current;
