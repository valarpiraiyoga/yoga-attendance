"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import SearchInput from "@/components/ui/search-input";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatCurrency } from "@/lib/currencies";
import { formatPeriod } from "@/lib/memberships/period";
import { filterMemberships } from "@/lib/memberships/list-panel-core";
import { MEMBERSHIP_STATUS, PLAN } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Membership Details → Membership History on the left: every membership of this membership's student (the current one
 * highlighted with a blue border and a narrow blue bar on its left), each card opening that membership's details.
 *
 *   header   the title with the count, and Add Membership (the existing flow, for this student)
 *   search   by membership number or plan (no filters)
 *   cards    compact: membership number and dates; the amount, the derived status and a chevron. No invoice / receipt numbers
 *            (they are on the Payments card) and no plan line (the search still finds it)
 *
 * The search narrows the list on screen only - it works on the memberships the page already loaded, changes nothing, and never
 * touches the details on the right. `currentId` stays highlighted whether or not it matches.
 */
export default function MembershipListPanel({ memberships, currentId, studentId }) {
  const searchId = useId();
  const [q, setQ] = useState("");

  const visible = useMemo(() => filterMemberships(memberships, { q }, PLAN), [memberships, q]);
  const isSearching = Boolean(q.trim());

  return (
    <Panel aria-label="Membership History" className="sm:p-4">
      <PanelHeader
        icon={FileText}
        tone="brand"
        title={`Membership History (${memberships.length})`}
        action={
          <Button
            size="icon-sm"
            aria-label="Add Membership"
            title="Add Membership"
            render={<Link href={`/students/${studentId}/memberships/new`} />}
            nativeButton={false}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        }
        className="mb-3"
      />

      <SearchInput
        id={searchId}
        label="Search memberships"
        type="search"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        onClear={() => setQ("")}
        placeholder="Search by ID or plan..."
        inputClassName="h-9 bg-surface"
      />

      {visible.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            size="compact"
            title="No memberships match"
            description={isSearching ? "Try a different search." : "This student has no memberships."}
            action={
              isSearching ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setQ("")}>
                  Clear Search
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <ul aria-label="Memberships of this student" className="mt-3 flex flex-col gap-1.5">
          {visible.map((membership) => {
            const state = MEMBERSHIP_STATUS[membership.status] ?? MEMBERSHIP_STATUS.expired;
            const isCurrent = membership.id === currentId;
            return (
              <li
                key={membership.id}
                className={cn(
                  "relative flex items-center gap-2 overflow-hidden rounded-card border bg-surface py-2 pr-2.5 pl-3.5 transition-colors focus-within:ring-3 focus-within:ring-ring/50",
                  isCurrent ? "border-brand bg-brand/5" : "border-border hover:border-brand/40 hover:bg-background",
                )}
              >
                {isCurrent ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-brand" /> : null}
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/memberships/${membership.id}`}
                    aria-current={isCurrent ? "page" : undefined}
                    aria-label={`Membership ${membership.membership_code}, ${state.label}${isCurrent ? ", showing now" : ""}. Open Membership Details`}
                    className="text-body block w-fit font-semibold text-text-primary outline-none after:absolute after:inset-0 after:content-['']"
                  >
                    {membership.membership_code}
                  </Link>
                  <p className="text-small text-text-secondary">{formatPeriod(membership.start_date, membership.end_date)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-body font-semibold whitespace-nowrap text-text-primary tabular-nums">
                    {formatCurrency(membership.amount, membership.currency)}
                  </span>
                  <Badge variant={state.variant}>{state.label}</Badge>
                </div>
                <ChevronRight className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
