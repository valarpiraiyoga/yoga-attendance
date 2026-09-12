-- ===========================================================================
-- Phase 16A — Migration 0015 BEHAVIOURAL verification
-- Exercises supabase/migrations/0015_class_session_eligible_students.sql
-- ===========================================================================
--
-- Companion to verify_0015_class_session_eligible_students.sql. That script
-- is read-only and proves the snapshot machinery is *installed*. This one
-- actually runs it and proves it *behaves*, then throws the work away.
--
-- SAFETY — ROLLBACK ONLY
--   * Everything runs inside one transaction that ends in ROLLBACK.
--   * It genuinely writes: it builds a fixture, saves attendance, freezes a
--     snapshot, and deactivates one enrollment. None of it is committed.
--   * NOTHING THAT CONSUMES A SEQUENCE IS EVER INSERTED. `students` and
--     `memberships` generate their product-facing codes (YC-000001 /
--     MEM-000001) from a sequence via a BEFORE INSERT trigger, and nextval()
--     is NOT transactional: rolling back removes the row but does not give
--     the number back, leaving a permanent gap in an ID the product
--     documents as sequential. So the fixture NEVER inserts a student or a
--     membership — it reuses an existing pair and builds everything else
--     (batch, schedule series, schedule, enrollment, assignment, session)
--     from tables whose keys are gen_random_uuid() defaults. Those roll back
--     completely and leave no trace of any kind.
--   * The temp results table is `on commit drop`, so it disappears too.
--   * Expect-error tests run inside PL/pgSQL exception blocks
--     (subtransactions), so a raised error never aborts the outer
--     transaction and never costs you the result grid.
--   * Setup failures record NOT TESTED and carry on rather than raising —
--     a raise here would abort the transaction and print nothing at all.
--   * Run the whole file in one go. Running it piecemeal can leave a
--     transaction open; if the editor ever reports an open transaction,
--     issue `rollback;` before doing anything else.
--
-- AUTHENTICATION — READ THIS BEFORE BELIEVING THE RESULTS
--   resolve_eligible_students and save_session_attendance both authorize via
--   is_admin() / can_access_session(), which read auth.uid(). Called as the
--   SQL editor's owning role they would raise 42501, so this script does what
--   verify_0014 does: it sets request.jwt.claims and switches to the
--   `authenticated` role, exactly as PostgREST does, and calls them as a real
--   discovered ADMIN user.
--
--   Consequently:
--     * Scenarios B-F are exercised as an authenticated ADMIN. That is a
--       genuine runtime test of the snapshot behaviour.
--     * INSTRUCTOR RLS BEHAVIOUR IS NOT RE-TESTED HERE. Instructor scoping is
--       0014's subject and is covered by verify_0014_instructor_access.sql
--       (A1-A11). Nothing below should be read as evidence about instructors.
--     * Fixture setup and post-condition reads run as the owning role, where
--       RLS does not apply. Those are setup and assertions about stored
--       facts, never the security claim itself.
--
-- NO service-role key is used. No function, table, policy or grant is
-- modified. No migration is applied. No backfill is run.
--
-- OUTPUT: one grid of seq / test / status / detail, plus a SUMMARY row.
-- Statuses: PASS, FAIL, NOT TESTED (no safe fixture — reason in detail),
-- and INFO (a readout, never an assertion).
-- ===========================================================================

begin;

create temp table _verify_results (
  seq    int,
  test   text,
  status text,
  detail text
) on commit drop;

do $$
declare
  -- ---- excluded fixture ---------------------------------------------------
  -- The Aerial Yoga session whose history already drifted pre-0015. It must
  -- never be the subject: freezing it would capture today's drifted answer
  -- as if it were history. Belt and braces — it is already excluded by the
  -- status/attendance filters below, since it is completed and has marks.
  v_excl_date   date := date '2026-09-11';

  v_admin_user  uuid;
  v_today       date;

  -- ---- scenario B fixture -------------------------------------------------
  v_candidates  uuid[];
  v_cand        uuid;
  v_session     uuid;
  v_sched       uuid;
  v_batch       uuid;
  v_date        date;
  v_live        uuid[] := '{}';
  v_snap        uuid[] := '{}';
  v_marker      timestamptz;
  v_marker2     timestamptz;
  v_prov        text[];
  v_result      jsonb;
  v_marks       jsonb;
  v_status      text;

  -- ---- scenario B constructed fixture -------------------------------------
  -- Used only when no real session qualifies. Every one of these tables keys
  -- on gen_random_uuid(), so none of it consumes a sequence.
  v_fix_used    boolean := false;
  v_fix_student uuid; v_fix_instr uuid;
  v_fix_batch   uuid; v_fix_series uuid; v_fix_sched uuid; v_fix_enr uuid;
  v_fix_date    date; v_mem_end date;
  v_fix_dow     text;

  -- ---- scenario C fixture (empty eligible set) ----------------------------
  v_c_sched     uuid; v_c_batch uuid; v_c_instr uuid;
  v_c_start     time; v_c_end time;
  v_c_date      date;
  v_c_session   uuid;
  v_c_live      int;

  -- ---- scenario D/E fixture ----------------------------------------------
  v_target      uuid;
  v_enr         uuid;
  v_frozen      uuid[] := '{}';
  v_snap2       uuid[] := '{}';
  v_att_status  text;

  -- ---- baselines for the rollback statement -------------------------------
  v_base_snap   int; v_base_mark int; v_base_att int;

  n int;
  v_log  text[] := '{}';
  v_pass int := 0; v_fail int := 0; v_skip int := 0;
begin
  v_today := (now() at time zone 'Asia/Kolkata')::date;

  -- =========================================================================
  -- SETUP — as the owning role (no RLS). Fixture discovery only.
  -- =========================================================================
  select count(*) into v_base_snap from public.class_session_eligible_students;
  select count(*) into v_base_mark from public.class_sessions where eligibility_snapshot_at is not null;
  select count(*) into v_base_att  from public.attendance;

  v_log := v_log || format(
    'SETUP|INFO|baseline before test: %s snapshot rows, %s markers, %s attendance rows',
    v_base_snap, v_base_mark, v_base_att);

  select p.id into v_admin_user
  from public.profiles p
  where p.role = 'admin'
  order by p.created_at
  limit 1;

  if v_admin_user is null then
    v_log := v_log || 'SETUP|NOT TESTED|no admin profile found; every runtime scenario needs an authorized caller'::text;
  else
    v_log := v_log || format('SETUP|INFO|calling as admin user %s (impersonated, not service-role)', v_admin_user);

    -- Candidate sessions for a FIRST save: never attended, never snapshotted,
    -- still scheduled, not in the future, and not the excluded session.
    select array_agg(cs.id order by cs.session_date desc)
    into v_candidates
    from public.class_sessions cs
    where cs.status = 'scheduled'
      and cs.eligibility_snapshot_at is null
      and cs.session_date <= v_today
      and cs.session_date <> v_excl_date
      and not exists (
        select 1 from public.attendance a where a.class_session_id = cs.id
      );

    v_log := v_log || format('SETUP|INFO|%s candidate session(s) eligible to be a first-save subject',
                             coalesce(array_length(v_candidates, 1), 0));

    -- =======================================================================
    -- Impersonate the admin, exactly as PostgREST would.
    -- =======================================================================
    perform set_config('request.jwt.claims',
            json_build_object('sub', v_admin_user, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
    execute 'set local role authenticated';

    -- Pick the first candidate that actually has eligible students, using the
    -- real function rather than a re-implementation of the eligibility rules.
    foreach v_cand in array coalesce(v_candidates, '{}'::uuid[])
    loop
      select cs.schedule_id, cs.batch_id, cs.session_date
        into v_sched, v_batch, v_date
      from public.class_sessions cs where cs.id = v_cand;

      select coalesce(array_agg(r.student_id), '{}')
        into v_live
      from public.resolve_eligible_students(v_batch, v_sched, v_date) r;

      if coalesce(array_length(v_live, 1), 0) > 0 then
        v_session := v_cand;
        exit;
      end if;
    end loop;

    execute 'reset role';

    -- =======================================================================
    -- No real session qualified — build an ISOLATED fixture instead.
    -- =======================================================================
    -- Isolation: a brand-new batch, series, schedule and session, so nothing
    -- that already exists changes eligibility, rosters or history. The only
    -- thing reused is an existing (student, membership) pair, because
    -- inserting either would burn a sequence that ROLLBACK cannot return
    -- (see the header). The student is read, never modified; the enrollment
    -- that joins them to the fixture batch is itself part of the fixture.
    --
    -- The session date is chosen INSIDE that membership's window rather than
    -- picking a date and then needing a membership for it — which is what
    -- lets the whole fixture avoid inserting a membership at all.
    if v_session is null then
      select i.id into v_fix_instr
      from public.instructors i order by i.created_at limit 1;

      select m.student_id, m.end_date
        into v_fix_student, v_mem_end
      from public.memberships m
      join public.students s on s.id = m.student_id
      where s.status = 'active'                 -- D1
        and m.cancelled_at is null              -- D3
        and m.start_date <= v_today
        and m.end_date >= m.start_date
        -- Never borrow a student caught up in the excluded Aerial Yoga case.
        and not exists (
          select 1
          from public.attendance a
          join public.class_sessions cs2 on cs2.id = a.class_session_id
          where a.student_id = m.student_id
            and cs2.session_date = v_excl_date
        )
      order by m.start_date desc
      limit 1;

      if v_fix_instr is null or v_fix_student is null then
        v_log := v_log || 'SETUP|INFO|cannot build a fixture: no instructor, or no active student with an uncancelled membership'::text;
      else
        -- A date the reused membership already covers, never in the future.
        v_fix_date := least(v_mem_end, v_today);

        v_fix_dow := case extract(dow from v_fix_date)::int
                       when 0 then 'sunday'   when 1 then 'monday'
                       when 2 then 'tuesday'  when 3 then 'wednesday'
                       when 4 then 'thursday' when 5 then 'friday'
                       else 'saturday' end;

        insert into public.batches (name, code, status)
        values ('ZZ Phase 16A verification fixture',
                'ZZV16A-' || substr(gen_random_uuid()::text, 1, 8),
                'active')
        returning id into v_fix_batch;

        insert into public.schedule_series (batch_id)
        values (v_fix_batch)
        returning id into v_fix_series;

        insert into public.schedules
          (batch_id, instructor_id, day_of_week, start_time, end_time,
           effective_from, status, series_id)
        values
          (v_fix_batch, v_fix_instr, v_fix_dow, time '06:00', time '07:00',
           v_fix_date, 'active', v_fix_series)
        returning id into v_fix_sched;

        insert into public.batch_enrollments
          (student_id, batch_id, effective_start_date, status)
        values (v_fix_student, v_fix_batch, v_fix_date, 'active')   -- D2
        returning id into v_fix_enr;

        -- Phase 15A: eligibility also needs an assignment on this series.
        insert into public.enrollment_schedules
          (batch_enrollment_id, schedule_series_id, effective_start_date)
        values (v_fix_enr, v_fix_series, v_fix_date);

        -- The subject: past-or-today, scheduled, no attendance, no snapshot.
        insert into public.class_sessions
          (schedule_id, batch_id, instructor_id, session_date,
           start_time, end_time, status)
        values
          (v_fix_sched, v_fix_batch, v_fix_instr, v_fix_date,
           time '06:00', time '07:00', 'scheduled')
        returning id into v_cand;

        perform set_config('request.jwt.claims',
                json_build_object('sub', v_admin_user, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
        execute 'set local role authenticated';

        select coalesce(array_agg(r.student_id), '{}')
          into v_live
        from public.resolve_eligible_students(v_fix_batch, v_fix_sched, v_fix_date) r;

        execute 'reset role';

        if coalesce(array_length(v_live, 1), 0) > 0 then
          v_session  := v_cand;
          v_sched    := v_fix_sched;
          v_batch    := v_fix_batch;
          v_date     := v_fix_date;
          v_fix_used := true;
          v_log := v_log || format(
            'SETUP|INFO|built isolated fixture: batch %s, schedule %s, session %s on %s, reusing student %s (no sequence consumed)',
            v_fix_batch, v_fix_sched, v_cand, v_fix_date, v_fix_student);
        else
          v_log := v_log || format(
            'SETUP|INFO|fixture built for %s but resolve_eligible_students returned 0 students; not usable',
            v_fix_date);
        end if;
      end if;
    else
      v_log := v_log || 'SETUP|INFO|using a real existing session; no fixture needed'::text;
    end if;
  end if;

  -- =========================================================================
  -- B. FIRST-SAVE SNAPSHOT BEHAVIOUR
  -- =========================================================================
  if v_admin_user is null then
    v_log := v_log || 'B|NOT TESTED|no authorized caller (see SETUP)'::text;
    v_skip := v_skip + 1;
  elsif v_session is null then
    v_log := v_log || 'B|NOT TESTED|no real session qualified AND no fixture could be built (see SETUP rows for which precondition was missing)'::text;
    v_skip := v_skip + 1;
  else
    v_log := v_log || format('B0|INFO|subject session %s (date %s, %s), %s live eligible student(s) before save',
                             v_session, v_date,
                             case when v_fix_used then 'constructed fixture' else 'real existing session' end,
                             coalesce(array_length(v_live, 1), 0));

    -- Mark every live-eligible student present.
    select jsonb_agg(jsonb_build_object('student_id', s, 'status', 'present'))
      into v_marks
    from unnest(v_live) as s;

    perform set_config('request.jwt.claims',
            json_build_object('sub', v_admin_user, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
    execute 'set local role authenticated';

    begin
      v_result := public.save_session_attendance(v_session, v_marks);
      v_pass := v_pass + 1;
      v_log := v_log || format('B1|PASS|(d) save succeeded: %s', v_result);
    exception when others then
      v_fail := v_fail + 1;
      v_log := v_log || format('B1|FAIL|(d) save raised %s: %s', sqlstate, sqlerrm);
    end;

    execute 'reset role';

    -- --- post-conditions, read as the owning role ---
    select cs.eligibility_snapshot_at, cs.status
      into v_marker, v_status
    from public.class_sessions cs where cs.id = v_session;

    if v_marker is not null then
      v_pass := v_pass + 1;
      v_log := v_log || format('B2|PASS|(a) eligibility_snapshot_at is non-NULL (%s)', v_marker);
    else
      v_fail := v_fail + 1;
      v_log := v_log || 'B2|FAIL|(a) eligibility_snapshot_at is still NULL after a first save'::text;
    end if;

    select coalesce(array_agg(e.student_id order by e.student_id), '{}')
      into v_snap
    from public.class_session_eligible_students e
    where e.class_session_id = v_session;

    if v_snap = (select coalesce(array_agg(s order by s), '{}') from unnest(v_live) as s) then
      v_pass := v_pass + 1;
      v_log := v_log || format('B3|PASS|(b) snapshot holds exactly the %s student(s) used for the save',
                               coalesce(array_length(v_snap, 1), 0));
    else
      v_fail := v_fail + 1;
      v_log := v_log || format('B3|FAIL|(b) snapshot %s <> eligible set used %s', v_snap, v_live);
    end if;

    select coalesce(array_agg(distinct e.provenance), '{}')
      into v_prov
    from public.class_session_eligible_students e
    where e.class_session_id = v_session;

    if v_prov = array['save']::text[] then
      v_pass := v_pass + 1;
      v_log := v_log || 'B4|PASS|(c) provenance is ''save'' on every snapshot row'::text;
    else
      v_fail := v_fail + 1;
      v_log := v_log || format('B4|FAIL|(c) provenance values are %s, expected {save}', v_prov);
    end if;

    select count(*) into n from public.attendance where class_session_id = v_session;
    if v_status = 'completed' and n = coalesce(array_length(v_live, 1), 0) then
      v_pass := v_pass + 1;
      v_log := v_log || format('B5|PASS|(e) session is completed with %s attendance row(s)', n);
    else
      v_fail := v_fail + 1;
      v_log := v_log || format('B5|FAIL|(e) status=%s with %s attendance row(s), expected completed with %s',
                               v_status, n, coalesce(array_length(v_live, 1), 0));
    end if;
  end if;

  -- =========================================================================
  -- C. EMPTY ELIGIBLE SET — marker stamped, zero rows, still completes
  -- =========================================================================
  -- No existing session is guaranteed to have zero eligible students, so the
  -- fixture is constructed: a real schedule, dated far enough in the past
  -- that no enrollment, assignment or membership can cover it. Created and
  -- destroyed inside this transaction.
  if v_admin_user is null then
    v_log := v_log || 'C|NOT TESTED|no authorized caller (see SETUP)'::text;
    v_skip := v_skip + 1;
  else
    select s.id, s.batch_id, s.instructor_id, s.start_time, s.end_time
      into v_c_sched, v_c_batch, v_c_instr, v_c_start, v_c_end
    from public.schedules s
    order by s.created_at
    limit 1;

    if v_c_sched is null then
      v_log := v_log || 'C|NOT TESTED|no schedule exists to build an empty-eligibility fixture from'::text;
      v_skip := v_skip + 1;
    else
      v_c_date := date '1999-01-04';
      while exists (
        select 1 from public.class_sessions
        where schedule_id = v_c_sched and session_date = v_c_date
      ) loop
        v_c_date := v_c_date + 1;
      end loop;

      insert into public.class_sessions
        (schedule_id, batch_id, instructor_id, session_date, start_time, end_time, status)
      values
        (v_c_sched, v_c_batch, v_c_instr, v_c_date, v_c_start, v_c_end, 'scheduled')
      returning id into v_c_session;

      perform set_config('request.jwt.claims',
              json_build_object('sub', v_admin_user, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
      execute 'set local role authenticated';

      select count(*) into v_c_live
      from public.resolve_eligible_students(v_c_batch, v_c_sched, v_c_date);

      if v_c_live <> 0 then
        v_log := v_log || format('C|NOT TESTED|constructed fixture dated %s still resolves %s eligible student(s); not an empty-set case',
                                 v_c_date, v_c_live);
        v_skip := v_skip + 1;
        execute 'reset role';
      else
        begin
          v_result := public.save_session_attendance(v_c_session, '[]'::jsonb);
          execute 'reset role';

          select cs.eligibility_snapshot_at, cs.status into v_marker, v_status
          from public.class_sessions cs where cs.id = v_c_session;

          select count(*) into n
          from public.class_session_eligible_students
          where class_session_id = v_c_session;

          if v_marker is not null and n = 0 and v_status = 'completed' then
            v_pass := v_pass + 1;
            v_log := v_log || format('C1|PASS|zero eligible: marker stamped (%s), 0 snapshot rows, session completed', v_marker);
          else
            v_fail := v_fail + 1;
            v_log := v_log || format('C1|FAIL|zero eligible: marker=%s, rows=%s, status=%s', v_marker, n, v_status);
          end if;
        exception when others then
          execute 'reset role';
          v_fail := v_fail + 1;
          v_log := v_log || format('C1|FAIL|zero-eligible save raised %s: %s', sqlstate, sqlerrm);
        end;
      end if;
    end if;
  end if;

  -- =========================================================================
  -- D. HISTORICAL FREEZE — live eligibility changes, history does not
  -- =========================================================================
  if v_session is null or coalesce(array_length(v_snap, 1), 0) = 0 then
    v_log := v_log || 'D|NOT TESTED|no snapshot was created in B, so there is nothing to freeze'::text;
    v_skip := v_skip + 1;
  else
    v_target := v_snap[1];

    -- Controlled change (owner role): deactivate this student's enrollment in
    -- the session's batch. D2 requires status='active', so live eligibility
    -- must now exclude them. Rolled back with everything else.
    select be.id into v_enr
    from public.batch_enrollments be
    where be.student_id = v_target
      and be.batch_id = v_batch
      and be.status = 'active'
      and be.effective_start_date <= v_date
      and (be.effective_end_date is null or be.effective_end_date >= v_date)
    limit 1;

    if v_enr is null then
      v_log := v_log || 'D|NOT TESTED|could not locate the covering active enrollment to change'::text;
      v_skip := v_skip + 1;
    else
      update public.batch_enrollments set status = 'inactive' where id = v_enr;

      select count(*) into n
      from public.batch_enrollments
      where id = v_enr and status = 'inactive';

      if n = 1 then
        v_log := v_log || format('D0|INFO|enrollment %s for student %s set inactive; live eligibility must now exclude them',
                                 v_enr, v_target);
      end if;

      perform set_config('request.jwt.claims',
              json_build_object('sub', v_admin_user, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
      execute 'set local role authenticated';

      select coalesce(array_agg(r.student_id order by r.student_id), '{}')
        into v_frozen
      from public.resolve_eligible_students(v_batch, v_sched, v_date) r;

      execute 'reset role';

      if v_frozen = v_snap then
        v_pass := v_pass + 1;
        v_log := v_log || format('D1|PASS|resolve still returns the original frozen set (%s student(s)) after the enrollment change',
                                 coalesce(array_length(v_frozen, 1), 0));
      else
        v_fail := v_fail + 1;
        v_log := v_log || format('D1|FAIL|resolve returned %s, frozen set was %s', v_frozen, v_snap);
      end if;

      if v_target = any (v_frozen) then
        v_pass := v_pass + 1;
        v_log := v_log || format('D2|PASS|de-enrolled student %s is still in the historical eligible set', v_target);
      else
        v_fail := v_fail + 1;
        v_log := v_log || format('D2|FAIL|de-enrolled student %s vanished from history', v_target);
      end if;
    end if;
  end if;

  -- =========================================================================
  -- E. CORRECTION AGAINST THE FROZEN SET
  -- =========================================================================
  if v_session is null or v_target is null or v_enr is null then
    v_log := v_log || 'E|NOT TESTED|depends on D, which did not run'::text;
    v_skip := v_skip + 1;
  else
    v_marks := jsonb_build_array(
      jsonb_build_object('student_id', v_target, 'status', 'absent'));

    perform set_config('request.jwt.claims',
            json_build_object('sub', v_admin_user, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
    execute 'set local role authenticated';

    begin
      v_result := public.save_session_attendance(v_session, v_marks);
      v_pass := v_pass + 1;
      v_log := v_log || format('E1|PASS|correction for the de-enrolled student succeeded: %s', v_result);
    exception when others then
      v_fail := v_fail + 1;
      v_log := v_log || format('E1|FAIL|correction raised %s: %s (22023 here would mean the frozen set was not used)',
                               sqlstate, sqlerrm);
    end;

    execute 'reset role';

    select a.status into v_att_status
    from public.attendance a
    where a.class_session_id = v_session and a.student_id = v_target;

    if v_att_status = 'absent' then
      v_pass := v_pass + 1;
      v_log := v_log || 'E2|PASS|the mark was actually corrected to absent'::text;
    else
      v_fail := v_fail + 1;
      v_log := v_log || format('E2|FAIL|mark is %s, expected absent', coalesce(v_att_status, 'missing'));
    end if;

    select cs.eligibility_snapshot_at into v_marker2
    from public.class_sessions cs where cs.id = v_session;

    select coalesce(array_agg(e.student_id order by e.student_id), '{}')
      into v_snap2
    from public.class_session_eligible_students e
    where e.class_session_id = v_session;

    if v_marker2 = v_marker and v_snap2 = v_snap then
      v_pass := v_pass + 1;
      v_log := v_log || 'E3|PASS|correction left the marker and every snapshot row untouched (write-once held)'::text;
    else
      v_fail := v_fail + 1;
      v_log := v_log || format('E3|FAIL|marker %s -> %s, snapshot %s -> %s', v_marker, v_marker2, v_snap, v_snap2);
    end if;
  end if;

  -- =========================================================================
  -- F. WRITE-ONCE AT RUNTIME — the client path cannot touch the snapshot
  -- =========================================================================
  -- Exercised as the real `authenticated` role, so these are genuine
  -- privilege denials, not a reading of the catalog. Each runs in its own
  -- exception block/subtransaction.
  if v_admin_user is null then
    v_log := v_log || 'F|NOT TESTED|no authorized caller (see SETUP)'::text;
    v_skip := v_skip + 1;
  else
    perform set_config('request.jwt.claims',
            json_build_object('sub', v_admin_user, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
    execute 'set local role authenticated';

    begin
      update public.class_session_eligible_students
      set provenance = 'backfill_drift'
      where class_session_id is not null;
      v_fail := v_fail + 1;
      v_log := v_log || 'F1|FAIL|authenticated was able to UPDATE a snapshot row'::text;
    exception
      when insufficient_privilege then
        v_pass := v_pass + 1;
        v_log := v_log || 'F1|PASS|UPDATE denied to authenticated (42501)'::text;
      when others then
        v_fail := v_fail + 1;
        v_log := v_log || format('F1|FAIL|unexpected %s: %s', sqlstate, sqlerrm);
    end;

    begin
      delete from public.class_session_eligible_students
      where class_session_id is not null;
      v_fail := v_fail + 1;
      v_log := v_log || 'F2|FAIL|authenticated was able to DELETE a snapshot row'::text;
    exception
      when insufficient_privilege then
        v_pass := v_pass + 1;
        v_log := v_log || 'F2|PASS|DELETE denied to authenticated (42501)'::text;
      when others then
        v_fail := v_fail + 1;
        v_log := v_log || format('F2|FAIL|unexpected %s: %s', sqlstate, sqlerrm);
    end;

    begin
      insert into public.class_session_eligible_students
        (class_session_id, student_id, provenance)
      select cs.id, s.id, 'save'
      from public.class_sessions cs, public.students s
      limit 1;
      v_fail := v_fail + 1;
      v_log := v_log || 'F3|FAIL|authenticated was able to INSERT a snapshot row'::text;
    exception
      when insufficient_privilege then
        v_pass := v_pass + 1;
        v_log := v_log || 'F3|PASS|INSERT denied to authenticated (42501)'::text;
      when others then
        v_fail := v_fail + 1;
        v_log := v_log || format('F3|FAIL|unexpected %s: %s', sqlstate, sqlerrm);
    end;

    execute 'reset role';
  end if;

  -- =========================================================================
  -- G. ROLLBACK GUARANTEE
  -- =========================================================================
  v_log := v_log || format(
    'G1|INFO|everything above is discarded by the ROLLBACK below; baseline to restore: %s snapshot rows, %s markers, %s attendance rows',
    v_base_snap, v_base_mark, v_base_att);

  if v_fix_used then
    v_log := v_log || format(
      'G2|INFO|fixture rows to be discarded: batch %s + its series/schedule/enrollment/assignment/session. No student or membership was inserted, so no sequence was consumed and no ID gap remains.',
      v_fix_batch);
  end if;

  -- =========================================================================
  -- RECORD RESULTS
  -- =========================================================================
  insert into _verify_results (seq, test, status, detail)
  select t.ord::int,
         split_part(t.x, '|', 1),
         split_part(t.x, '|', 2),
         split_part(t.x, '|', 3)
  from unnest(v_log) with ordinality as t(x, ord);

  insert into _verify_results (seq, test, status, detail)
  values (9999, 'SUMMARY',
          case when v_fail = 0 then 'ALL PASS' else 'FAILURES' end,
          format('%s passed, %s failed, %s not tested', v_pass, v_fail, v_skip));
end $$;

select seq, test, status, detail
from _verify_results
order by seq;

rollback;

-- ===========================================================================
-- AFTER THE ROLLBACK — confirm nothing persisted
-- ===========================================================================
-- Run this separately, AFTER the block above has finished. The counts must
-- equal the baseline reported by the SETUP and G1 rows.
--
--   select
--     (select count(*) from public.class_session_eligible_students) as snapshot_rows,
--     (select count(*) from public.class_sessions
--       where eligibility_snapshot_at is not null)                  as markers,
--     (select count(*) from public.attendance)                      as attendance_rows,
--     (select count(*) from public.batch_enrollments
--       where status = 'inactive')                                  as inactive_enrollments,
--     -- must be 0: proves no fixture survived the rollback
--     (select count(*) from public.batches
--       where code like 'ZZV16A-%')                                 as leftover_fixtures;
--
-- It is deliberately left commented out: as a live statement it would become
-- the editor's last result set and hide the grid above.
-- ===========================================================================
