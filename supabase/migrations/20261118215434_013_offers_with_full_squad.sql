-- Se puede ofertar con la plantilla completa: el lugar se exige recién al concretar la venta.
create or replace function private.check_buyer(p_club integer, p_overall integer, p_amount numeric, p_rules public.season_rules) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_count integer; v_in integer; v_out integer; v_stars integer; v_balance numeric;
begin
  select count(*) into v_count from public.squad_memberships m where m.club_id = p_club and m.left_at is null;
  select count(*) filter (where a.action = 'incorporate'), count(*) filter (where a.action = 'remove') into v_in, v_out
    from public.squad_adjustments a where a.club_id = p_club and a.status = 'pending';
  if v_count - v_out + v_in >= p_rules.squad_size then
    raise exception 'El club comprador tiene la plantilla completa: primero debe liberar un lugar' using errcode = 'P0001';
  end if;
  if p_overall = p_rules.star_rating then
    select count(*) into v_stars from public.squad_memberships m join public.players p on p.id = m.player_id
      where m.club_id = p_club and m.left_at is null and p.overall = p_rules.star_rating;
    if v_stars >= p_rules.required_stars then raise exception 'El club comprador ya tiene su jugador de media %', p_rules.star_rating using errcode = 'P0001'; end if;
  end if;
  select coalesce(sum(l.amount), 0) into v_balance from public.club_ledger l where l.club_id = p_club;
  if p_rules.enforce_balance and p_amount > v_balance then raise exception 'El club comprador no tiene saldo suficiente' using errcode = 'P0001'; end if;
end $$;

create or replace function private.make_offer(p_buyer integer, p_player integer, p_amount numeric) returns bigint
language plpgsql security definer set search_path = '' as $$
declare c record; l public.transfer_listings; v_amount numeric := round(p_amount, 1); v_id bigint; v_balance numeric;
begin
  select * into c from private.market_context(p_buyer);
  if v_amount is null or v_amount <= 0 then raise exception 'La oferta tiene que ser mayor a 0' using errcode = 'P0001'; end if;
  select * into l from public.transfer_listings where player_id = p_player;
  if not found then raise exception 'Este jugador no está transferible' using errcode = 'P0001'; end if;
  if l.club_id = p_buyer then raise exception 'No podés ofertar por un jugador de tu club' using errcode = 'P0001'; end if;
  select coalesce(sum(x.amount), 0) into v_balance from public.club_ledger x where x.club_id = p_buyer;
  if (c.v_rules).enforce_balance and v_amount > v_balance then raise exception 'Saldo insuficiente: tenés % M', v_balance using errcode = 'P0001'; end if;
  select id into v_id from public.negotiations where player_id = p_player and buyer_club = p_buyer and status in ('sent', 'negotiating') for update;
  if v_id is null then
    insert into public.negotiations (window_id, kind, player_id, seller_club, buyer_club, status, turn_club, created_by)
    values (c.v_window, 'purchase', p_player, l.club_id, p_buyer, 'sent', l.club_id, (select auth.uid())) returning id into v_id;
  end if;
  insert into public.negotiation_offers (negotiation_id, from_club, amount, created_by) values (v_id, p_buyer, v_amount, (select auth.uid()));
  return v_id;
end $$;
