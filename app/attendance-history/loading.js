import Container from "@/components/layout/Container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Attendance History loading state, in the proportions of
 * app/attendance-history/page.js: header with the date-range control, the
 * calendar / Quick dates column, and the toolbar plus date-group bars.
 *
 * No primary action — Attendance History is read-only. Serves both roles.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading attendance history</span>

      {/* Header strip: bleeds through the shell padding like PageHeader's compact form. */}
      <div className="-mx-4 -mt-2 mb-0 sm:-mx-6 lg:-mx-8 lg:-mt-6 lg:mb-4 lg:border-b lg:border-border lg:bg-surface">
        <div className="mx-auto hidden max-w-[1264px] flex-row items-center justify-between px-8 py-3 lg:flex">
          <div className="min-w-0">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="mt-1.5 h-3.5 w-64 max-w-full" />
          </div>
          <Skeleton className="h-9 w-64 rounded-md" />
        </div>
      </div>

      <Container>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-72 rounded-card" />
            <Skeleton className="hidden h-52 rounded-card lg:block" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Skeleton className="h-9 flex-1 rounded-md" />
              <Skeleton className="h-9 w-24 rounded-md" />
              <Skeleton className="h-9 w-36 rounded-md" />
            </div>
            <div className="mt-5 flex flex-col gap-3">
              <Skeleton className="h-11 rounded-lg" />
              <Skeleton className="ml-10 h-40 rounded-lg" />
              <Skeleton className="h-11 rounded-lg" />
              <Skeleton className="h-11 rounded-lg" />
            </div>
          </div>
        </div>
      </Container>
    </div>
  );
}
