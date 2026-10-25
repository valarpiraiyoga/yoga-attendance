import { CalendarClock, CalendarDays, MessageCircle, MessageSquare, MessagesSquare, Phone, Users } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { COMMUNICATION_HISTORY_ANCHOR, FOLLOW_UP_STATUS } from "@/lib/communications/core";
import AddCommunication, { EditCommunication } from "@/app/students/[id]/communications/add-communication";
import CommunicationAccordion from "@/app/students/[id]/communications/communication-accordion";
import CompleteFollowUp from "@/app/students/[id]/communications/complete-follow-up";

/**
 * Student Details → Communication History (migration 0057): the student's communications, newest first. Each shows its subject,
 * type, date and time, notes, who recorded it and - when it has one - the follow-up (due date, note, Pending or Completed, and
 * who completed it). Each record is an accordion (`CommunicationAccordion`): a chevron beside the Edit pencil opens and closes its
 * notes and follow-up. A pending follow-up offers Mark as Completed, and every record a subtle Edit (pencil) that opens the same form
 * with its current values (migration 0058). Add Communication sits in the panel header and in the empty state.
 *
 * `communications` is null when the history could not be loaded: the panel says so and the rest of the page still works.
 *
 * The panel carries `COMMUNICATION_HISTORY_ANCHOR`, so the reminder message popup's View Communication History opens this same panel.
 */
export default function CommunicationHistory({ studentId, student, timeZone, communications }) {
  return (
    <Panel id={COMMUNICATION_HISTORY_ANCHOR} className="scroll-mt-6">
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
          action={<AddCommunication studentId={studentId} student={student} timeZone={timeZone} variant="secondary" />}
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

// The channel badge: a soft pill with the channel's icon (presentation only - the stored type decides it).
const CHANNEL_BADGE = {
  whatsapp: { variant: "success", Icon: MessageCircle },
  phone_call: { variant: "info", Icon: Phone },
  in_person: { variant: "default", Icon: Users },
  other: { variant: "neutral", Icon: MessageSquare },
};

/** "Calendar icon + text", then a hairline, then the recorder's avatar and "by name" - the metadata row of a record and of a completed follow-up. */
function MetaRow({ label, dateTime, by, className }) {
  return (
    <p className={`text-small flex flex-wrap items-center gap-x-3 gap-y-1 text-text-secondary ${className ?? ""}`}>
      <span className="inline-flex items-center gap-1.5">
        <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
        {dateTime}
      </span>
      {by ? (
        <>
          <span aria-hidden="true" className="h-3.5 w-px bg-border" />
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={by} size="sm" className="size-5 text-[0.625rem]" />
            <span>
              <span className="sr-only">{label} </span>by {by}
            </span>
          </span>
        </>
      ) : null}
    </p>
  );
}

function CommunicationItem({ item, studentId, student, timeZone }) {
  const followUp = item.followUp;
  const status = followUp ? FOLLOW_UP_STATUS[followUp.status] : null;

  return (
    <li className="group relative flex gap-4">
      {/* An opaque surface under the tinted ring, so the rail does not show through the marker. */}
      <span aria-hidden="true" className="relative mt-5.5 size-6 shrink-0 rounded-full bg-surface group-first:mt-0.5">
        <span className="flex size-full items-center justify-center rounded-full bg-brand/10">
          <span className="size-2.5 rounded-full bg-brand" />
        </span>
      </span>

      <div className="min-w-0 flex-1 border-b border-border py-5 group-first:pt-0 group-last:border-b-0 group-last:pb-0">
        <CommunicationAccordion
          subject={item.subject}
          title={
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-section-title font-semibold break-words text-text-primary">{item.subject}</p>
              <Badge variant={(CHANNEL_BADGE[item.type] ?? CHANNEL_BADGE.other).variant}>
                {(() => {
                  const { Icon } = CHANNEL_BADGE[item.type] ?? CHANNEL_BADGE.other;
                  return <Icon className="size-3.5" aria-hidden="true" />;
                })()}
                {item.typeLabel}
              </Badge>
            </div>
          }
          meta={
            <MetaRow
              className="mt-1"
              label="Recorded"
              dateTime={<time dateTime={item.communicatedAt}>{item.dateTimeLabel}</time>}
              by={item.recordedBy}
            />
          }
          actions={
            <EditCommunication
              studentId={studentId}
              student={student}
              timeZone={timeZone}
              communicationId={item.id}
              draft={item.editDraft}
              subject={item.subject}
            />
          }
          collapsedHint={
            followUp ? (
              <span className="text-small inline-flex items-center gap-2 text-text-secondary">
                <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
                Follow-up due {followUp.dateLabel}
                <Badge variant={status.variant}>{status.label}</Badge>
              </span>
            ) : null
          }
        >
          {item.notes ? <p className="text-body mt-3 break-words whitespace-pre-line text-text-primary">{item.notes}</p> : null}

          {followUp ? (
            <div className="mt-4 flex flex-col gap-3 rounded-card border border-border bg-brand/5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-body inline-flex items-center gap-2 font-semibold text-text-primary">
                    <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
                    Follow-up due {followUp.dateLabel}
                  </span>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
                {followUp.note ? <p className="text-body mt-2 break-words whitespace-pre-line text-text-primary">{followUp.note}</p> : null}
                {followUp.status === "completed" ? (
                  <MetaRow className="mt-2" label="Completed" dateTime={`Completed ${followUp.completedAtLabel}`} by={followUp.completedBy} />
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
        </CommunicationAccordion>
      </div>
    </li>
  );
}
