"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { saveSessionAttendance } from "@/lib/attendance/actions";
import { validateAttendanceMarks, computeAttendanceSummary } from "@/lib/attendance/validation";
import { pendingReviewStorageKey } from "@/app/attendance-history/[scheduleId]/[date]/edit/edit-attendance-form";

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function statusLabel(status) {
  if (status === "present") return "Present";
  if (status === "absent") return "Absent";
  return "Unmarked";
}

function statusBadgeVariant(status) {
  if (status === "present") return "success";
  if (status === "absent") return "danger";
  return "neutral";
}

function marksToMap(marks) {
  const map = {};
  for (const mark of marks) {
    map[mark.student_id] = mark.status;
  }
  return map;
}

function noopSubscribe() {
  // sessionStorage never changes on its own from this tab's point of view
  // (the browser's own `storage` event only fires in *other* tabs/windows),
  // so there is nothing to subscribe to — this store has exactly one
  // meaningful read, taken once after hydration.
  return () => {};
}

// The raw JSON string only — never the parsed/validated/filtered result.
// `useSyncExternalStore` requires `getSnapshot` to return a stable,
// comparable value across calls when nothing has changed; a string
// satisfies that on its own, whereas returning a freshly-parsed array or
// object every call would look like a change on every render and loop.
// Parsing, validating and filtering happen afterwards, in a plain
// `useMemo` keyed on this string.
function getStorageSnapshot(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function getServerSnapshot() {
  // No sessionStorage on the server — `null` here matches what a real,
  // empty client read would also see, so there is nothing to reconcile
  // beyond the ordinary "hydrate, then pick up the real value" pass
  // `useSyncExternalStore` already handles.
  return null;
}

/**
 * Review Attendance Changes (Phase 16; approved wireframe p.33) — the only
 * place in this flow that reads the Edit Attendance page's `sessionStorage`
 * draft (`pendingReviewStorageKey`, `edit-attendance-form.js`), because only
 * a client component can: a Server Component render happens on the server,
 * where `sessionStorage` does not exist.
 *
 * The draft is never trusted for anything beyond "which statuses does the
 * user want" — every fact this component treats as authoritative
 * (`session`, `eligibleStudents`, `originalMarks`, `originalSummary`) comes
 * from `page.js`'s own server-side fetch through the same
 * `getSessionOccurrence`/`listEligibleStudents`/`getAttendanceForSession`
 * calls Attendance Details and Edit Attendance already use, under the same
 * RLS. `sessionStorage` is retained, not replaced, because the underlying
 * problem was never "is sessionStorage the wrong tool" — a signed URL
 * param or a temporary database table would carry the exact same "don't
 * trust it" requirement, just with more moving parts (and a temporary
 * table is explicitly out of scope). The actual defect in the original
 * design was architectural: nothing previously read the draft anywhere,
 * since the Review page did not exist. Fixing that only required this
 * component to read it correctly (client-side, after mount, re-validated
 * on arrival, filtered to the server's own eligible list) rather than
 * swapping the mechanism.
 *
 * Every proposed mark is re-validated with the existing
 * `validateAttendanceMarks` (the same shape check `saveSessionAttendance`
 * itself runs) and then filtered to students in the server's own
 * `eligibleStudents` — a stray or tampered id in the draft is silently
 * dropped from what this page displays and would, independently, still be
 * rejected by `save_session_attendance`'s own re-validation if it somehow
 * reached Confirm & Save. Anything missing, unparsable, or invalid is
 * treated as "no proposed changes at all" — the same safe fallback a
 * genuinely unedited session produces — never as a reason to guess or
 * invent a change.
 *
 * "Changes to Review" only lists a student when their proposed status
 * differs from what is actually saved (`originalMarks`) — matching the
 * approved requirement exactly, not merely "every eligible student".
 *
 * Confirm & Save calls the existing, unmodified `saveSessionAttendance`
 * (lib/attendance/actions.js) directly — the same atomic
 * validate/re-authorize/re-resolve-eligibility/upsert/complete path Phase
 * 15 already built and Edit Attendance's own inline flow
 * (`attendance-panel.js`) already calls. No second save implementation
 * exists, and no ownership check is duplicated here: `save_session_attendance`
 * re-authorizes the caller against this exact session before writing
 * anything, admin-or-owning-instructor, exactly as it always has.
 */
export default function ReviewAttendanceChanges({
  scheduleId,
  date,
  session,
  eligibleStudents,
  originalMarks,
  originalSummary,
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState(null);
  const [isPending, startTransition] = useTransition();

  const storageKey = pendingReviewStorageKey(scheduleId, date);
  const rawDraft = useSyncExternalStore(noopSubscribe, () => getStorageSnapshot(storageKey), getServerSnapshot);

  // Falls back to the original marks — i.e. "no changes proposed" — for
  // every case that isn't a genuinely valid draft: no draft at all (direct
  // visit, storage cleared, private browsing, the pre-hydration instant
  // `useSyncExternalStore` itself passes through), a malformed one, or one
  // that fails shape validation. This is the same state a session with
  // zero real edits produces, so every one of those paths renders
  // identically as the no-changes state below — never a guess, never an
  // invented change.
  const proposedMarks = useMemo(() => {
    const eligibleIds = new Set(eligibleStudents.map((student) => student.id));

    let stored = null;
    try {
      stored = rawDraft ? JSON.parse(rawDraft) : null;
    } catch {
      stored = null;
    }

    const candidate = stored?.marks;
    const result = Array.isArray(candidate) ? validateAttendanceMarks(candidate) : { success: false };

    return result.success ? result.data.filter((mark) => eligibleIds.has(mark.student_id)) : originalMarks;
  }, [rawDraft, eligibleStudents, originalMarks]);

  const originalByStudentId = marksToMap(originalMarks);
  const proposedByStudentId = marksToMap(proposedMarks);

  const changes = eligibleStudents
    .map((student) => ({
      student,
      before: originalByStudentId[student.id] ?? null,
      after: proposedByStudentId[student.id] ?? null,
    }))
    .filter((change) => change.before !== change.after);

  const afterSummary = computeAttendanceSummary(eligibleStudents.length, proposedMarks);
  const hasChanges = changes.length > 0;

  function handleConfirmSave() {
    setFeedback(null);
    startTransition(async () => {
      const result = await saveSessionAttendance(scheduleId, date, proposedMarks);

      if (result?.error) {
        setFeedback(result.error);
        return;
      }

      try {
        window.sessionStorage.removeItem(pendingReviewStorageKey(scheduleId, date));
      } catch {
        // Nothing to clean up if storage is unavailable — the draft is
        // already unused once a save has succeeded.
      }

      // `?success=updated&changes=N` — Attendance Details' own post-save
      // banner (approved wireframe p.34) reads this the same way Session
      // Details already reads its own `?success=` param; only a
      // successful save reaches this line at all; a failed one returns
      // above and stays on this page instead.
      router.push(`/attendance-history/${scheduleId}/${date}?success=updated&changes=${changes.length}`);
    });
  }

  return (
    <div>
      <Link
        href={`/attendance-history/${scheduleId}/${date}/edit`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Edit Attendance
      </Link>

      <div className="mt-3">
        <h1 className="text-page-title font-semibold text-text-primary">Review Attendance Changes</h1>
        <p className="text-body mt-1 text-text-secondary">Review the changes before saving.</p>
      </div>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <h2 className="text-section-title font-semibold text-text-primary">Session Details</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
          <div>
            <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Batch</dt>
            <dd className="text-body text-text-primary">{session.batches?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Instructor</dt>
            <dd className="text-body text-text-primary">{session.instructors?.full_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Date &amp; Time</dt>
            <dd className="text-body text-text-primary">
              {formatDate(session.session_date)}, {formatTime(session.start_time)} – {formatTime(session.end_time)}
            </dd>
          </div>
        </dl>
      </div>

      {feedback ? (
        <p role="alert" className="mt-4 text-body text-danger">
          {feedback}
        </p>
      ) : null}

      {hasChanges ? (
        <>
          <div className="mt-6">
            <h2 className="text-section-title font-semibold text-text-primary">Changes to Review ({changes.length})</h2>
            <div className="mt-4 overflow-hidden rounded-card border border-border bg-surface">
              <Table aria-label="Changes to review">
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Current Status</TableHead>
                    <TableHead>New Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changes.map(({ student, before, after }) => (
                    <TableRow key={student.id}>
                      <TableCell className="font-medium text-text-primary">{student.full_name}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(before)}>{statusLabel(before)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(after)}>{statusLabel(after)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-primary">Comparative View</h2>
            <div className="mt-4 grid gap-6 sm:grid-cols-2">
              <div>
                <p className="text-small font-medium tracking-wide text-text-secondary uppercase">Current</p>
                <p className="text-body mt-1 text-text-primary">
                  {originalSummary.presentCount} Present · {originalSummary.absentCount} Absent ·{" "}
                  {originalSummary.percentage}% Attendance
                </p>
              </div>
              <div>
                <p className="text-small font-medium tracking-wide text-text-secondary uppercase">After Changes</p>
                <p className="text-body mt-1 text-text-primary">
                  {afterSummary.presentCount} Present · {afterSummary.absentCount} Absent ·{" "}
                  {afterSummary.percentage}% Attendance
                </p>
              </div>
            </div>
          </div>

          <p className="text-body mt-6 max-w-2xl text-text-secondary">
            This change updates attendance for this class session only. Historical session and schedule
            information remain unchanged.
          </p>

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              disabled={isPending}
              render={<Link href={`/attendance-history/${scheduleId}/${date}/edit`} />}
              nativeButton={false}
            >
              Back to Edit Attendance
            </Button>
            <Button type="button" disabled={isPending} onClick={handleConfirmSave}>
              {isPending ? "Saving…" : "Confirm & Save"}
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <p className="text-body max-w-sm text-text-secondary">
            No attendance changes to review. Nothing will be saved.
          </p>
          <Button variant="outline" render={<Link href={`/attendance-history/${scheduleId}/${date}/edit`} />} nativeButton={false}>
            Back to Edit Attendance
          </Button>
        </div>
      )}
    </div>
  );
}
