"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import StudentCombobox from "@/app/memberships/new/student-combobox";

/**
 * Select Student — the first step of the standalone Add Membership flow
 * (02-ux.md Flow 14: "Memberships → Add Membership → Select Student →
 * Membership Details → ..."). A plain GET form: choosing a student and
 * submitting navigates to `?student=<id>`, which the parent page
 * (app/memberships/new/page.js) reads to render MembershipForm — no client
 * state needs to survive the navigation.
 *
 * The picker is a searchable combobox (`student-combobox.js`) over the loaded
 * student options, so the list stays usable as it grows; it still submits the
 * chosen student's id as `student`.
 */
export default function SelectStudentStep({ studentOptions }) {
  const [studentId, setStudentId] = useState("");

  return (
    <form method="get" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="student">Student</Label>
        {studentOptions.length === 0 ? (
          <EmptyState size="sm" description="No active students are available." />
        ) : (
          <StudentCombobox
            id="student"
            name="student"
            students={studentOptions}
            value={studentId}
            onValueChange={setStudentId}
          />
        )}
      </div>

      <div className="mt-2 flex justify-end gap-3 border-t border-border pt-5">
        <Button type="submit" disabled={!studentId}>
          Continue
        </Button>
      </div>
    </form>
  );
}
