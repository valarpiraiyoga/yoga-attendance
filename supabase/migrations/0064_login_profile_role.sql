-- Admin-only role lookup for one login account: lets Reset Password verify that an instructor's linked account really is an instructor's
--
-- WHY
--   Reset Password (lib/instructors/actions.js -> lib/instructors/temporary-access.js) must refuse to touch any account whose profile role is not
--   exactly 'instructor' - above all an Admin's - before it sets a new temporary password. That check read public.profiles through the secret-key
--   client and failed with 42501 "permission denied for table profiles": profiles is granted to `authenticated` only (0001), and the secret-key
--   client is meant for the Auth Admin API alone (lib/supabase/admin.js). An Admin's own session cannot read another user's profile either: the
--   only select policy is profiles_select_own. This function is the narrow, Admin-only way to read ONE value - one user's role - so the check can
--   run through the Admin's own session, with no new grant on profiles.
--
-- WHAT IT DOES
--   public.login_profile_role(p_user_id uuid) returns text
--     * the caller must be an Admin: public.is_admin() (0002) decides from auth.uid(), the user id PostgREST takes from the request's VERIFIED
--       JWT - never from an argument - so a caller cannot make themselves an Admin, and p_user_id plays no part in that decision;
--     * otherwise it raises 42501 'Not authorized.' (the same answer the other Admin-only functions give);
--     * it returns that one user's profiles.role ('admin' or 'instructor'), or NULL when no profile exists for that id. Nothing else about the
--       profile (name, timestamps) and nothing about any other user is returned.
--   SECURITY DEFINER so it can read profiles without a table grant or a policy change; set search_path = '' and every object schema-qualified,
--   so a caller-controlled search_path cannot redirect it. STABLE: it reads only. Execute is revoked from PUBLIC and anon and granted to
--   authenticated only. It is revoked from service_role too (the secret-key client): that client is for the Auth Admin API alone, and its auth.uid()
--   is NULL, so is_admin() would refuse it anyway.
--
-- WHAT IT DOES NOT DO
--   * No grant, revoke or policy on public.profiles; no table, column, trigger or data change. is_admin() is used, not changed.
--   * The application still verifies the role itself (exactly 'instructor', NULL or anything else refuses) and fails closed if this function is
--     missing or errors.
--
-- RE-RUN
--   Idempotent: CREATE OR REPLACE, and the grants are re-stated. Run it as one transaction.

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0064 needs public.is_admin() (0002).';
  end if;
  if to_regclass('public.profiles') is null then
    raise exception '0064 needs public.profiles (0001).';
  end if;
end
$$;


create or replace function public.login_profile_role(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  -- The caller - not the user asked about - must be an Admin. is_admin() reads auth.uid(), i.e. the verified JWT of this request.
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = p_user_id;

  -- NULL when the user has no profile (or p_user_id is NULL): the caller treats that as "not an instructor".
  return v_role;
end;
$$;

comment on function public.login_profile_role(uuid) is
  'Admin only (42501 otherwise). The role (admin / instructor) of ONE login account, or NULL when it has no profile. Used by Reset Password to refuse any account that is not an instructor''s, through the Admin''s own session and without a grant on profiles (0064).';

revoke execute on function public.login_profile_role(uuid) from public, anon, service_role;
grant execute on function public.login_profile_role(uuid) to authenticated;
