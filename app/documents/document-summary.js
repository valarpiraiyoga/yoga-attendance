import { Banknote, CircleCheck, CircleX, FileText } from "lucide-react";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { formatCurrency } from "@/lib/currencies";
import { formatShare } from "@/lib/format";

const UNAVAILABLE = "—";

/**
 * The Documents register's KPI tiles - the list-page KPI strip pattern (Memberships, Students, Batches): center-wide figures,
 * independent of the search and filters below. Total counts every stored document, issued and cancelled; Issued Value adds up
 * the issued documents only, never a cancelled one, and is not a revenue or collections figure. More than one currency is never
 * added together: the largest total is the value and any other currency is listed beneath it.
 *
 * `summary` is null when the figures could not be loaded: the tiles then show a dash and the list below still works.
 */
export default function DocumentSummary({ summary, currency }) {
  const [primary, ...others] = summary?.issuedValue ?? [];

  const issuedValue = summary ? formatCurrency(primary?.amount ?? 0, primary?.currency ?? currency) : UNAVAILABLE;
  const valueCaption = others.length > 0 ? `+ ${others.map((entry) => formatCurrency(entry.amount, entry.currency)).join(" + ")}` : null;

  return (
    <StatTileGroup className="mb-6" ariaLabel="Document summary">
      <StatTile
        valueFirst
        icon={FileText}
        label="Total Documents"
        value={summary ? summary.total : UNAVAILABLE}
        caption={summary ? null : "Summary unavailable"}
        tone="brand"
      />
      <StatTile
        valueFirst
        icon={CircleCheck}
        label="Issued"
        value={summary ? summary.issued : UNAVAILABLE}
        aside={summary ? formatShare(summary.issued, summary.total) : null}
        tone="success"
      />
      <StatTile
        valueFirst
        icon={CircleX}
        label="Cancelled"
        value={summary ? summary.cancelled : UNAVAILABLE}
        aside={summary ? formatShare(summary.cancelled, summary.total) : null}
        tone="danger"
      />
      <StatTile valueFirst icon={Banknote} label="Issued Value" value={issuedValue} caption={valueCaption} tone="info" />
    </StatTileGroup>
  );
}
