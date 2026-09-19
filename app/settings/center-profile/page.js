import { Building2 } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import TabContentHeading from "@/components/layout/TabContentHeading";
import { getCenterProfile } from "@/lib/center-profile/data";
import { updateCenterProfile } from "@/lib/center-profile/actions";
import CenterProfileForm from "@/app/settings/center-profile/center-profile-form";

const SUCCESS_MESSAGES = {
  updated: "Center profile updated successfully.",
};

/**
 * Settings — Center Profile (`01-product.md` §11; wireframe p.38).
 *
 * Repeats `requireRole` even though `app/settings/layout.js` also calls
 * it — a layout does not re-run on client-side navigation between sibling
 * pages (see that layout's own comment), so every page under /settings
 * must assert this independently.
 *
 * `getCenterProfile` (`lib/center-profile/data.js`) always returns exactly
 * one row once migration 0018 is applied — the table's own singleton
 * primary key and CHECK constraint guarantee it, not this page. The `null`
 * branch exists only so a genuinely missing row (e.g. queried before
 * migrating) fails honestly instead of crashing the form.
 */
export default async function CenterProfilePage({ searchParams }) {
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  const profile = await getCenterProfile();

  return (
    <div>
      <div className="mb-6">
        <TabContentHeading
          icon={Building2}
          title="Center Profile"
          description="Manage the yoga center information used throughout the application and exported reports."
        />
      </div>

      {message ? (
        <div
          role="status"
          className="mb-6 rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      {profile ? (
        <CenterProfileForm action={updateCenterProfile} profile={profile} />
      ) : (
        <p className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
          The center profile could not be loaded. Try refreshing the page.
        </p>
      )}
    </div>
  );
}
