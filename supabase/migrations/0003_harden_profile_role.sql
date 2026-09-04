-- Phase 9b — Security fix: application role is never client-controlled.
--
-- 0001_auth_profiles.sql provisioned new profiles with
--     coalesce(new.raw_user_meta_data ->> 'role', 'instructor')
--
-- `raw_user_meta_data` is whatever the caller passed to the signup/invite API,
-- so a self-service signup could set "role": "admin" in its own metadata and
-- be provisioned as an application admin. RLS was never the weak point — it
-- was correctly told the caller was an admin.
--
-- The role is now hard-coded to the least-privileged value. Promotion to
-- 'admin' stays an explicit out-of-band operation (Supabase SQL editor or
-- another server-side path), exactly as 0001 already described it; the
-- metadata shortcut was never needed for it.
--
-- `full_name` is still read from metadata: it is a display name, carries no
-- privilege, and the Phase 9b invite flow supplies it.
--
-- Replaces the function only. The `on_auth_user_created` trigger from 0001
-- still points at it and is left untouched.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    -- Never sourced from caller-supplied metadata. See the header above.
    'instructor'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Provisions public.profiles for a new auth user. Role is always the least-privileged default; admin promotion is a separate administrative action.';
