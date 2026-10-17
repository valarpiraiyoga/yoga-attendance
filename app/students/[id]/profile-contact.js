import Link from "next/link";
import { CalendarDays, Mail, Pencil, Phone, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

function ContactField({ icon: Icon, label, children, valueClassName }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg bg-background px-3 py-2.5">
      <Icon className="mt-0.5 size-5 shrink-0 text-text-secondary" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-small text-text-secondary">{label}</dt>
        <dd className={`text-body font-semibold break-words text-text-primary ${valueClassName ?? ""}`}>{children}</dd>
      </div>
    </div>
  );
}

/**
 * Student Details → Profile & Contact: phone, email, date of birth and gender in a compact two-column grid (one column on a
 * phone). Edit opens the existing Edit Student form - the same place every one of these fields is changed.
 */
export default function ProfileContact({ student }) {
  return (
    <Panel>
      <PanelHeader
        icon={UserRound}
        tone="brand"
        title="Profile & Contact"
        action={
          <Button variant="secondary" size="sm" render={<Link href={`/students/${student.id}/edit`} />} nativeButton={false}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </Button>
        }
      />
      <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <ContactField icon={Phone} label="Phone">
          {formatPhone(student.phone, student.phone_country_code)}
        </ContactField>
        <ContactField icon={Mail} label="Email" valueClassName="break-all">
          {student.email || "—"}
        </ContactField>
        <ContactField icon={CalendarDays} label="Date of Birth">
          {student.date_of_birth ? formatDate(student.date_of_birth) : "—"}
        </ContactField>
        <ContactField icon={UserRound} label="Gender" valueClassName="capitalize">
          {student.gender || "—"}
        </ContactField>
      </dl>
    </Panel>
  );
}
