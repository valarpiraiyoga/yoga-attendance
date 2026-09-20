-- ===========================================================================
-- Migration 0019 structural verification
-- Verifies supabase/migrations/0019_profile_photos.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0019. STRICTLY READ-ONLY:
-- one SELECT over system catalogs and the bucket row. Statuses: PASS, FAIL.
-- ===========================================================================

begin transaction read only;

select seq, check_name, status, detail
from (
  select 1 as seq, 'instructors.photo_url exists (text)' as check_name,
         case when exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'instructors'
             and column_name = 'photo_url' and data_type = 'text'
         ) then 'PASS' else 'FAIL' end as status,
         '' as detail

  union all
  select 2, 'students.photo_url still exists (text)',
         case when exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'students'
             and column_name = 'photo_url' and data_type = 'text'
         ) then 'PASS' else 'FAIL' end, ''

  union all
  select 3, 'bucket profile-photos exists, public, 2 MB, jpeg/png/webp',
         case when exists (
           select 1 from storage.buckets
           where id = 'profile-photos' and public
             and file_size_limit = 2097152
             and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']
             and array_length(allowed_mime_types, 1) = 3
         ) then 'PASS' else 'FAIL' end, ''

  union all
  select 4, 'four admin-only policies on storage.objects for the bucket',
         case when (
           select count(*) from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname in ('profile_photos_select_admin', 'profile_photos_insert_admin',
                                'profile_photos_update_admin', 'profile_photos_delete_admin')
             and roles = '{authenticated}'
             and coalesce(qual, with_check) like '%profile-photos%is_admin%'
         ) = 4 then 'PASS' else 'FAIL' end, ''

  union all
  select 5, 'no profile-photos policy is open to anon/public',
         case when not exists (
           select 1 from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname like 'profile_photos_%'
             and (roles && array['anon'::name, 'public'::name])
         ) then 'PASS' else 'FAIL' end, ''
) checks
order by seq;

rollback;
