import { CalendarClock } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatDate } from "@/lib/format";
import { NO_EXPIRY_LABEL } from "@/lib/memberships/period";
import EditExpiryDialog from "@/app/memberships/[id]/edit-expiry-dialog";

/** `12 Oct 2026, 4:05 pm` in the centre's time zone. */
function formatStamp(value, timeZone) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(new Date(value));
}

const expiryText = (value) => (value ? formatDate(value) : NO_EXPIRY_LABEL);

/**
 * Expiry of a class-count membership (Membership Details, every class-count membership - legacy or package-linked): the current
 * expiry, the Edit expiry action (Admin only; the page is Admin-only) and the history of every change - the previous and new
 * expiry, the reason, who made it and when. The history is read from `class_count_expiry_edits` (migration 0049); nothing here
 * changes a membership.
 *
 * @param {{ membershipId: string, expiry: string|null, startDate: string, edits: object[], timeZone: string,
 *   student: object|null, membership: { code: string, planLabel: string, period: string } }} props
 */
export default function ExpiryPanel({ membershipId, expiry, startDate, edits, timeZone, student, membership }) {
  return (
    <Panel aria-label="Expiry">
      <PanelHeader
        icon={CalendarClock}
        title="Expiry"
        description={`Current expiry: ${expiryText(expiry)}`}
        action={
          <EditExpiryDialog
            membershipId={membershipId}
            currentExpiry={expiry}
            startDate={startDate}
            student={student}
            membership={membership}
          />
        }
        className="mb-4 min-h-8"
      />
      {edits.length === 0 ? (
        <EmptyState size="sm" title="No expiry changes" description="Changes to this membership's expiry appear here, with their reason." />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {edits.map((edit) => (
            <li key={edit.id} className="flex flex-col gap-0.5 py-2.5">
              <span className="text-body font-medium text-text-primary">
                {expiryText(edit.previousExpiry)} → {expiryText(edit.newExpiry)}
              </span>
              <span className="text-small text-text-secondary">
                {formatStamp(edit.editedAt, timeZone)}
                {edit.editedBy ? ` by ${edit.editedBy}` : ""}
              </span>
              <span className="text-small break-words whitespace-pre-line text-text-secondary">Reason: {edit.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
