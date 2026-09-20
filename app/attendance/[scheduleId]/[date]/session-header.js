import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Hash,
  Pencil,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import Tabs from "@/components/ui/tabs";
import { EntityDetailHeader } from "@/components/layout/EntityDetailHeader";
import FieldRow from "@/components/layout/FieldRow";
import { formatDateWithWeekday, formatTimeRange } from "@/lib/format";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import MarkSession from "@/app/attendance/[scheduleId]/[date]/mark-session";

function FieldValue({ children }) {
  return <p className="text-body font-medium break-words text-text-primary">{children}</p>;
}

/**
 * The heading shared by all three Session Details tabs (Overview / Eligible
 * Students / Attendance): back link, the session summary in the finalized
 * detail header (the one Batch, Membership and Schedule Details use), and the
 * session's tab navigation below that card — the batch is the anchor
 * (avatar, name, status, code), the session's facts sit below the divider as
 * `FieldRow`s, and the admin's Edit This Session / Mark Cancelled-or-Holiday
 * actions sit top-right, exactly as before.
 *
 * Everything shown is data the session already carries — there is no room /
 * location on a class session, so none is shown. `eligibleCount` is the
 * session's own Eligible Students count, passed in by the page (the same
 * schedule-scoped figure the tabs show).
 */
export default function SessionHeader({
  session,
  displayStatus,
  scheduleId,
  date,
  activeTab,
  eligibleCount,
  isAdmin,
  canEdit,
  canMarkException,
}) {
  const batchName = session.batches?.name ?? "—";
  const batchCode = session.batches?.code ?? null;
  const base = `/attendance/${scheduleId}/${date}`;
  const tabs = [
    { key: "overview", label: "Overview", href: base },
    { key: "eligible", label: "Eligible Students", href: `${base}?tab=eligible` },
    { key: "attendance", label: "Attendance", href: `${base}?tab=attendance` },
  ];

  const hasActions = isAdmin && (canEdit || canMarkException);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/attendance"
        className="text-body inline-flex w-fit items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Attendance
      </Link>

      <EntityDetailHeader
        className="mb-0"
        avatar={<Avatar name={batchName} shape="square" size="lg" />}
        title={batchName}
        status={
          <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}>{DISPLAY_STATUS_LABELS[displayStatus]}</Badge>
        }
        subMeta={
          batchCode ? (
            <span className="inline-flex items-center gap-1.5">
              <Hash className="size-3.5 shrink-0" aria-hidden="true" />
              Batch Code: {batchCode}
            </span>
          ) : null
        }
        actions={
          hasActions ? (
            <>
              {canEdit ? (
                <Button variant="outline" render={<Link href={`${base}/edit`} />} nativeButton={false}>
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit This Session
                </Button>
              ) : null}
              {canMarkException ? <MarkSession scheduleId={scheduleId} date={date} /> : null}
            </>
          ) : null
        }
        highlight={
          <div className="flex w-full flex-col gap-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
              <FieldRow icon={CalendarDays} label="Date">
                <FieldValue>{formatDateWithWeekday(session.session_date)}</FieldValue>
              </FieldRow>
              <FieldRow icon={Clock} label="Time">
                <FieldValue>{formatTimeRange(session.start_time, session.end_time)}</FieldValue>
              </FieldRow>
              <FieldRow icon={UserRound} label="Instructor">
                <FieldValue>{session.instructors?.full_name ?? "—"}</FieldValue>
              </FieldRow>
              <FieldRow icon={Users} label="Eligible Students">
                <FieldValue>{eligibleCount ?? 0}</FieldValue>
              </FieldRow>
            </div>
            {session.note ? (
              <FieldRow icon={ClipboardCheck} label="Session Note" className="border-t border-border pt-4">
                <p className="text-body break-words whitespace-pre-line text-text-primary">{session.note}</p>
              </FieldRow>
            ) : null}
          </div>
        }
      />

      <Tabs as="link" items={tabs} active={activeTab} ariaLabel="Session sections" />
    </div>
  );
}
