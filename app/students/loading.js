import Container from "@/components/layout/Container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Students list loading state (app/students/page.js), in the proportions of
 * the finalized layout: the header strip, the toolbar, the summary row and a
 * few student cards. Serves the `new` and `[id]` routes too, which sit under
 * the same loading boundary.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading students</span>

      {/* Header strip: bleeds through the shell padding like PageHeader's compact form. */}
      <div className="-mx-4 -mt-2 mb-0 sm:-mx-6 lg:-mx-8 lg:-mt-6 lg:mb-4 lg:border-b lg:border-border lg:bg-surface">
        <div className="mx-auto hidden max-w-[1264px] flex-row items-center justify-between px-8 py-3 lg:flex">
          <div className="min-w-0">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="mt-1.5 h-3.5 w-72 max-w-full" />
          </div>
          <Skeleton className="h-9 w-44 rounded-md" />
        </div>
      </div>

      <Container>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Skeleton className="h-9 flex-1 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
        <Skeleton className="mt-5 h-6 w-28" />
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-44 rounded-card" />
          <Skeleton className="h-44 rounded-card" />
          <Skeleton className="hidden h-44 rounded-card xl:block" />
        </div>
      </Container>
    </div>
  );
}
