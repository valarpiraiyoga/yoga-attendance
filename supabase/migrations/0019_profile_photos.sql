-- Profile photos for Students and Instructors.
--
-- Two additive changes; nothing existing is altered or dropped.
--
-- 1. `instructors.photo_url`. `students.photo_url` already exists
--    (0006_students.sql) and is reused as is. Instructor had no equivalent
--    column, so this is the one new field.
--
-- 2. A Supabase Storage bucket, `profile-photos`, that holds both kinds of
--    photo under `students/` and `instructors/` prefixes. The application
--    stores the object's public URL in `photo_url`.
--
-- Public bucket: an avatar is rendered as a plain <img src>, on lists,
-- headers, dashboard cards and rosters. A private bucket would need a signed
-- URL minted on every page that shows an avatar. Reading is public but the
-- object paths are unguessable (`<prefix>/<uuid>.<ext>`), listing the bucket
-- is not possible without a select policy, and WRITING is admin-only below.
-- If photos must ever be private, switch the bucket to private and resolve
-- signed URLs where avatars render.
--
-- The size and type limits are enforced here by Storage itself, in addition
-- to the application's own validation, so a request that bypasses the form
-- is rejected too.

alter table public.instructors
  add column if not exists photo_url text;

comment on column public.instructors.photo_url is
  'Public URL of the instructor''s profile photo in the profile-photos bucket. Null when none is set.';

-- Bucket ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies -----------------------------------------------------------
-- Admin-only writes, reusing public.is_admin() (0002_instructors.sql), scoped
-- to this bucket only. The select policy is what lets an admin's session find
-- an object to replace or remove; the public URL itself does not depend on it.
-- No policy is added for `anon`, so unauthenticated callers cannot list, write
-- or delete anything.

drop policy if exists "profile_photos_select_admin" on storage.objects;
create policy "profile_photos_select_admin"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'profile-photos' and public.is_admin());

drop policy if exists "profile_photos_insert_admin" on storage.objects;
create policy "profile_photos_insert_admin"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'profile-photos' and public.is_admin());

drop policy if exists "profile_photos_update_admin" on storage.objects;
create policy "profile_photos_update_admin"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'profile-photos' and public.is_admin())
  with check (bucket_id = 'profile-photos' and public.is_admin());

drop policy if exists "profile_photos_delete_admin" on storage.objects;
create policy "profile_photos_delete_admin"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'profile-photos' and public.is_admin());
