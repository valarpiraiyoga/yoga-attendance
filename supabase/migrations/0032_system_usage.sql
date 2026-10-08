-- =============================================================================
-- V1 System Usage (Admin Dashboard)
-- Migration 0032
--
-- ADDITIVE. One read-only function, public.system_usage(), that returns exactly two
-- numbers for the Admin Dashboard's "System Usage" card:
--
--     database_bytes   the size of this database          pg_database_size(current_database())
--     storage_bytes    the total size of the stored files  sum of storage.objects metadata size
--
-- It changes no table, row, policy or other function.
--
-- WHY A FUNCTION
--   Neither number can be read by the browser: the browser holds only the publishable key, and
--   no client role may read system size functions or aggregate storage.objects. The function is
--   SECURITY DEFINER so it can read them, and it is the ONLY thing granted: it returns two
--   aggregate numbers, never rows of storage.objects and never anything else about the database.
--   No Management API, no token and no service-role/secret key is involved - the application
--   calls it with the signed-in user's own session.
--
-- SECURITY
--   * SECURITY DEFINER with an empty search_path (every reference is schema-qualified, or a
--     pg_catalog function, which is always searched).
--   * Admin only: public.is_admin() is checked first; anyone else gets 42501 'Not authorized.'
--   * EXECUTE is revoked from PUBLIC and anon and granted to authenticated only, so an
--     unauthenticated caller cannot reach it, and a signed-in non-admin is refused by the check.
--
-- STORAGE SIZE
--   storage.objects.metadata->>'size' is each object's byte size (folder placeholders carry 0 or
--   none). A value that is missing or not a plain number counts as 0, and an empty bucket list
--   sums to 0, so the function never returns NULL.
-- =============================================================================

create or replace function public.system_usage()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_database_bytes bigint;
  v_storage_bytes  bigint;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  v_database_bytes := pg_database_size(current_database());

  select coalesce(
           sum(
             case
               when o.metadata ->> 'size' ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint
               else 0
             end
           ),
           0
         )
    into v_storage_bytes
  from storage.objects o;

  return jsonb_build_object(
    'database_bytes', v_database_bytes,
    'storage_bytes',  v_storage_bytes
  );
end;
$$;

comment on function public.system_usage() is
  'Admin only. The size of the database and of all stored files, in bytes - two aggregate numbers for the Dashboard''s System Usage card. Reads nothing else and returns nothing else.';

revoke execute on function public.system_usage() from public, anon;
grant execute on function public.system_usage() to authenticated;
