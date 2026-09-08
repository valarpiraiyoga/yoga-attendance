import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import { updateStudent } from "@/lib/students/actions";
import StudentForm from "@/app/students/student-form";

export default async function EditStudentPage({ params }) {
  // Authorization boundary — see app/students/layout.js for why this must be
  // repeated here rather than relying on the layout alone. updateStudent
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const student = await getStudent(id);

  if (!student) {
    notFound();
  }

  const updateStudentById = updateStudent.bind(null, id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/students/${id}`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to {student.full_name}
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Edit Student</h1>
      <p className="text-body mt-1 text-text-secondary">
        Update {student.full_name}&rsquo;s details.
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <StudentForm
          action={updateStudentById}
          student={student}
          submitLabel="Save Changes"
          pendingLabel="Saving…"
        />
      </div>
    </div>
  );
}
