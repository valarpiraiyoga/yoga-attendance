import Link from "next/link";
import { CalendarDays, Hash, Pencil, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import BatchAvatar from "@/components/ui/batch-avatar";
import Tabs from "@/components/ui/tabs";
import Container from "@/components/layout/Container";
import { EntityDetailHeader } from "@/components/layout/EntityDetailHeader";
import PageHeader from "@/components/layout/PageHeader";
import { Panel } from "@/components/layout/Panel";
import { formatDate } from "@/lib/format";
import { ENTITY_STATUS } from "@/lib/status";

/**
 * Batch Details' shared header + tab nav (wireframe p17-19; 02-ux.md: Overview
 * / Students / Schedules / Attendance — four real routes). The page starts with the
 * compact page strip (title + back button), then the finalized detail header (the same
 * one Student and Membership Details use, with the same teal wash): batch
 * avatar, name, status, code / category / created date and the description.
 * The tabs are the canonical underline `Tabs`, route-based.
 *
 * The Overview and Attendance pages lay out their own panels / list; the
 * Students and Schedules tabs' content is wrapped in one panel here, as it
 * always sat inside a single card.
 */
export default function BatchHeader({ batch, active, children }) {
  const status = ENTITY_STATUS[batch.status] ?? ENTITY_STATUS.inactive;
  const tabs = [
    { key: "overview", label: "Overview", href: `/batches/${batch.id}` },
    { key: "students", label: "Students", href: `/batches/${batch.id}/students` },
    { key: "schedules", label: "Schedules", href: `/batches/${batch.id}/schedules` },
    { key: "attendance", label: "Attendance", href: `/batches/${batch.id}/attendance` },
  ];

  return (
    <>
      <PageHeader
        compact
        back={{ href: "/batches", label: "Back to Batches" }}
        title="Batch Details"
        description={`Schedules, students and attendance for ${batch.name}.`}
      />
      <Container className="flex flex-col gap-6">
      <EntityDetailHeader
        decorative={false}
        wash
        className="mb-0"
        avatar={<BatchAvatar batch={batch} size="lg" />}
        title={batch.name}
        status={<Badge variant={status.variant}>{status.label}</Badge>}
        subMeta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Hash className="size-3.5 shrink-0" aria-hidden="true" />
              Code: {batch.code}
            </span>
            {batch.category ? (
              <span className="inline-flex items-center gap-1.5">
                <Tag className="size-3.5 shrink-0" aria-hidden="true" />
                {batch.category}
              </span>
            ) : null}
            {batch.created_at ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                Created {formatDate(String(batch.created_at).slice(0, 10))}
              </span>
            ) : null}
            {batch.description ? (
              <span className="basis-full text-small break-words text-text-secondary">{batch.description}</span>
            ) : null}
          </>
        }
        actions={
          <Button variant="outline" render={<Link href={`/batches/${batch.id}/edit`} />} nativeButton={false}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit Batch
          </Button>
        }
      />

      <Tabs as="link" items={tabs} active={active} ariaLabel="Batch sections" />

      {active === "overview" || active === "attendance" ? children : <Panel>{children}</Panel>}
      </Container>
    </>
  );
}
