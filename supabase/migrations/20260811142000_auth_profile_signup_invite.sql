-- Auto-create profile records for auth users created by sign-up or invite.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_persona persona_type;
begin
  requested_persona := coalesce((new.raw_user_meta_data ->> 'persona')::persona_type, 'family_caregiver'::persona_type);

  if requested_persona = 'mother' then
    requested_persona := 'family_caregiver'::persona_type;
  end if;

  insert into public.profiles (id, email, display_name, persona, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    requested_persona,
    null
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        persona = excluded.persona;

  return new;
exception
  when others then
    raise warning 'handle_new_auth_user failed for user %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();
