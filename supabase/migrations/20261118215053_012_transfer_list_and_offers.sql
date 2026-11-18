create table public.transfer_listings (
  player_id integer primary key references public.players(id) on delete cascade,
  club_id integer not null references public.clubs(id) on delete cascade,
  asking_price numeric check (asking_price >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index transfer_listings_club_idx on public.transfer_listings (club_id);
create index transfer_listings_created_by_idx on public.transfer_listings (created_by);
alter table public.transfer_listings enable row level security;
create policy public_read on public.transfer_listings for select to anon, authenticated using (true);
create policy admin_insert on public.transfer_listings for insert to authenticated with check ((select private.is_admin()));
create policy admin_update on public.transfer_listings for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy admin_delete on public.transfer_listings for delete to authenticated using ((select private.is_admin()));
grant select on public.transfer_listings to anon, authenticated;
grant insert, update, delete on public.transfer_listings to authenticated;
create trigger write_audit after insert or update or delete on public.transfer_listings for each row execute function private.write_audit();

create view public.transfer_market with (security_invoker = true) as
select l.player_id, l.club_id, l.asking_price, l.created_at, d.name, d.overall, d.age, d.position_code, d.market_value, d.photo_path, d.club_name, d.club_slug
from public.transfer_listings l
join public.player_directory d on d.id = l.player_id and d.club_id = l.club_id;
grant select on public.transfer_market to anon, authenticated;

create function private.on_squad_exit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.transfer_listings where player_id = new.player_id;
  update public.negotiations set status = 'cancelled'
    where player_id = new.player_id and seller_club = new.club_id and status in ('sent', 'negotiating');
  return null;
end $$;
create trigger on_squad_exit after update of left_at on public.squad_memberships
  for each row when (old.left_at is null and new.left_at is not null) execute function private.on_squad_exit();

create function private.check_buyer(p_club integer, p_overall integer, p_amount numeric, p_rules public.season_rules) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_count integer; v_in integer; v_out integer; v_stars integer; v_balance numeric;
begin
  select count(*) into v_count from public.squad_memberships m where m.club_id = p_club and m.left_at is null;
  select count(*) filter (where a.action = 'incorporate'), count(*) filter (where a.action = 'remove') into v_in, v_out
    from public.squad_adjustments a where a.club_id = p_club and a.status = 'pending';
  if v_count - v_out + v_in >= p_rules.squad_size then
    raise exception 'La plantilla ya está completa, contando las operaciones por completar' using errcode = 'P0001';
  end if;
  if p_overall = p_rules.star_rating then
    select count(*) into v_stars from public.squad_memberships m join public.players p on p.id = m.player_id
      where m.club_id = p_club and m.left_at is null and p.overall = p_rules.star_rating;
    if v_stars >= p_rules.required_stars then raise exception 'Ya tenés el jugador de media % permitido', p_rules.star_rating using errcode = 'P0001'; end if;
  end if;
  select coalesce(sum(l.amount), 0) into v_balance from public.club_ledger l where l.club_id = p_club;
  if p_rules.enforce_balance and p_amount > v_balance then raise exception 'Saldo insuficiente: tenés % M', v_balance using errcode = 'P0001'; end if;
end $$;

create function private.list_player(p_club integer, p_player integer, p_asking numeric default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  select * into c from private.market_context(p_club);
  if p_asking is not null and p_asking < 0 then raise exception 'El precio no puede ser negativo' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.squad_memberships m where m.player_id = p_player and m.club_id = p_club and m.left_at is null) then
    raise exception 'El jugador no pertenece a este club' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.squad_adjustments a where a.player_id = p_player and a.club_id = p_club and a.action = 'remove' and a.status = 'pending') then
    raise exception 'Este jugador ya fue vendido: quitalo desde Por completar' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.loans l where l.player_id = p_player and l.status in ('active', 'returning')) then
    raise exception 'Este jugador está a préstamo' using errcode = 'P0001';
  end if;
  insert into public.transfer_listings (player_id, club_id, asking_price, created_by)
  values (p_player, p_club, round(p_asking, 1), (select auth.uid()))
  on conflict (player_id) do update set club_id = excluded.club_id, asking_price = excluded.asking_price;
end $$;

create function private.unlist_player(p_club integer, p_player integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.my_club_id() = p_club) then raise exception 'Solo podés operar con tu club' using errcode = '42501'; end if;
  delete from public.transfer_listings where player_id = p_player and club_id = p_club;
  update public.negotiations set status = 'cancelled' where player_id = p_player and seller_club = p_club and status in ('sent', 'negotiating');
end $$;

create function private.make_offer(p_buyer integer, p_player integer, p_amount numeric) returns bigint
language plpgsql security definer set search_path = '' as $$
declare c record; l public.transfer_listings; v_overall integer; v_amount numeric := round(p_amount, 1); v_id bigint;
begin
  select * into c from private.market_context(p_buyer);
  if v_amount is null or v_amount <= 0 then raise exception 'La oferta tiene que ser mayor a 0' using errcode = 'P0001'; end if;
  select * into l from public.transfer_listings where player_id = p_player;
  if not found then raise exception 'Este jugador no está transferible' using errcode = 'P0001'; end if;
  if l.club_id = p_buyer then raise exception 'No podés ofertar por un jugador de tu club' using errcode = 'P0001'; end if;
  select overall into v_overall from public.players where id = p_player;
  perform private.check_buyer(p_buyer, v_overall, v_amount, c.v_rules);
  select id into v_id from public.negotiations where player_id = p_player and buyer_club = p_buyer and status in ('sent', 'negotiating') for update;
  if v_id is null then
    insert into public.negotiations (window_id, kind, player_id, seller_club, buyer_club, status, turn_club, created_by)
    values (c.v_window, 'purchase', p_player, l.club_id, p_buyer, 'sent', l.club_id, (select auth.uid())) returning id into v_id;
  end if;
  insert into public.negotiation_offers (negotiation_id, from_club, amount, created_by) values (v_id, p_buyer, v_amount, (select auth.uid()));
  return v_id;
end $$;

create function private.respond_offer(p_negotiation bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.negotiations; c record; v_amount numeric; v_overall integer; v_transfer bigint;
begin
  select * into n from public.negotiations where id = p_negotiation for update;
  if not found or n.status not in ('sent', 'negotiating') then raise exception 'Esta oferta ya no está vigente' using errcode = 'P0001'; end if;
  if not (private.is_admin() or private.my_club_id() = n.seller_club) then raise exception 'Solo el club vendedor puede responder' using errcode = '42501'; end if;
  if not p_accept then
    update public.negotiations set status = 'rejected' where id = n.id;
    return;
  end if;
  perform 1 from public.clubs where id in (n.seller_club, n.buyer_club) order by id for update;
  select * into c from private.market_context(n.seller_club);
  if not exists (select 1 from public.transfer_listings l where l.player_id = n.player_id and l.club_id = n.seller_club)
     or not exists (select 1 from public.squad_memberships m where m.player_id = n.player_id and m.club_id = n.seller_club and m.left_at is null) then
    raise exception 'Este jugador ya no está transferible' using errcode = 'P0001';
  end if;
  select o.amount into v_amount from public.negotiation_offers o where o.negotiation_id = n.id order by o.id desc limit 1;
  select overall into v_overall from public.players where id = n.player_id;
  perform private.check_buyer(n.buyer_club, v_overall, v_amount, c.v_rules);
  update public.negotiations set status = 'completed', turn_club = null where id = n.id;
  update public.lineups set status = 'draft' where club_id in (n.seller_club, n.buyer_club) and season_id = c.v_season;
  update public.lineup_slots s set player_id = null from public.lineups l where l.id = s.lineup_id and l.club_id = n.seller_club and s.player_id = n.player_id;
  update public.squad_memberships set left_at = now() where player_id = n.player_id and club_id = n.seller_club and left_at is null;
  insert into public.squad_memberships (club_id, player_id, acquisition) values (n.buyer_club, n.player_id, 'purchase');
  insert into public.transfers (season_id, window_id, kind, player_id, from_club, to_club, amount, negotiation_id)
  values (c.v_season, c.v_window, 'purchase', n.player_id, n.seller_club, n.buyer_club, v_amount, n.id) returning id into v_transfer;
  insert into public.club_ledger (club_id, season_id, kind, amount, transfer_id, created_by) values
    (n.buyer_club, c.v_season, 'transfer', -v_amount, v_transfer, (select auth.uid())),
    (n.seller_club, c.v_season, 'transfer', v_amount, v_transfer, (select auth.uid()));
end $$;

create function private.cancel_offer(p_negotiation bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.negotiations;
begin
  select * into n from public.negotiations where id = p_negotiation for update;
  if not found or n.status not in ('sent', 'negotiating') then raise exception 'Esta oferta ya no está vigente' using errcode = 'P0001'; end if;
  if not (private.is_admin() or private.my_club_id() = n.buyer_club) then raise exception 'Solo el club que ofertó puede cancelarla' using errcode = '42501'; end if;
  update public.negotiations set status = 'cancelled' where id = n.id;
end $$;

create function public.list_player(p_club integer, p_player integer, p_asking numeric default null) returns void language sql security invoker set search_path = '' as $$ select private.list_player(p_club, p_player, p_asking) $$;
create function public.unlist_player(p_club integer, p_player integer) returns void language sql security invoker set search_path = '' as $$ select private.unlist_player(p_club, p_player) $$;
create function public.make_offer(p_buyer integer, p_player integer, p_amount numeric) returns bigint language sql security invoker set search_path = '' as $$ select private.make_offer(p_buyer, p_player, p_amount) $$;
create function public.respond_offer(p_negotiation bigint, p_accept boolean) returns void language sql security invoker set search_path = '' as $$ select private.respond_offer(p_negotiation, p_accept) $$;
create function public.cancel_offer(p_negotiation bigint) returns void language sql security invoker set search_path = '' as $$ select private.cancel_offer(p_negotiation) $$;

revoke all on function private.on_squad_exit() from public, anon, authenticated;
revoke all on function private.check_buyer(integer, integer, numeric, public.season_rules), private.list_player(integer, integer, numeric), private.unlist_player(integer, integer), private.make_offer(integer, integer, numeric), private.respond_offer(bigint, boolean), private.cancel_offer(bigint) from public, anon;
grant execute on function private.check_buyer(integer, integer, numeric, public.season_rules), private.list_player(integer, integer, numeric), private.unlist_player(integer, integer), private.make_offer(integer, integer, numeric), private.respond_offer(bigint, boolean), private.cancel_offer(bigint) to authenticated;
revoke all on function public.list_player(integer, integer, numeric), public.unlist_player(integer, integer), public.make_offer(integer, integer, numeric), public.respond_offer(bigint, boolean), public.cancel_offer(bigint) from public, anon;
grant execute on function public.list_player(integer, integer, numeric), public.unlist_player(integer, integer), public.make_offer(integer, integer, numeric), public.respond_offer(bigint, boolean), public.cancel_offer(bigint) to authenticated;
