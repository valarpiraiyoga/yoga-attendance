import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/layout/Panel";
import TabContentHeading from "@/components/layout/TabContentHeading";
import { cn } from "@/lib/utils";

/**
 * The shared shell of every Reports filter form (`17 Reports student
 * addendance.png`): a panel with the tab's own heading, the report's fields,
 * and the Clear / Generate Report actions, plus the inline validation
 * message. The three filter components (Student, Batch, Attendance Summary)
 * keep their own state, validation and navigation — this owns only the
 * layout and the two buttons, which were identical across all three.
 *
 * Fields go in as `children` (each a `FormField`); a picker field spans two
 * of the four desktop columns via `hasPicker`, the date-only Attendance
 * Summary form does not have one. On narrow screens the fields stack and the
 * actions sit below them.
 */
export default function ReportFormPanel({
  icon,
  title,
  description,
  hasPicker = false,
  onSubmit,
  onClear,
  isPending,
  error,
  children,
}) {
  return (
    <Panel>
      <TabContentHeading icon={icon} title={title} description={description} />

      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end">
        <div
          className={cn(
            "grid flex-1 gap-4 sm:grid-cols-2",
            hasPicker ? "lg:grid-cols-4" : "lg:max-w-xl"
          )}
        >
          {children}
        </div>

        <div className="flex items-center gap-3 lg:shrink-0">
          <Button type="button" variant="outline" onClick={onClear} disabled={isPending}>
            Clear
          </Button>
          <Button type="submit" disabled={isPending}>
            <FileText aria-hidden="true" />
            {isPending ? "Generating…" : "Generate Report"}
          </Button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="text-small mt-3 text-danger">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}
