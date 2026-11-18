create table public.squad_adjustments (
  id bigint generated always as identity primary key,
  club_id integer not null references public.clubs(id),
  player_id integer not null references public.players(id),
  action text not null check (action in ('incorporate','remove')),
  status text not null default 'pending' check (status in ('pending','done','cancelled')),
  note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index squad_adjustments_one_pending on public.squad_adjustments (player_id, action) where status = 'pending';
create index squad_adjustments_club_idx on public.squad_adjustments (club_id);
create index squad_adjustments_resolved_by_idx on public.squad_adjustments (resolved_by);

alter table public.squad_adjustments enable row level security;
create policy public_read on public.squad_adjustments for select to anon, authenticated using (true);
create policy admin_insert on public.squad_adjustments for insert to authenticated with check ((select private.is_admin()));
create policy admin_update on public.squad_adjustments for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy admin_delete on public.squad_adjustments for delete to authenticated using ((select private.is_admin()));
grant select on public.squad_adjustments to anon, authenticated;
grant insert, update, delete on public.squad_adjustments to authenticated;
create trigger write_audit after insert or update or delete on public.squad_adjustments
  for each row execute function private.write_audit();

create function private.guard_reserved_player() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.squad_adjustments a
             where a.player_id = new.player_id and a.action = 'incorporate' and a.status = 'pending' and a.club_id <> new.club_id) then
    raise exception 'Este jugador está reservado para otro club' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_reserved_player before insert on public.squad_memberships
  for each row execute function private.guard_reserved_player();

create function private.apply_squad_adjustment(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.squad_adjustments; v_season integer;
begin
  select * into a from public.squad_adjustments where id = p_id for update;
  if not found or a.status <> 'pending' then raise exception 'Este ajuste ya no está pendiente' using errcode = 'P0001'; end if;
  if not (private.is_admin() or private.my_club_id() = a.club_id) then
    raise exception 'Solo el DT del club o el administrador pueden hacerlo' using errcode = '42501';
  end if;
  select s.id into v_season from public.seasons s where s.is_current;
  update public.lineups set status = 'draft' where club_id = a.club_id and season_id = v_season and status = 'submitted';
  if a.action = 'incorporate' then
    if exists (select 1 from public.squad_memberships m where m.player_id = a.player_id and m.left_at is null) then
      raise exception 'El jugador ya pertenece a un club' using errcode = 'P0001';
    end if;
    insert into public.squad_memberships (club_id, player_id, acquisition) values (a.club_id, a.player_id, 'signing');
    insert into public.transfers (season_id, kind, player_id, to_club, amount, note)
    values (v_season, 'admin', a.player_id, a.club_id, 0, 'Incorporación de un jugador ya pagado en la web anterior');
  else
    update public.lineup_slots s set player_id = null from public.lineups l
      where l.id = s.lineup_id and l.club_id = a.club_id and s.player_id = a.player_id;
    update public.squad_memberships set left_at = now() where club_id = a.club_id and player_id = a.player_id and left_at is null;
    insert into public.transfers (season_id, kind, player_id, from_club, amount, note)
    values (v_season, 'admin', a.player_id, a.club_id, 0, 'Salida de un jugador ya vendido en la web anterior');
  end if;
  update public.squad_adjustments set status = 'done', resolved_by = (select auth.uid()), resolved_at = now() where id = a.id;
end $$;
revoke all on function private.apply_squad_adjustment(bigint) from public, anon;
grant execute on function private.apply_squad_adjustment(bigint) to authenticated;

create function public.apply_squad_adjustment(p_id bigint) returns void
language sql security invoker set search_path = '' as $$ select private.apply_squad_adjustment(p_id) $$;
revoke all on function public.apply_squad_adjustment(bigint) from public, anon;
grant execute on function public.apply_squad_adjustment(bigint) to authenticated;

create or replace view public.player_directory with (security_invoker = true) as
select p.id, p.name, p.search_name, p.country_id, c.name as country_name, p.age, p.height_cm, p.weight_kg, p.foot,
       p.main_position, pos.code as position_code, pos.line as position_line, p.secondary_positions, p.overall, p.photo_path,
       v.market_value,
       case when v.market_value > 0 then round(v.market_value * (1 + r.clause_premium_pct / 100), 1) end as release_clause,
       p.overall <= r.star_rating as is_eligible,
       m.club_id, cl.name as club_name, cl.slug as club_slug,
       (m.club_id is null and p.overall <= r.star_rating and sa.id is null) as is_available,
       sa.club_id as reserved_club_id, rc.name as reserved_club_name
from public.players p
join public.positions pos on pos.id = p.main_position
left join public.countries c on c.id = p.country_id
left join public.seasons s on s.is_current
left join public.season_rules r on r.season_id = s.id
left join public.price_scales ps on ps.season_id = s.id and ps.overall = p.overall
left join public.squad_memberships m on m.player_id = p.id and m.left_at is null
left join public.clubs cl on cl.id = m.club_id
left join public.squad_adjustments sa on sa.player_id = p.id and sa.action = 'incorporate' and sa.status = 'pending'
left join public.clubs rc on rc.id = sa.club_id
cross join lateral (select case
    when p.market_value_override is not null then p.market_value_override
    when r.star_rating is null or p.overall > r.star_rating then null
    when p.overall = r.star_rating then 0::numeric
    else coalesce(ps.value, 0) end as market_value) v
where not p.is_hidden;

insert into public.squad_adjustments (club_id, player_id, action, note)
select v.c, v.p, v.a, case v.a when 'incorporate' then 'Fichado y pagado en la web anterior' else 'Vendido al club en la web anterior; el dinero ya fue acreditado' end
from (values (1,102051,'incorporate'),(1,108512,'incorporate'),(1,130638,'incorporate'),(1,132709,'incorporate'),(1,138061,'incorporate'),(1,45596,'remove'),(1,91135,'remove'),(1,100588,'remove'),(1,159613,'remove'),(3,56195,'incorporate'),(3,100241,'incorporate'),(3,108456,'incorporate'),(6,37493,'incorporate'),(6,141212,'incorporate'),(6,147136,'incorporate'),(6,160330,'incorporate'),(6,163658,'incorporate'),(6,57351,'remove'),(6,110562,'remove'),(6,113983,'remove'),(6,126234,'remove'),(6,142980,'remove')) v(c,p,a);
