import Container from "@/components/layout/Container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Attendance loading state (app/attendance/page.js: Today's Sessions and All
 * Sessions), in the proportions of the finalized layout: the header strip, the
 * view tabs, the toolbar, and a few session cards.
 *
 * Attendance is the page the performance audit flagged hardest — each row
 * costs its own eligibility + marks lookup, so it is also where a shell on
 * screen matters most. The boundary shows the structure immediately while
 * those reads complete; it does not change how they are fetched. Serves both
 * views and both roles; the calendar column of All Sessions is not drawn,
 * since a placeholder that is slightly off for one view beats reading the URL
 * here just to size a skeleton.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading attendance</span>

      {/* Header strip: bleeds through the shell padding like PageHeader's compact form. */}
      <div className="-mx-4 -mt-2 mb-0 sm:-mx-6 lg:-mx-8 lg:-mt-6 lg:mb-4 lg:border-b lg:border-border lg:bg-surface">
        <div className="mx-auto hidden max-w-[1264px] flex-row items-center justify-between px-8 py-3 lg:flex">
          <div className="min-w-0">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="mt-1.5 h-3.5 w-64 max-w-full" />
          </div>
          <Skeleton className="h-9 w-56 rounded-md" />
        </div>
      </div>

      <Container>
        <Skeleton className="mb-4 h-9 w-72 max-w-full rounded-lg" />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Skeleton className="h-9 flex-1 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-56 rounded-card" />
          <Skeleton className="h-56 rounded-card" />
          <Skeleton className="hidden h-56 rounded-card xl:block" />
        </div>
      </Container>
    </div>
  );
}
