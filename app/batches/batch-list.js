import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Panel } from "@/components/layout/Panel";
import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { DEFAULT_BATCH_SORT } from "@/lib/batches/data";
import BatchCardItem from "@/app/batches/batch-card-item";
import BatchTableRow from "@/app/batches/batch-table-row";

function BatchCards({ batches }) {
  return (
    <CardGrid ariaLabel="Batches">
      {batches.map((batch) => (
        <BatchCardItem key={batch.id} batch={batch} />
      ))}
    </CardGrid>
  );
}

function BatchTable({ batches }) {
  return (
    <Panel className="overflow-hidden p-0 sm:p-0">
      {/* Eight columns: tighter cell padding (12px vs the default 20px) so the
          table fits a ~960px content column before it has to scroll. */}
      <Table aria-label="Batches" className="[&_td]:px-3 [&_th]:px-3">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Batch Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Instructor</TableHead>
            <TableHead>Days &amp; Time</TableHead>
            <TableHead>Students</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((batch) => (
            <BatchTableRow key={batch.id} batch={batch} />
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

/**
 * Batch results — Cards / Table view is a page-level `view` param decided by
 * `BatchFilters`' `ViewSwitcher`, not client state here. Same data and View
 * action in both layouts; status changes remain on Edit Batch.
 */
export default function BatchList({ batches, view = "cards", total, sort, sortOptions }) {
  return (
    <div className="mt-6">
      <ResultsHeader
        count={total}
        label={total === 1 ? "Batch" : "Batches"}
        viewLabel={view === "table" ? "Table view" : "Card list view"}
        aside={
          <SortSelect id="batch-sort" options={sortOptions} value={sort} defaultValue={DEFAULT_BATCH_SORT} />
        }
      />

      {view === "table" ? <BatchTable batches={batches} /> : <BatchCards batches={batches} />}
    </div>
  );
}
