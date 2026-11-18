-- Un fichaje libre no puede ocupar un lugar ya comprometido por operaciones pendientes.
create or replace function private.sign_free_player(p_club integer, p_player integer) returns numeric
language plpgsql security definer set search_path = '' as $$
declare c record; d record; v_balance numeric; v_transfer bigint; v_stars integer; v_count integer; v_in integer; v_out integer;
begin
  select * into c from private.market_context(p_club);
  select * into d from public.player_directory where id = p_player;
  if not found then raise exception 'El jugador no existe' using errcode = 'P0001'; end if;
  if not d.is_eligible or d.market_value is null then raise exception 'Este jugador no es elegible' using errcode = 'P0001'; end if;
  if d.club_id is not null then raise exception 'Este jugador ya tiene club' using errcode = 'P0001'; end if;
  if d.reserved_club_id is not null then raise exception 'Este jugador está reservado' using errcode = 'P0001'; end if;
  select count(*) into v_count from public.squad_memberships m where m.club_id = p_club and m.left_at is null;
  select count(*) filter (where a.action = 'incorporate'), count(*) filter (where a.action = 'remove') into v_in, v_out
    from public.squad_adjustments a where a.club_id = p_club and a.status = 'pending';
  if v_count - v_out + v_in >= (c.v_rules).squad_size then
    raise exception 'La plantilla ya está completa, contando las operaciones por completar' using errcode = 'P0001';
  end if;
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
