"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Select Student — the first step of the standalone Add Membership flow
 * (02-ux.md Flow 14: "Memberships → Add Membership → Select Student →
 * Membership Details → ..."). A plain GET form: choosing a student and
 * submitting navigates to `?student=<id>`, which the parent page
 * (app/memberships/new/page.js) reads to render MembershipForm — no client
 * state needs to survive the navigation.
 */
export default function SelectStudentStep({ studentOptions }) {
  const [studentId, setStudentId] = useState("");

  const options = studentOptions.map((student) => ({
    value: student.id,
    label: `${student.full_name} (${student.student_code})`,
  }));

  return (
    <form method="get" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="student">Student</Label>
        <Select name="student" items={options} value={studentId} onValueChange={setStudentId}>
          <SelectTrigger id="student">
            <SelectValue placeholder="Select a student…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-2 flex justify-end gap-3 border-t border-border pt-5">
        <Button type="submit" disabled={!studentId}>
          Continue
        </Button>
      </div>
    </form>
  );
}
