-- Phone country code for Students and Instructors.
--
-- A phone number is now captured as two separate values instead of one string:
--
--   phone_country_code   "+91"          (new, this migration)
--   phone                "9876543210"   (unchanged: the national digits)
--
-- so the calling code is never concatenated into `phone`. `phone` keeps its
-- meaning, its digits-only rule (enforced in the application, as before) and
-- its required / optional behaviour (students.phone is still NOT NULL,
-- instructors.phone still nullable). Nothing is dropped, renamed or rewritten.
--
-- Existing data. Before this migration, phone numbers were stored as digits
-- only with NO country code convention (lib/whatsapp.js: "no country code
-- convention; the centre is in India ... a bare 10-digit number is taken to be
-- Indian and anything longer to already include a country code"). So:
--
--   * A value that is exactly an Indian mobile number - 10 digits starting 6-9,
--     the shape the application has always treated as Indian - is attributed to
--     +91. Its `phone` digits are not touched.
--   * Every other value (a different length, a leading 0, a number that already
--     includes a country code, an international number, a landline, ...) cannot
--     be attributed to a country reliably, so it is LEFT AS STORED with a NULL
--     `phone_country_code`. It is displayed and used exactly as before; the
--     country code is filled in when someone next edits that person and picks
--     one. Nothing is guessed, split or corrupted.
--
-- Non-destructive: two nullable columns, a format check, a data-only backfill
-- (neither table has an updated_at trigger, so `updated_at` is not touched).
-- Existing students and instructors work unchanged before and after it. RLS is
-- untouched (policies are per row/table, not per column), and no RPC that
-- returns a phone (0014 / 0015) is changed.

alter table public.students
  add column if not exists phone_country_code text;

alter table public.instructors
  add column if not exists phone_country_code text;

-- Shape only ("+" then 1-4 digits, no leading zero) - deliberately not a list
-- of assigned codes, so no legitimate number is rejected. Matches
-- lib/phone.js's COUNTRY_CODE_PATTERN.
alter table public.students
  add constraint students_phone_country_code_format
  check (phone_country_code is null or phone_country_code ~ '^\+[1-9][0-9]{0,3}$');

alter table public.instructors
  add constraint instructors_phone_country_code_format
  check (phone_country_code is null or phone_country_code ~ '^\+[1-9][0-9]{0,3}$');

comment on column public.students.phone_country_code is
  'International calling code of `phone`, e.g. "+91". NULL for a legacy number whose country could not be determined (see 0022_phone_country_code.sql); `phone` itself holds the national digits only.';

comment on column public.instructors.phone_country_code is
  'International calling code of `phone`, e.g. "+91". NULL when there is no phone, or for a legacy number whose country could not be determined (see 0022_phone_country_code.sql).';

-- Backfill: only the unambiguous Indian mobile shape.
update public.students
   set phone_country_code = '+91'
 where phone_country_code is null
   and phone ~ '^[6-9][0-9]{9}$';

update public.instructors
   set phone_country_code = '+91'
 where phone_country_code is null
   and phone ~ '^[6-9][0-9]{9}$';
