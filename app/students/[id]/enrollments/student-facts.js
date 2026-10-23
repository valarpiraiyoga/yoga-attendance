import { CalendarDays, Phone, UserRound } from "lucide-react";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

const GENDER_LABELS = { male: "Male", female: "Female", other: "Other" };

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-card border border-border bg-surface px-3 py-2 shadow-xs">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-small leading-4 text-text-secondary">{label}</p>
        <p className="text-body font-medium whitespace-nowrap text-text-primary">{children}</p>
      </div>
    </div>
  );
}

/**
 * The student's Joined date, gender and contact number beside their name on Add Batch Enrollment (the identity header's right-hand slot). Read-only,
 * from the student record the page already loaded; a missing value shows a dash.
 *
 * @param {{ student: { join_date?: string|null, gender?: string|null, phone?: string|null, phone_country_code?: string|null } }} props
 */
export default function StudentFacts({ student }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Fact icon={CalendarDays} label="Joined">
        {student.join_date ? formatDate(student.join_date) : "—"}
      </Fact>
      <Fact icon={UserRound} label="Gender">
        {GENDER_LABELS[student.gender] ?? "—"}
      </Fact>
      <Fact icon={Phone} label="Contact">
        {student.phone ? formatPhone(student.phone, student.phone_country_code) : "—"}
      </Fact>
    </div>
  );
}
