import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The Export control every Reports results screen shows next to its title
 * (approved wireframes p.35–37: a single "Export" affordance branching into
 * CSV and Excel). One shared component rather than three near-identical
 * copies — the markup is genuinely identical across all three reports; only
 * `type` and `params` (the current filters) differ.
 *
 * Plain `<a>` elements, not `next/link` — these are file downloads, not app
 * navigation. The server sets `Content-Disposition: attachment` on the
 * response, so a normal browser click downloads the file regardless of the
 * anchor styling; using `Link` here would gain nothing and risks the
 * router's own prefetch/interception behaviour for no benefit.
 *
 * `params` carries exactly the filters the results screen was rendered
 * with (`from`, `to`, and `student`/`batch` where that report has one) —
 * the export therefore always reflects what is currently on screen, never a
 * stale or default selection.
 *
 * `/reports/export` (`app/reports/export/route.js`) independently enforces
 * Admin-only access — a Route Handler is not covered by this segment's
 * layout — so this component adds no authorization logic of its own.
 *
 * @param {"student"|"batch"|"summary"} type
 * @param {Record<string, string>} params
 */
export default function ExportLinks({ type, params }) {
  function hrefFor(format) {
    const query = new URLSearchParams({ type, format, ...params });
    return `/reports/export?${query.toString()}`;
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button variant="outline" size="sm" render={<a href={hrefFor("csv")} />} nativeButton={false}>
        <Download aria-hidden="true" />
        Export CSV
      </Button>
      <Button variant="outline" size="sm" render={<a href={hrefFor("xlsx")} />} nativeButton={false}>
        <Download aria-hidden="true" />
        Export Excel
      </Button>
    </div>
  );
}
