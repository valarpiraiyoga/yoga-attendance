import { notFound } from "next/navigation";
import PageHeader from "@/components/layout/PageHeader";
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
    <>
      {/* The finalized compact page header (as the Students list): back link, title and
          description on the left. It is a direct child of the shell's <main>; the body has
          its own container beside it. */}
      <PageHeader
        compact
        back={{ href: `/students/${id}`, label: `Back to ${student.full_name}` }}
        title="Edit Student"
        description={`Update ${student.full_name}’s details.`}
      />

      <div className="mx-auto max-w-5xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <StudentForm
            action={updateStudentById}
            student={student}
            submitLabel="Save Changes"
            pendingLabel="Saving…"
          />
        </div>
      </div>
    </>
  );
}
