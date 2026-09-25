import { cn } from "@/lib/utils";

/**
 * The "this is about that record" card at the top of a popup: the record's own mark on the
 * left (a student's photo, a batch's colour tile, a session's start time), its name, one
 * quiet detail line, and one optional line of extra context. It answers "where am I, and
 * what will this act on?" before the person reads the question below it.
 *
 * It only shows; nothing here is editable. The domain wrappers (`StudentContext`,
 * `ScheduleContext`, `SessionContext`) decide what goes in each slot so every popup for the
 * same kind of record reads the same. Dialogs place it through their `context` slot.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.mark - the record's mark (Avatar, BatchAvatar, StartTimeTile).
 * @param {import("react").ReactNode} props.title - the record's name.
 * @param {import("react").ReactNode} [props.detail] - one secondary line (an ID, a date and time).
 * @param {import("react").ReactNode} [props.meta] - one more secondary line, usually an icon and a value.
 */
export default function ContextCard({ mark, title, detail, meta, className }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-border bg-background/60 p-3 text-left", className)}>
      {mark}
      <div className="min-w-0">
        <p className="text-body font-semibold break-words text-text-primary">{title}</p>
        {detail ? <p className="text-small text-text-secondary">{detail}</p> : null}
        {meta ? <p className="text-small mt-0.5 inline-flex items-center gap-1.5 text-text-secondary">{meta}</p> : null}
      </div>
    </div>
  );
}
