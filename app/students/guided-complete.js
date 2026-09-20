import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, UserPlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { PLAN } from "@/lib/status";
import GuidedSteps from "@/app/students/guided-steps";

/**
 * The Add Student flow's completion screen (`19 Form-summary.png`): all three
 * steps complete, a success message, a summary of what was just created and
 * the next places to go. It is rendered by Student Details when the flow's
 * last step redirects there with `?guided=1` (see `createEnrollment`) — no
 * route of its own. Everything shown is the student's real data: the
 * membership line appears only if the (skippable) membership step was
 * completed, and the batch is the enrollment that was just added.
 */
export default function GuidedComplete({ student, membership, enrollment }) {
  const batch = enrollment?.batches;
  const summaryLine = [
    membership ? `${PLAN[membership.plan] ?? membership.plan} Membership` : null,
    batch ? `Batch: ${batch.name}${batch.code ? ` (${batch.code})` : ""}` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/students"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Students
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Add Student</h1>
      <p className="text-body mt-1 text-text-secondary">Create a student profile to begin their enrollment setup.</p>

      <GuidedSteps current={3} complete />

      <section
        aria-labelledby="guided-complete-title"
        className="rounded-card border border-border bg-surface p-6 shadow-xs sm:p-8"
      >
        <div className="flex flex-col items-center text-center">
          <span
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-full bg-brand/10 text-brand"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-brand text-surface">
              <Check className="size-6" />
            </span>
          </span>
          <h2 id="guided-complete-title" className="text-page-title mt-4 font-semibold text-text-primary">
            Student Added Successfully!
          </h2>
          <p role="status" className="text-body mt-1 break-words text-text-secondary">
            {student.full_name} has been added and enrolled successfully.
          </p>
        </div>

        <div className="mt-6 flex items-center gap-4 rounded-lg border border-border bg-background/60 p-4 sm:p-5">
          <Avatar name={student.full_name} src={student.photo_url} size="lg" />
          <div className="min-w-0">
            <p className="text-body font-semibold break-words text-text-primary">{student.full_name}</p>
            <p className="text-small break-words text-text-secondary">
              {student.student_code}
              {student.phone ? ` | ${student.phone}` : ""}
            </p>
            {summaryLine.length > 0 ? (
              <p className="text-small break-words text-text-secondary">{summaryLine.join(" | ")}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Button variant="outline" render={<Link href={`/students/${student.id}`} />} nativeButton={false}>
            <UserRound className="size-4" aria-hidden="true" />
            View Student
          </Button>
          <Button variant="outline" render={<Link href="/students/new" />} nativeButton={false}>
            <UserPlus className="size-4" aria-hidden="true" />
            Add Another Student
          </Button>
          <Button render={<Link href="/students" />} nativeButton={false}>
            Go to Students
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </section>
    </div>
  );
}
