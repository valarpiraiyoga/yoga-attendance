import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { DEFAULT_BATCH_SORT } from "@/lib/batches/data";
import { cn } from "@/lib/utils";
import BatchCardItem from "@/app/batches/batch-card-item";
import BatchTable from "@/app/batches/batch-table";

/**
 * Batch results: the summary row ("N Batches", with "Sort by" on its right —
 * below the toolbar, the finalized pattern) over either the card grid or the
 * table. `view` is `"cards"`, `"table"`, or `""` (no explicit choice in the
 * URL, the page-level `view` param decided by `BatchFilters`' `ViewSwitcher`):
 * then both are rendered and CSS shows Cards below `lg` and Table from `lg`
 * up — the same finalized default rule as Attendance and Schedule. Same data
 * and View action in both; status changes remain on Edit Batch.
 *
 * Cards: 3 columns at the widest and `items-start`, so a batch with a short
 * schedule summary doesn't stretch to match a taller sibling in the row.
 */
export default function BatchList({ batches, view = "", total, sort, sortOptions }) {
  return (
    <div className="mt-5">
      <ResultsHeader
        count={total}
        label={total === 1 ? "Batch" : "Batches"}
        className="mb-3 flex-row items-center justify-between"
        aside={
          <SortSelect
            id="batch-sort"
            options={sortOptions}
            value={sort}
            defaultValue={DEFAULT_BATCH_SORT}
            compactOnMobile
          />
        }
      />

      {view !== "table" ? (
        <CardGrid ariaLabel="Batches" className={cn("items-start xl:grid-cols-3", view === "" && "lg:hidden")}>
          {batches.map((batch) => (
            <BatchCardItem key={batch.id} batch={batch} />
          ))}
        </CardGrid>
      ) : null}

      {view !== "cards" ? (
        <div className={cn(view === "" && "hidden lg:block")}>
          <BatchTable batches={batches} />
        </div>
      ) : null}
    </div>
  );
}
