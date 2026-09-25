import { Hash } from "lucide-react";
import BatchAvatar from "@/components/ui/batch-avatar";
import { cn } from "@/lib/utils";

/**
 * A deliberately simple header for the Edit Batch form: which batch is this? Its
 * own mark (saved colour / image / initials - `BatchAvatar`), the name large, and
 * its short code. Nothing else - the form below is where the details live. It shows
 * the SAVED batch and does not follow what is being typed.
 *
 * @param {object} props
 * @param {{ name: string, code?: string }} props.batch
 */
export default function BatchIdentityHeader({ batch, className }) {
  return (
    <div className={cn("flex items-center gap-3 border-b border-border pb-5", className)}>
      <BatchAvatar batch={batch} size="lg" />
      <div className="min-w-0">
        <p className="text-page-title font-semibold break-words text-text-primary">{batch.name}</p>
        {batch.code ? (
          <p className="mt-1 inline-flex items-center gap-1.5 text-small text-text-secondary">
            <Hash className="size-3.5 shrink-0" aria-hidden="true" />
            Code: {batch.code}
          </p>
        ) : null}
      </div>
    </div>
  );
}
