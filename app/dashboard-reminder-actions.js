"use client";

import { useState } from "react";
import MembershipCardMenu from "@/app/memberships/membership-card-menu";
import { Button } from "@/components/ui/button";
import MembershipReminderMessage from "@/app/memberships/membership-reminder-message";

/**
 * The actions at the end of a Dashboard reminder row - the same pattern as a Memberships list row: the red reminder bell as the one primary
 * action and the More (⋮) menu beside it. The bell and the menu's Reminder Message open ONE shared popup (`ReminderMessageDialog`, through
 * `MembershipReminderMessage`, exactly as the Memberships list does), opened on the row's own reminder; when the membership has both reminders
 * the popup lets the Admin choose between them.
 *
 * Every row is a reminder, so eligibility is never decided here: `reminders` is that membership's entry of `remindersByMembership` built from the
 * very reminders the Dashboard lists. The menu is the Memberships menu without its document item (that needs invoice facts only the list reads).
 *
 * @param {object} props
 * @param {object} props.reminder - one entry of `getReminders().reminders`.
 * @param {object} props.reminders - the membership's grouped reminders (`remindersByMembership(...)[membershipId]`).
 * @param {string} props.centreName
 */
export default function DashboardReminderActions({ reminder, reminders, centreName }) {
  const [reminderOpen, setReminderOpen] = useState(false);

  const { student, membership } = reminder;
  // The popup takes a membership as the Memberships list reads it; this is the same facts from the reminder data.
  const listMembership = {
    id: membership.id,
    membership_code: membership.code,
    plan: membership.plan,
    package_name: membership.packageName,
    start_date: membership.startDate,
    end_date: membership.endDate,
    students: {
      id: student.id,
      full_name: student.fullName,
      student_code: student.studentCode,
      photo_url: student.photoUrl,
      phone: student.phone,
      phone_country_code: student.phoneCountryCode,
      email: student.email,
    },
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* The reminder message popup's labelled opener (the Admin sends the message themselves; nothing is sent from here). */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-brand/40 bg-surface text-brand hover:bg-brand/5 hover:text-brand"
        aria-label={`Send a reminder to ${student.fullName ?? "this student"}: prepare the message`}
        onClick={() => setReminderOpen(true)}
      >
        Send Reminder
      </Button>
      <MembershipCardMenu
        membershipId={membership.id}
        studentId={student.id}
        paymentStatus={membership.paymentStatus}
        reminders={reminders}
        onOpenReminderMessage={() => setReminderOpen(true)}
        hideDocumentAction
      />
      <MembershipReminderMessage
        membership={listMembership}
        reminders={reminders}
        centreName={centreName}
        initialType={reminder.type}
        open={reminderOpen}
        onOpenChange={setReminderOpen}
      />
    </div>
  );
}
