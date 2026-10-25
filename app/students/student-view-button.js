import Link from "next/link";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The Students list's eye icon, beside the More (⋮) menu: straight to the full Student Details page (the name links there too). */
export default function StudentViewButton({ student }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
      aria-label={`View student details for ${student.full_name}`}
      title="View student details"
      render={<Link href={`/students/${student.id}`} />}
      nativeButton={false}
    >
      <Eye className="size-4" aria-hidden="true" />
    </Button>
  );
}
