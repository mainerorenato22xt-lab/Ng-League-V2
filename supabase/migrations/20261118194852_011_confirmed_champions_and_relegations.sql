-- Campeones de las temporadas 1 a 7 y descensos totales confirmados por el administrador.
create table public.legacy_relegation_totals (
  club_id integer primary key references public.clubs(id) on delete cascade,
  relegations smallint not null check (relegations >= 0),
  through_season integer not null,
  note text
);
alter table public.legacy_relegation_totals enable row level security;
create policy public_read on public.legacy_relegation_totals for select to anon, authenticated using (true);
create policy admin_insert on public.legacy_relegation_totals for insert to authenticated with check ((select private.is_admin()));
create policy admin_update on public.legacy_relegation_totals for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy admin_delete on public.legacy_relegation_totals for delete to authenticated using ((select private.is_admin()));
grant select on public.legacy_relegation_totals to anon, authenticated;
grant insert, update, delete on public.legacy_relegation_totals to authenticated;
create trigger write_audit after insert or update or delete on public.legacy_relegation_totals for each row execute function private.write_audit();

create or replace view public.club_honours with (security_invoker = true) as
select cl.id as club_id, cl.name as club_name,
  greatest(coalesce(lt.titles::integer, 0) - count(*) filter (where a.champion_club = cl.id and s.number <= lt.through_season), 0::bigint)::integer
    + count(*) filter (where a.champion_club = cl.id)::integer as titles,
  count(*) filter (where a.runner_up_club = cl.id)::integer as runner_ups,
  greatest(coalesce(lr.relegations::integer, 0) - count(*) filter (where cl.id = any(a.relegated_clubs) and s.number <= lr.through_season), 0::bigint)::integer
    + count(*) filter (where cl.id = any(a.relegated_clubs))::integer as symbolic_relegations
from public.clubs cl
left join public.legacy_title_totals lt on lt.club_id = cl.id
left join public.legacy_relegation_totals lr on lr.club_id = cl.id
left join public.season_archives a on true
left join public.seasons s on s.id = a.season_id
group by cl.id, cl.name, lt.titles, lt.through_season, lr.relegations, lr.through_season;

insert into public.legacy_relegation_totals (club_id, relegations, through_season, note) values
  (2, 1, 8, 'Total confirmado por el administrador'),
  (6, 2, 8, 'Total confirmado por el administrador'),
  (9, 4, 8, 'Total confirmado por el administrador'),
  (10, 1, 8, 'Total confirmado por el administrador');

insert into public.season_archives (season_id, champion_club, source)
select s.id, c.club, 'verified'::public.data_quality
from (values (1, 2), (2, 3), (3, 3), (4, 1), (5, 3), (6, 2), (7, 5)) as c(season_number, club)
join public.seasons s on s.number = c.season_number;

update public.seasons
set data_quality = 'partial', notes = 'Campeón confirmado por el administrador. Sin tabla, final ni partidos registrados.'
where number between 1 and 7;
