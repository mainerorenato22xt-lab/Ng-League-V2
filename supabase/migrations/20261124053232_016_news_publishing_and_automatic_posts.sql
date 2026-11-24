-- Publicación de noticias por DT y administrador, me gusta y noticias automáticas.
alter table public.news_posts
  add column auto_key text unique,
  add column link_path text check (link_path is null or link_path ~ '^/[A-Za-z0-9/_?=&.-]*$'),
  add column legacy_likes integer not null default 0 check (legacy_likes >= 0);
create index if not exists news_posts_published_idx on public.news_posts (published_at desc) where status = 'published';
create index if not exists news_posts_club_idx on public.news_posts (club_id);
create index if not exists news_posts_author_idx on public.news_posts (author_id);

create function private.prepare_news_post() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_name text;
begin
  if v_uid is null then return new; end if;
  if tg_op = 'INSERT' then
    new.author_id := v_uid;
    select coalesce((select c.name from public.coaches c where c.profile_id = v_uid limit 1), p.display_name, 'NG League')
      into v_name from public.profiles p where p.id = v_uid;
    new.author_name := coalesce(v_name, 'NG League');
    new.published_at := now();
  else
    new.author_id := old.author_id; new.author_name := old.author_name; new.published_at := old.published_at;
    new.legacy_id := old.legacy_id; new.legacy_likes := old.legacy_likes;
  end if;
  if not private.is_admin() then
    new.auto_key := case when tg_op = 'INSERT' then null else old.auto_key end;
    new.link_path := case when tg_op = 'INSERT' then null else old.link_path end;
    if new.status = 'hidden' then new.status := case when tg_op = 'INSERT' then 'published' else old.status end; end if;
  end if;
  return new;
end $$;
create trigger prepare_news_post before insert or update on public.news_posts for each row execute function private.prepare_news_post();

drop policy news_insert on public.news_posts;
drop policy news_update on public.news_posts;
drop policy news_delete on public.news_posts;
create policy news_insert on public.news_posts for insert to authenticated with check (
  (select private.is_admin()) or (club_id = (select private.my_club_id()) and category <> 'official' and auto_key is null));
create policy news_update on public.news_posts for update to authenticated
  using ((select private.is_admin()) or (club_id = (select private.my_club_id()) and auto_key is null))
  with check ((select private.is_admin()) or (club_id = (select private.my_club_id()) and category <> 'official' and auto_key is null));
create policy news_delete on public.news_posts for delete to authenticated
  using ((select private.is_admin()) or (club_id = (select private.my_club_id()) and auto_key is null));

create view public.news_feed with (security_invoker = true) as
select n.id, n.club_id, n.author_name, n.category, n.title, n.body, n.image_path, n.status, n.published_at, n.auto_key is not null as is_auto, n.link_path,
  n.legacy_likes + (select count(*) from public.post_likes l where l.post_id = n.id)::integer as likes,
  exists (select 1 from public.post_likes l where l.post_id = n.id and l.user_id = (select auth.uid())) as liked
from public.news_posts n;
grant select on public.news_feed to anon, authenticated;

create function private.auto_news(p_key text, p_club integer, p_category public.news_category, p_title text, p_body text, p_link text) returns void
language sql security definer set search_path = '' as $$
  insert into public.news_posts (auto_key, club_id, category, title, body, link_path, author_name, status)
  values (p_key, p_club, p_category, p_title, p_body, p_link, 'NG League', 'published')
  on conflict (auto_key) do update set club_id = excluded.club_id, title = excluded.title, body = excluded.body, link_path = excluded.link_path;
$$;

create function private.news_from_transfer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_player text; v_from text; v_to text; v_amount text;
begin
  if new.kind not in ('purchase', 'free_signing', 'club_release') then return null; end if;
  select name into v_player from public.players where id = new.player_id;
  select name into v_from from public.clubs where id = new.from_club;
  select name into v_to from public.clubs where id = new.to_club;
  v_amount := replace(regexp_replace(to_char(new.amount, 'FM999990.0'), '\.0$', ''), '.', ',') || ' M';
  if new.kind = 'purchase' then
    perform private.auto_news('transfer:' || new.id, new.to_club, 'transfer', v_to || ' compró a ' || v_player,
      v_to || ' compró a ' || v_player || ' a ' || v_from || ' por ' || v_amount || '.', '/jugadores/' || new.player_id);
  elsif new.kind = 'free_signing' then
    perform private.auto_news('transfer:' || new.id, new.to_club, 'transfer', v_to || ' fichó a ' || v_player,
      v_to || ' fichó a ' || v_player || ', que estaba libre, por ' || v_amount || '.', '/jugadores/' || new.player_id);
  else
    perform private.auto_news('transfer:' || new.id, new.from_club, 'transfer', v_from || ' dejó libre a ' || v_player,
      v_from || ' dejó libre a ' || v_player || ' y recibió ' || v_amount || '.', '/jugadores/' || new.player_id);
  end if;
  return null;
end $$;
create trigger news_from_transfer after insert on public.transfers for each row execute function private.news_from_transfer();

create function private.news_from_match() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_home text; v_away text; v_stage text; v_score text; v_season integer;
begin
  if new.status <> 'played' then
    if old.status = 'played' then delete from public.news_posts where auto_key = 'match:' || new.id; end if;
    return null;
  end if;
  if old.status = 'played' and old.home_goals is not distinct from new.home_goals and old.away_goals is not distinct from new.away_goals
     and old.home_penalties is not distinct from new.home_penalties and old.away_penalties is not distinct from new.away_penalties then return null; end if;
  select name into v_home from public.clubs where id = new.home_club;
  select name into v_away from public.clubs where id = new.away_club;
  select number into v_season from public.seasons where id = new.season_id;
  v_stage := case new.phase when 'regular' then 'Fecha ' || new.round when 'quarterfinal' then 'Cuartos de final' when 'semifinal' then 'Semifinal'
    when 'final' then 'Final' else 'Playoffs por el descenso' end;
  v_score := v_home || ' ' || new.home_goals || '-' || new.away_goals || ' ' || v_away
    || case when new.home_penalties is not null then ' (' || new.home_penalties || '-' || new.away_penalties || ' en penales)' else '' end;
  perform private.auto_news('match:' || new.id, null, 'result', v_score, v_stage || ', temporada ' || v_season || '.', '/partidos/' || new.id);
  return null;
end $$;
create trigger news_from_match after update of status, home_goals, away_goals, home_penalties, away_penalties on public.matches
  for each row execute function private.news_from_match();

create function private.news_from_archive() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_club text; v_season integer;
begin
  if new.champion_club is null then return null; end if;
  select name into v_club from public.clubs where id = new.champion_club;
  select number into v_season from public.seasons where id = new.season_id;
  perform private.auto_news('champion:' || new.season_id, new.champion_club, 'official', v_club || ', campeón de la temporada ' || v_season,
    v_club || ' es el campeón de la temporada ' || v_season || ' de NG League' || coalesce(', con la final ' || new.final_score, '') || '.', '/temporadas/' || v_season);
  return null;
end $$;
create trigger news_from_archive after insert on public.season_archives for each row execute function private.news_from_archive();

revoke all on function private.prepare_news_post(), private.auto_news(text, integer, public.news_category, text, text, text), private.news_from_transfer(), private.news_from_match(), private.news_from_archive() from public, anon, authenticated;
