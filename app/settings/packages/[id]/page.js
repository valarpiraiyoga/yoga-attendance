import { notFound } from "next/navigation";
import { History, Layers, Receipt } from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { Badge } from "@/components/ui/badge";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { todayDateString } from "@/lib/memberships/data";
import { getPackage } from "@/lib/packages/data";
import { EVENT_LABELS, KIND_LABELS, termsSummary } from "@/lib/packages/labels";
import { EditDetailsButton, EditTermsButton, StatusButton } from "@/app/settings/packages/package-dialogs";
import FeeHistory from "@/app/settings/packages/fee-history";

/** "Oct 13, 2026, 4:05 PM" in the centre timezone. */
function formatEventTime(value, timeZone) {
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone });
}

export default async function PackageDetailPage({ params }) {
  // Authorization boundary - see app/settings/layout.js for why it is repeated here.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const [pkg, today, timeZone] = await Promise.all([getPackage(id), todayDateString(), getCenterTimezone()]);
  if (!pkg) notFound();

  const active = pkg.status === "active";

  return (
    <>
      <PageHeader
        compact
        back={{ href: "/settings/packages", label: "Back to Packages & Fees" }}
        title={pkg.name}
        description={`${KIND_LABELS[pkg.kind]} package`}
        actions={<StatusButton pkg={pkg} />}
      />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <Panel>
          <PanelHeader icon={Layers} title="Package details" action={<EditDetailsButton pkg={pkg} />} />
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-small text-text-secondary">Name</dt>
              <dd className="text-body text-text-primary">{pkg.name}</dd>
            </div>
            <div>
              <dt className="text-small text-text-secondary">Type</dt>
              <dd className="text-body text-text-primary">{KIND_LABELS[pkg.kind]}</dd>
            </div>
            <div>
              <dt className="text-small text-text-secondary">Status</dt>
              <dd>
                <Badge variant={active ? "success" : "neutral"}>{active ? "Active" : "Inactive"}</Badge>
              </dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="text-small text-text-secondary">Description</dt>
              <dd className="text-body text-text-primary">{pkg.description ?? "No description."}</dd>
            </div>
          </dl>
        </Panel>

        <Panel>
          <PanelHeader
            icon={Layers}
            title={pkg.kind === "duration" ? "Duration options" : "Class allowance"}
            description="Changes apply to memberships created afterwards, never to existing ones."
            action={<EditTermsButton pkg={pkg} />}
          />
          <p className="text-body text-text-primary">{termsSummary(pkg)}</p>
        </Panel>

        <Panel>
          <PanelHeader
            icon={Receipt}
            title="Fee history"
            description={
              pkg.kind === "duration"
                ? "Monthly base fee and package discounts, by effective date."
                : "The price, by effective date."
            }
          />
          <FeeHistory pkg={pkg} entries={pkg.feeEntries} today={today} />
        </Panel>

        <Panel>
          <PanelHeader icon={History} title="History" description="Every change to this package and its fees, newest first." />
          <ul className="flex flex-col divide-y divide-border">
            {pkg.events.map((event) => (
              <li key={event.id} className="flex flex-col gap-0.5 py-2.5">
                <span className="text-body font-medium text-text-primary">{EVENT_LABELS[event.event_type] ?? event.event_type}</span>
                <span className="text-small text-text-secondary">{formatEventTime(event.occurred_at, timeZone)}</span>
                {event.reason ? <span className="text-small text-text-secondary">Reason: {event.reason}</span> : null}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
