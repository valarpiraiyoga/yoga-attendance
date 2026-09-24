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
import { DEFAULT_MEMBERSHIP_SORT } from "@/lib/memberships/data";
import MembershipCardItem from "@/app/memberships/membership-card-item";
import MembershipTableRow from "@/app/memberships/membership-table-row";

// 3 columns at the widest (matches the Students list pattern and the approved
// reference) and `items-start` so a Cancelled membership's shorter card (no
// progress-bar footer) doesn't stretch to match a taller Active/Expired
// sibling in the same grid row — CardGrid's own default is items-stretch.
function MembershipCards({ memberships, today }) {
  return (
    <CardGrid ariaLabel="Memberships" className="items-start xl:grid-cols-3">
      {memberships.map((membership) => (
        <MembershipCardItem key={membership.id} membership={membership} today={today} />
      ))}
    </CardGrid>
  );
}

function MembershipTable({ memberships, today }) {
  return (
    <Panel className="overflow-hidden p-0 sm:p-0">
      {/* Nine columns: tighter cell padding (12px vs the default 20px) so the
          table fits a ~960px content column before it has to scroll. */}
      <Table aria-label="Memberships" className="[&_td]:px-3 [&_th]:px-3">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Membership</TableHead>
            <TableHead>Student</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Period</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Days Left</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {memberships.map((membership) => (
            <MembershipTableRow key={membership.id} membership={membership} today={today} />
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

/**
 * Membership results — Cards / Table view is a page-level `view` param
 * decided by `MembershipFilters`' `ViewSwitcher`, not client state here.
 * Same data and View action in both layouts; Edit / Renew / Cancel remain
 * on Membership Details (the card menu links to Edit / Renew directly).
 */
export default function MembershipList({ memberships, view = "cards", total, today, sort, sortOptions }) {
  return (
    <div className="mt-6">
      <ResultsHeader
        count={total}
        label={total === 1 ? "Membership" : "Memberships"}
        viewLabel={view === "table" ? "Table view" : "Card list view"}
        aside={
          <SortSelect
            id="membership-sort"
            options={sortOptions}
            value={sort}
            defaultValue={DEFAULT_MEMBERSHIP_SORT}
          />
        }
      />

      {view === "table" ? (
        <MembershipTable memberships={memberships} today={today} />
      ) : (
        <MembershipCards memberships={memberships} today={today} />
      )}
    </div>
  );
}
