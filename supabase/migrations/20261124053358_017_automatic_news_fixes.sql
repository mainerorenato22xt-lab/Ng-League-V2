-- Las noticias automáticas no se alteran aunque las dispare un DT, y los montos en 0 no se mencionan.
create or replace function private.prepare_news_post() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_name text;
begin
  if v_uid is null or pg_trigger_depth() > 1 then return new; end if;
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

create or replace function private.news_from_transfer() returns trigger
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
      v_to || ' fichó a ' || v_player || ', que estaba libre' || case when new.amount > 0 then ', por ' || v_amount else '' end || '.', '/jugadores/' || new.player_id);
  else
    perform private.auto_news('transfer:' || new.id, new.from_club, 'transfer', v_from || ' dejó libre a ' || v_player,
      v_from || ' dejó libre a ' || v_player || case when new.amount > 0 then ' y recibió ' || v_amount else '' end || '.', '/jugadores/' || new.player_id);
  end if;
  return null;
end $$;

revoke all on function private.prepare_news_post(), private.news_from_transfer() from public, anon, authenticated;
