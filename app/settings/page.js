import { redirect } from "next/navigation";

/**
 * /settings has no content of its own — it lands on the first implemented
 * tab (docs/02-ux.md "Settings" IA: Center Profile, Instructors, Roles &
 * Permissions; only Instructors exists so far).
 */
export default function SettingsPage() {
  redirect("/settings/instructors");
}
