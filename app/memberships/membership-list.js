import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { DEFAULT_MEMBERSHIP_SORT } from "@/lib/memberships/data";
import { cn } from "@/lib/utils";
import MembershipCardItem from "@/app/memberships/membership-card-item";
import MembershipTable from "@/app/memberships/membership-table";

/**
 * Membership results: the summary row ("N Memberships", with "Sort by" on its
 * right — below the toolbar, the finalized pattern) over either the card grid
 * or the table. `view` is `"cards"`, `"table"`, or `""` (no explicit choice in
 * the URL, the page-level `view` param decided by `MembershipFilters`'
 * `ViewSwitcher`): then both are rendered and CSS shows Cards below `lg` and
 * Table from `lg` up — the same finalized default rule as the other list
 * pages. Same data and View action in both layouts; Edit / Renew / Cancel
 * remain on Membership Details (the menu links to Edit / Renew directly).
 *
 * Cards: 3 columns at the widest (the approved reference) and `items-start`,
 * so a Cancelled membership's shorter card (no progress-bar footer) doesn't
 * stretch to match a taller sibling in the same grid row.
 */
export default function MembershipList({ memberships, view = "", total, today, sort, sortOptions }) {
  return (
    <div className="mt-5">
      <ResultsHeader
        count={total}
        label={total === 1 ? "Membership" : "Memberships"}
        className="mb-3 flex-row items-center justify-between"
        aside={
          <SortSelect
            id="membership-sort"
            options={sortOptions}
            value={sort}
            defaultValue={DEFAULT_MEMBERSHIP_SORT}
            compactOnMobile
          />
        }
      />

      {view !== "table" ? (
        <CardGrid ariaLabel="Memberships" className={cn("items-start xl:grid-cols-3", view === "" && "lg:hidden")}>
          {memberships.map((membership) => (
            <MembershipCardItem key={membership.id} membership={membership} today={today} />
          ))}
        </CardGrid>
      ) : null}

      {view !== "cards" ? (
        <div className={cn(view === "" && "hidden lg:block")}>
          <MembershipTable memberships={memberships} today={today} />
        </div>
      ) : null}
    </div>
  );
}
