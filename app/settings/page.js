import { redirect } from "next/navigation";

/**
 * /settings has no content of its own — it lands on the first approved tab
 * (docs/02-ux.md "Settings" IA: Center Profile, Instructors, Roles &
 * Permissions — Center Profile is first, matching wireframe p.38's tab
 * order). All three tabs are implemented as of Phase 19.
 */
export default function SettingsPage() {
  redirect("/settings/center-profile");
}
