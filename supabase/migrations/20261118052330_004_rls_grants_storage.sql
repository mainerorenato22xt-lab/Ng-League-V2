do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  foreach t in array array['positions','countries','clubs','club_kits','rivalries','coaches','seasons','coach_tenures','season_rules','price_scales',
    'season_clubs','legacy_title_totals','squad_memberships','lineups','lineup_slots','matches','match_events','match_lineups','season_archives',
    'season_table_snapshots','season_scorer_snapshots','awards','market_windows','loans','transfers','post_likes','regulations'] loop
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;

  foreach t in array array['positions','countries','rivalries','coaches','seasons','coach_tenures','season_rules','price_scales','season_clubs',
    'legacy_title_totals','players','squad_memberships','matches','match_events','match_lineups','season_archives','season_table_snapshots',
    'season_scorer_snapshots','awards','market_windows','loans','transfers','regulations','negotiations','negotiation_offers','club_ledger','bets'] loop
    execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select private.is_admin()))', t);
    execute format('create policy admin_update on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using ((select private.is_admin()))', t);
  end loop;

  foreach t in array array['import_batches','import_issues','legacy_ids'] loop
    execute format('create policy admin_all on public.%I for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t);
  end loop;
end $$;

create policy read_visible on public.players for select to anon, authenticated
  using (not is_hidden or (select private.is_admin()));

create policy admin_insert on public.clubs for insert to authenticated with check ((select private.is_admin()));
create policy admin_delete on public.clubs for delete to authenticated using ((select private.is_admin()));
create policy manage_own_club on public.clubs for update to authenticated
  using ((select private.is_admin()) or id = (select private.my_club_id()))
  with check ((select private.is_admin()) or id = (select private.my_club_id()));

create policy kits_insert on public.club_kits for insert to authenticated
  with check ((select private.is_admin()) or club_id = (select private.my_club_id()));
create policy kits_update on public.club_kits for update to authenticated
  using ((select private.is_admin()) or club_id = (select private.my_club_id()))
  with check ((select private.is_admin()) or club_id = (select private.my_club_id()));
create policy kits_delete on public.club_kits for delete to authenticated
  using ((select private.is_admin()) or club_id = (select private.my_club_id()));

create policy lineups_insert on public.lineups for insert to authenticated
  with check ((select private.is_admin()) or club_id = (select private.my_club_id()));
create policy lineups_update on public.lineups for update to authenticated
  using ((select private.is_admin()) or club_id = (select private.my_club_id()))
  with check ((select private.is_admin()) or club_id = (select private.my_club_id()));
create policy lineups_delete on public.lineups for delete to authenticated
  using ((select private.is_admin()) or club_id = (select private.my_club_id()));

create policy slots_insert on public.lineup_slots for insert to authenticated
  with check ((select private.is_admin()) or exists (select 1 from public.lineups l where l.id = lineup_id and l.club_id = (select private.my_club_id())));
create policy slots_update on public.lineup_slots for update to authenticated
  using ((select private.is_admin()) or exists (select 1 from public.lineups l where l.id = lineup_id and l.club_id = (select private.my_club_id())))
  with check ((select private.is_admin()) or exists (select 1 from public.lineups l where l.id = lineup_id and l.club_id = (select private.my_club_id())));
create policy slots_delete on public.lineup_slots for delete to authenticated
  using ((select private.is_admin()) or exists (select 1 from public.lineups l where l.id = lineup_id and l.club_id = (select private.my_club_id())));

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()))
  with check (id = (select auth.uid()) or (select private.is_admin()));

create policy negotiations_read on public.negotiations for select to authenticated
  using ((select private.is_admin()) or (select private.my_club_id()) in (seller_club, buyer_club));
create policy offers_read on public.negotiation_offers for select to authenticated
  using ((select private.is_admin()) or exists (select 1 from public.negotiations n
    where n.id = negotiation_id and (select private.my_club_id()) in (n.seller_club, n.buyer_club)));
create policy ledger_read on public.club_ledger for select to authenticated
  using ((select private.is_admin()) or club_id = (select private.my_club_id()));
create policy bets_read on public.bets for select to authenticated
  using ((select private.is_admin()) or user_id = (select auth.uid()));
create policy audit_read on public.audit_log for select to authenticated using ((select private.is_admin()));

create policy votes_read on public.award_votes for select to authenticated
  using ((select private.is_admin()) or voter_id = (select auth.uid()));
create policy votes_insert on public.award_votes for insert to authenticated
  with check (voter_id = (select auth.uid()) and (select private.my_club_id()) is not null);
create policy votes_update on public.award_votes for update to authenticated
  using (voter_id = (select auth.uid())) with check (voter_id = (select auth.uid()));
create policy votes_delete on public.award_votes for delete to authenticated
  using (voter_id = (select auth.uid()) or (select private.is_admin()));

create policy news_read on public.news_posts for select to anon, authenticated
  using (status = 'published' or (select private.is_admin()) or club_id = (select private.my_club_id()));
create policy news_insert on public.news_posts for insert to authenticated
  with check ((select private.is_admin()) or (club_id = (select private.my_club_id()) and author_id = (select auth.uid()) and category <> 'official'));
create policy news_update on public.news_posts for update to authenticated
  using ((select private.is_admin()) or club_id = (select private.my_club_id()))
  with check ((select private.is_admin()) or (club_id = (select private.my_club_id()) and category <> 'official'));
create policy news_delete on public.news_posts for delete to authenticated
  using ((select private.is_admin()) or club_id = (select private.my_club_id()));

create policy likes_insert on public.post_likes for insert to authenticated with check (user_id = (select auth.uid()));
create policy likes_delete on public.post_likes for delete to authenticated using (user_id = (select auth.uid()));

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.my_club_id(), private.normalize_name(text) to anon, authenticated;

grant select on public.positions, public.countries, public.clubs, public.club_kits, public.rivalries, public.coaches, public.seasons,
  public.coach_tenures, public.season_rules, public.price_scales, public.season_clubs, public.legacy_title_totals, public.players,
  public.squad_memberships, public.lineups, public.lineup_slots, public.matches, public.match_events, public.match_lineups,
  public.season_archives, public.season_table_snapshots, public.season_scorer_snapshots, public.awards, public.market_windows,
  public.loans, public.transfers, public.post_likes, public.regulations, public.news_posts,
  public.player_directory, public.club_squad_summary, public.club_honours, public.player_season_stats to anon, authenticated;
grant select on public.profiles, public.negotiations, public.negotiation_offers, public.club_ledger, public.club_balances, public.bets,
  public.award_votes, public.audit_log, public.import_batches, public.import_issues, public.legacy_ids to authenticated;
grant insert, update, delete on public.positions, public.countries, public.clubs, public.club_kits, public.rivalries, public.coaches, public.seasons,
  public.coach_tenures, public.season_rules, public.price_scales, public.season_clubs, public.legacy_title_totals, public.players,
  public.squad_memberships, public.lineups, public.lineup_slots, public.matches, public.match_events, public.match_lineups,
  public.season_archives, public.season_table_snapshots, public.season_scorer_snapshots, public.awards, public.market_windows, public.loans,
  public.transfers, public.post_likes, public.regulations, public.news_posts, public.negotiations, public.negotiation_offers, public.club_ledger,
  public.bets, public.award_votes, public.import_batches, public.import_issues, public.legacy_ids to authenticated;
grant update (display_name, avatar_url, role) on public.profiles to authenticated;
grant usage on sequence public.players_id_seq to authenticated;
grant execute on function public.season_standings(integer) to anon, authenticated;
grant execute on function public.admin_list_users(), public.admin_assign_coach(uuid, text, integer) to authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('crests','crests',true,1048576,array['image/png','image/webp','image/jpeg','image/svg+xml']),
  ('kits','kits',true,2097152,array['image/png','image/webp','image/jpeg']),
  ('players','players',true,1048576,array['image/png','image/webp','image/jpeg']),
  ('news','news',true,3145728,array['image/png','image/webp','image/jpeg']);

create policy ngl_objects_read_own on storage.objects for select to authenticated using (
  bucket_id in ('crests','kits','players','news') and ((select private.is_admin())
    or (bucket_id <> 'players' and (storage.foldername(name))[1] = (select private.my_club_id())::text)));
create policy ngl_objects_insert on storage.objects for insert to authenticated with check (
  bucket_id in ('crests','kits','players','news') and ((select private.is_admin())
    or (bucket_id <> 'players' and (storage.foldername(name))[1] = (select private.my_club_id())::text)));
create policy ngl_objects_update on storage.objects for update to authenticated using (
  bucket_id in ('crests','kits','players','news') and ((select private.is_admin())
    or (bucket_id <> 'players' and (storage.foldername(name))[1] = (select private.my_club_id())::text)));
create policy ngl_objects_delete on storage.objects for delete to authenticated using (
  bucket_id in ('crests','kits','players','news') and ((select private.is_admin())
    or (bucket_id <> 'players' and (storage.foldername(name))[1] = (select private.my_club_id())::text)));
