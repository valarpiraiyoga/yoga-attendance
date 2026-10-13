import { Package } from "lucide-react";
import ContextCard from "@/components/ui/context-card";
import { KIND_LABELS } from "@/lib/packages/labels";

/**
 * The context card of every package popup: which package it is about (or a new one). Same slot and shape as the student,
 * schedule and session cards.
 */
export default function PackageContext({ pkg, title, detail }) {
  return (
    <ContextCard
      mark={
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Package className="size-5" />
        </span>
      }
      title={pkg?.name ?? title}
      detail={pkg ? KIND_LABELS[pkg.kind] : detail}
    />
  );
}
