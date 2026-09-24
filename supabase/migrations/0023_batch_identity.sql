-- Batch Identity.
--
-- A batch gets a small visual identity so it is recognisable across the app
-- (Batches, Schedule, Batch Details): a colour from a curated palette and an
-- optional image / icon.
--
--   batch_color      A stable palette KEY (never a hex or CSS string), so the
--                    palette can be retuned in one place (lib/batches/
--                    identity.js + app/globals.css) without touching data.
--                    Required; every existing batch gets 'teal' (the brand
--                    colour) through the column default, so nothing changes
--                    visually until an admin picks something else.
--   batch_image_url  Optional public URL of an uploaded image. Only the URL is
--                    stored - never binary or base64.
--
-- Storage: the image lives in the existing `profile-photos` bucket under a
-- `batches/` folder (0019_profile_photos.sql). That bucket already limits files
-- to 2 MB of JPEG / PNG / WebP and allows only admins to insert / update /
-- delete, exactly what batch images need, so no new bucket or policy is added.
--
-- RLS is unchanged: batches stays admin-only (0005_batches.sql), and the new
-- columns are covered by the table's existing privileges and policies.

alter table public.batches
  add column if not exists batch_color text not null default 'teal',
  add column if not exists batch_image_url text;

-- Keep the key list in step with lib/batches/identity.js (BATCH_COLOR_KEYS).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'batches_batch_color_valid'
  ) then
    alter table public.batches
      add constraint batches_batch_color_valid
      check (batch_color in (
        'teal', 'blue', 'indigo', 'purple', 'pink',
        'orange', 'amber', 'green', 'red', 'slate'
      ));
  end if;
end $$;

comment on column public.batches.batch_color is
  'Palette key for the batch accent colour (lib/batches/identity.js). Defaults to teal.';
comment on column public.batches.batch_image_url is
  'Optional public URL of the batch image in the profile-photos bucket (batches/ folder).';
