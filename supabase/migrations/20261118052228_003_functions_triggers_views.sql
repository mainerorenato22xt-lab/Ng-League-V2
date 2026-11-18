create function private.normalize_name(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(lower(translate(coalesce(p,''),
    'ÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕØÚÙÜÛÑÇáàäâãåéèëêíìïîóòöôõøúùüûñçŠšŽžĆćČčĐđŁłŃńŚśŹźŻżİığş',
    'AAAAAAEEEEIIIIOOOOOOUUUUNCaaaaaaeeeeiiiioooooouuuuncSsZzCcCcDdLlNnSsZzZzIigs')), '\s+', ' ', 'g')
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
$$;

create function private.my_club_id() returns integer
language sql stable security definer set search_path = '' as $$
  select t.club_id from public.coach_tenures t
  join public.coaches c on c.id = t.coach_id
  where c.profile_id = (select auth.uid()) and t.is_current
  limit 1
$$;
revoke all on function private.is_admin(), private.my_club_id() from public;
grant execute on function private.is_admin(), private.my_club_id() to anon, authenticated, service_role;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['clubs','profiles','players','lineups','matches','negotiations','news_posts'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()', t);
  end loop;
end $$;

create function private.handle_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_admin boolean;
begin
  v_admin := new.email_confirmed_at is not null
    and exists (select 1 from private.bootstrap_admins b where b.email = lower(new.email));
  insert into public.profiles (id, display_name, avatar_url, role)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          new.raw_user_meta_data->>'avatar_url',
          case when v_admin then 'admin'::public.user_role else 'visitor'::public.user_role end)
  on conflict (id) do update
    set role = case when v_admin then 'admin'::public.user_role else public.profiles.role end;
  return new;
end $$;
create trigger on_auth_user_saved after insert or update of email_confirmed_at on auth.users
  for each row execute function private.handle_auth_user();

create function private.guard_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null and new.role is distinct from old.role and not private.is_admin() then
    raise exception 'Solo el administrador puede cambiar roles' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_profile before update on public.profiles for each row execute function private.guard_profile();

create function private.guard_club() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not private.is_admin()
     and (new.id, new.name, new.slug, new.is_active) is distinct from (old.id, old.name, old.slug, old.is_active) then
    raise exception 'Solo el administrador puede cambiar la identidad del club' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_club before update on public.clubs for each row execute function private.guard_club();

create function private.prepare_player() returns trigger
language plpgsql set search_path = '' as $$
begin new.search_name := private.normalize_name(new.name); return new; end $$;
create trigger prepare_player before insert or update of name on public.players
  for each row execute function private.prepare_player();

create function private.guard_squad_size() returns trigger
language plpgsql set search_path = '' as $$
declare v_limit integer; v_count integer;
begin
  if new.left_at is not null then return new; end if;
  perform 1 from public.clubs c where c.id = new.club_id for update;
  select r.squad_size into v_limit from public.season_rules r
    join public.seasons s on s.id = r.season_id where s.is_current;
  select count(*) into v_count from public.squad_memberships m
    where m.club_id = new.club_id and m.left_at is null and m.id is distinct from new.id;
  if v_limit is not null and v_count >= v_limit then
    raise exception 'La plantilla ya tiene el máximo de % jugadores', v_limit using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_squad_size before insert or update of club_id, left_at on public.squad_memberships
  for each row execute function private.guard_squad_size();

create function private.guard_lineup_slot() returns trigger
language plpgsql set search_path = '' as $$
declare v_lineup_id integer; v_club integer; v_season integer; v_status public.lineup_status; v_max integer;
begin
  v_lineup_id := case when tg_op = 'DELETE' then old.lineup_id else new.lineup_id end;
  select l.club_id, l.season_id, l.status into v_club, v_season, v_status from public.lineups l where l.id = v_lineup_id;
  if v_status = 'submitted' and not private.is_admin() then
    raise exception 'La plantilla está entregada. Deshacé la entrega para editarla' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select r.starters + r.bench into v_max from public.season_rules r where r.season_id = v_season;
  if v_max is not null and new.slot >= v_max then
    raise exception 'Puesto fuera de la plantilla' using errcode = 'P0001';
  end if;
  if new.player_id is not null and not exists (
    select 1 from public.squad_memberships m
    where m.club_id = v_club and m.player_id = new.player_id and m.left_at is null) then
    raise exception 'El jugador no pertenece a este club' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_lineup_slot before insert or update or delete on public.lineup_slots
  for each row execute function private.guard_lineup_slot();

create function private.prepare_match() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  new.winner_club := null;
  if new.status <> 'played' then
    if num_nonnulls(new.home_goals, new.away_goals, new.home_penalties, new.away_penalties) > 0 then
      raise exception 'Un partido sin jugar no puede tener resultado' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.home_club is null or new.away_club is null or new.home_goals is null or new.away_goals is null then
    raise exception 'Faltan equipos o goles' using errcode = 'P0001';
  end if;
  if new.phase = 'regular' then
    if num_nonnulls(new.home_penalties, new.away_penalties) > 0 then
      raise exception 'La fase regular no tiene penales' using errcode = 'P0001';
    end if;
  elsif new.home_goals = new.away_goals then
    if new.home_penalties is null or new.away_penalties is null or new.home_penalties = new.away_penalties then
      raise exception 'Un cruce empatado necesita un ganador por penales' using errcode = 'P0001';
    end if;
  elsif num_nonnulls(new.home_penalties, new.away_penalties) > 0 then
    raise exception 'Solo hay penales si el partido terminó empatado' using errcode = 'P0001';
  end if;
  new.winner_club := case
    when new.home_goals > new.away_goals then new.home_club
    when new.away_goals > new.home_goals then new.away_club
    when new.home_penalties > new.away_penalties then new.home_club
    when new.away_penalties > new.home_penalties then new.away_club
  end;
  return new;
end $$;
create trigger prepare_match before insert or update on public.matches
  for each row execute function private.prepare_match();

create function private.write_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_key text; v_actor uuid := (select auth.uid()); v_name text;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and v_old = v_new then return null; end if;
  v_key := coalesce(v_new->>'id', v_old->>'id', v_new->>'season_id', v_old->>'season_id', v_new->>'club_id', v_old->>'club_id');
  if v_actor is not null then select p.display_name into v_name from public.profiles p where p.id = v_actor; end if;
  insert into public.audit_log (actor_id, actor_name, action, table_name, row_key, old_data, new_data)
  values (v_actor, v_name, lower(tg_op), tg_table_name, v_key, v_old, v_new);
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['clubs','club_kits','rivalries','profiles','coaches','coach_tenures','seasons','season_rules','price_scales','season_clubs',
    'legacy_title_totals','squad_memberships','lineups','matches','match_events','season_archives','awards','market_windows','negotiations',
    'loans','transfers','club_ledger','news_posts','regulations'] loop
    execute format('create trigger write_audit after insert or update or delete on public.%I for each row execute function private.write_audit()', t);
  end loop;
end $$;
create trigger write_audit after update or delete on public.players
  for each row execute function private.write_audit();

create view public.player_directory with (security_invoker = true) as
select p.id, p.name, p.search_name, p.country_id, c.name as country_name, p.age, p.height_cm, p.weight_kg, p.foot,
       p.main_position, pos.code as position_code, pos.line as position_line, p.secondary_positions, p.overall, p.photo_path,
       v.market_value,
       case when v.market_value > 0 then round(v.market_value * (1 + r.clause_premium_pct / 100), 1) end as release_clause,
       p.overall <= r.star_rating as is_eligible,
       m.club_id, cl.name as club_name, cl.slug as club_slug,
       (m.club_id is null and p.overall <= r.star_rating) as is_available
from public.players p
join public.positions pos on pos.id = p.main_position
left join public.countries c on c.id = p.country_id
left join public.seasons s on s.is_current
left join public.season_rules r on r.season_id = s.id
left join public.price_scales ps on ps.season_id = s.id and ps.overall = p.overall
left join public.squad_memberships m on m.player_id = p.id and m.left_at is null
left join public.clubs cl on cl.id = m.club_id
cross join lateral (select case
    when p.market_value_override is not null then p.market_value_override
    when r.star_rating is null or p.overall > r.star_rating then null
    when p.overall = r.star_rating then 0::numeric
    else coalesce(ps.value, 0) end as market_value) v
where not p.is_hidden;

create view public.club_squad_summary with (security_invoker = true) as
select cl.id as club_id, cl.name as club_name, count(d.id)::integer as players,
       coalesce(sum(d.market_value), 0) as squad_value,
       round(avg(d.overall), 1) as avg_overall,
       round(avg(d.overall) filter (where d.position_line = 'def'), 1) as avg_defense,
       round(avg(d.overall) filter (where d.position_line = 'mid'), 1) as avg_midfield,
       round(avg(d.overall) filter (where d.position_line = 'fwd'), 1) as avg_attack,
       round(avg(d.age), 1) as avg_age
from public.clubs cl
left join public.player_directory d on d.club_id = cl.id
group by cl.id, cl.name;

create view public.club_balances with (security_invoker = true) as
select l.club_id, sum(l.amount)::numeric(12,1) as balance
from public.club_ledger l group by l.club_id;

create view public.player_season_stats with (security_invoker = true) as
select m.season_id, e.player_id, e.club_id,
       count(*) filter (where e.kind = 'goal')::integer as goals,
       count(*) filter (where e.kind = 'assist')::integer as assists,
       count(*) filter (where e.kind = 'yellow_card')::integer as yellow_cards,
       count(*) filter (where e.kind = 'red_card')::integer as red_cards
from public.match_events e
join public.matches m on m.id = e.match_id and m.status = 'played'
where e.player_id is not null
group by m.season_id, e.player_id, e.club_id;

create view public.club_honours with (security_invoker = true) as
select cl.id as club_id, cl.name as club_name,
       greatest(coalesce(lt.titles, 0) - count(*) filter (where a.champion_club = cl.id and s.number <= lt.through_season), 0)::integer
         + count(*) filter (where a.champion_club = cl.id)::integer as titles,
       count(*) filter (where a.runner_up_club = cl.id)::integer as runner_ups,
       count(*) filter (where cl.id = any(a.relegated_clubs))::integer as symbolic_relegations
from public.clubs cl
left join public.legacy_title_totals lt on lt.club_id = cl.id
left join public.season_archives a on true
left join public.seasons s on s.id = a.season_id
group by cl.id, cl.name, lt.titles, lt.through_season;

create function public.season_standings(p_season integer)
returns table (table_position integer, club_id integer, club_name text, played integer, won integer, drawn integer, lost integer,
               goals_for integer, goals_against integer, goal_diff integer, points integer)
language sql stable set search_path = '' as $$
  with rules as (select * from public.season_rules r where r.season_id = p_season),
  entrants as (
    select sc.club_id, cl.name, sc.tiebreak_rank from public.season_clubs sc
    join public.clubs cl on cl.id = sc.club_id where sc.season_id = p_season and sc.is_active),
  games as (
    select m.home_club as club, m.away_club as rival, m.home_goals as gf, m.away_goals as ga from public.matches m
      where m.season_id = p_season and m.phase = 'regular' and m.status = 'played'
    union all
    select m.away_club, m.home_club, m.away_goals, m.home_goals from public.matches m
      where m.season_id = p_season and m.phase = 'regular' and m.status = 'played'),
  totals as (
    select e.club_id, e.name, e.tiebreak_rank, count(g.club)::integer as pj,
      count(*) filter (where g.gf > g.ga)::integer as w, count(*) filter (where g.gf = g.ga)::integer as d,
      count(*) filter (where g.gf < g.ga)::integer as l,
      coalesce(sum(g.gf), 0)::integer as gf, coalesce(sum(g.ga), 0)::integer as ga
    from entrants e left join games g on g.club = e.club_id
    group by e.club_id, e.name, e.tiebreak_rank),
  scored as (
    select t.*, (t.w * r.points_win + t.d * r.points_draw + t.l * r.points_loss)::integer as pts
    from totals t cross join rules r),
  direct as (
    select s.club_id, sum(case when g.gf > g.ga then r.points_win when g.gf = g.ga then r.points_draw else r.points_loss end)::integer as h2h
    from scored s join games g on g.club = s.club_id
    join scored o on o.club_id = g.rival and o.pts = s.pts cross join rules r
    group by s.club_id),
  keyed as (
    select s.*, array(
      select case u.criterion
        when 'points' then s.pts when 'goal_diff' then s.gf - s.ga when 'goals_for' then s.gf
        when 'goals_against' then -s.ga when 'wins' then s.w when 'head_to_head' then coalesce(dr.h2h, 0) end
      from unnest(r.tiebreakers) with ordinality as u(criterion, ord) order by u.ord) as sort_key
    from scored s left join direct dr on dr.club_id = s.club_id cross join rules r)
  select (row_number() over (order by k.sort_key desc, k.tiebreak_rank nulls last, k.name))::integer,
         k.club_id, k.name, k.pj, k.w, k.d, k.l, k.gf, k.ga, k.gf - k.ga, k.pts
  from keyed k order by 1
$$;

create function public.admin_list_users()
returns table (id uuid, email text, display_name text, role public.user_role, club_id integer, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Acceso solo para administración' using errcode = '42501'; end if;
  return query
  select p.id, u.email::text, p.display_name, p.role, t.club_id, p.created_at
  from public.profiles p join auth.users u on u.id = p.id
  left join public.coaches c on c.profile_id = p.id
  left join public.coach_tenures t on t.coach_id = c.id and t.is_current
  order by p.created_at;
end $$;

create function public.admin_assign_coach(p_user uuid, p_coach_name text, p_club integer)
returns integer language plpgsql set search_path = '' as $$
declare v_coach integer; v_season integer;
begin
  if not private.is_admin() then raise exception 'Acceso solo para administración' using errcode = '42501'; end if;
  select s.id into v_season from public.seasons s where s.is_current;
  select c.id into v_coach from public.coaches c where c.profile_id = p_user;
  if v_coach is null then
    select c.id into v_coach from public.coaches c where c.profile_id is null and lower(c.name) = lower(trim(p_coach_name)) limit 1;
    if v_coach is null then
      insert into public.coaches (name, profile_id, data_quality) values (trim(p_coach_name), p_user, 'verified') returning id into v_coach;
    else
      update public.coaches set profile_id = p_user where id = v_coach;
    end if;
  end if;
  update public.coach_tenures set is_current = false, to_season = coalesce(to_season, v_season)
    where is_current and (coach_id = v_coach or club_id = p_club) and not (coach_id = v_coach and club_id = p_club);
  if not exists (select 1 from public.coach_tenures t where t.coach_id = v_coach and t.club_id = p_club and t.is_current) then
    insert into public.coach_tenures (coach_id, club_id, from_season, is_current) values (v_coach, p_club, v_season, true);
  end if;
  update public.profiles set role = 'dt' where id = p_user and role = 'visitor';
  return v_coach;
end $$;
