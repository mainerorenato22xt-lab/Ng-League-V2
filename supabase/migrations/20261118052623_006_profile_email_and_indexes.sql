alter table public.profiles add column email text;
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, role) on public.profiles to authenticated;

create or replace function private.handle_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_admin boolean;
begin
  v_admin := new.email_confirmed_at is not null
    and exists (select 1 from private.bootstrap_admins b where b.email = lower(new.email));
  insert into public.profiles (id, email, display_name, avatar_url, role)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          new.raw_user_meta_data->>'avatar_url',
          case when v_admin then 'admin'::public.user_role else 'visitor'::public.user_role end)
  on conflict (id) do update
    set email = excluded.email,
        role = case when v_admin then 'admin'::public.user_role else public.profiles.role end;
  return new;
end $$;

drop trigger on_auth_user_saved on auth.users;
create trigger on_auth_user_saved after insert or update of email, email_confirmed_at on auth.users
  for each row execute function private.handle_auth_user();

create or replace function public.admin_list_users()
returns table (id uuid, email text, display_name text, role public.user_role, club_id integer, created_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Acceso solo para administración' using errcode = '42501'; end if;
  return query
  select p.id, p.email, p.display_name, p.role, t.club_id, p.created_at
  from public.profiles p
  left join public.coaches c on c.profile_id = p.id
  left join public.coach_tenures t on t.coach_id = c.id and t.is_current
  order by p.created_at;
end $$;

create index rivalries_club_a_idx on public.rivalries (club_a);
