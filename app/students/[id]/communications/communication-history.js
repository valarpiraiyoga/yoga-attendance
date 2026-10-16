import { CalendarClock, MessagesSquare, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { FOLLOW_UP_STATUS } from "@/lib/communications/core";
import AddCommunication, { EditCommunication } from "@/app/students/[id]/communications/add-communication";
import CompleteFollowUp from "@/app/students/[id]/communications/complete-follow-up";

/**
 * Student Details → Communication History (migration 0057): the student's communications, newest first. Each shows its subject,
 * type, date and time, notes, who recorded it and - when it has one - the follow-up (due date, note, Pending or Completed, and
 * who completed it). A pending follow-up offers Mark as Completed, and every record a subtle Edit (pencil) that opens the same form
 * with its current values (migration 0058). Add Communication sits in the panel header and in the empty state.
 *
 * `communications` is null when the history could not be loaded: the panel says so and the rest of the page still works.
 */
export default function CommunicationHistory({ studentId, student, timeZone, communications }) {
  return (
    <Panel>
      <PanelHeader
        icon={MessagesSquare}
        title="Communication History"
        className="flex-col items-start sm:flex-row sm:items-center"
        action={
          communications && communications.length > 0 ? (
            <AddCommunication studentId={studentId} student={student} timeZone={timeZone} size="default" />
          ) : null
        }
      />

      {communications === null ? (
        <EmptyState size="compact" title="Communication history is not available right now" description="Try refreshing the page." />
      ) : communications.length === 0 ? (
        <EmptyState
          size="sm"
          title="No communications yet"
          description="No communication records have been added for this student yet."
          action={<AddCommunication studentId={studentId} student={student} timeZone={timeZone} variant="outline" />}
        />
      ) : (
        // A timeline: one vertical rail down the left (through the centre of the 24px markers), a brand dot per record, and a divider
        // between records in the content column only.
        <ol
          aria-label="Communications, newest first"
          className="relative flex flex-col before:absolute before:top-2 before:bottom-0 before:left-3 before:w-px before:-translate-x-1/2 before:bg-border"
        >
          {communications.map((item) => (
            <CommunicationItem key={item.id} item={item} studentId={studentId} student={student} timeZone={timeZone} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function CommunicationItem({ item, studentId, student, timeZone }) {
  const followUp = item.followUp;
  const status = followUp ? FOLLOW_UP_STATUS[followUp.status] : null;

  return (
    <li className="group relative flex gap-4">
      {/* An opaque surface under the tinted ring, so the rail does not show through the marker. */}
      <span aria-hidden="true" className="relative mt-0.5 size-6 shrink-0 rounded-full bg-surface">
        <span className="flex size-full items-center justify-center rounded-full bg-brand/10">
          <span className="size-2.5 rounded-full bg-brand" />
        </span>
      </span>

      <div className="min-w-0 flex-1 border-b border-border py-5 group-first:pt-0 group-last:border-b-0 group-last:pb-0">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-body font-semibold break-words text-text-primary">{item.subject}</p>
            <Badge variant="neutral">{item.typeLabel}</Badge>
          </div>
          <EditCommunication
            studentId={studentId}
            student={student}
            timeZone={timeZone}
            communicationId={item.id}
            draft={item.editDraft}
            subject={item.subject}
          />
        </div>
        <p className="text-small mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-text-secondary">
          <time dateTime={item.communicatedAt}>{item.dateTimeLabel}</time>
          <span aria-hidden="true" className="h-3.5 w-px bg-border" />
          <span className="inline-flex items-center gap-1.5">
            <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
            Recorded by {item.recordedBy}
          </span>
        </p>
        <p className="text-body mt-3 break-words whitespace-pre-line text-text-primary">{item.notes}</p>

        {followUp ? (
          <div className="mt-4 flex flex-col gap-3 rounded-card border border-border bg-background px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-small inline-flex items-center gap-2 font-semibold text-text-primary">
                  <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
                  Follow-up due {followUp.dateLabel}
                </span>
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
              <p className="text-small mt-2 break-words whitespace-pre-line text-text-primary">{followUp.note}</p>
              {followUp.status === "completed" ? (
                <p className="text-small mt-1 text-text-secondary">
                  Completed {followUp.completedAtLabel}
                  {followUp.completedBy ? ` by ${followUp.completedBy}` : ""}
                </p>
              ) : null}
            </div>
            {followUp.status === "pending" ? (
              <div className="shrink-0">
                <CompleteFollowUp
                  studentId={studentId}
                  student={student}
                  communicationId={item.id}
                  subject={item.subject}
                  dueLabel={followUp.dateLabel}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
