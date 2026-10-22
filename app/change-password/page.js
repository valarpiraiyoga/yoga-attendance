import { redirect } from "next/navigation";
import AuthCardLayout from "@/components/auth/AuthCardLayout";
import { Button } from "@/components/ui/button";
import { getAuthUser } from "@/lib/auth/dal";
import { mustChangePassword } from "@/lib/auth/password-change-required";
import { signOut } from "@/lib/auth/actions";
import ResetPasswordForm from "@/app/reset-password/reset-password-form";

export const metadata = {
  title: "Change your temporary password · YogaSync",
};

/**
 * The only page a user on an Admin-generated temporary password can use (proxy.js and `requireUser` send everything else here). It asks for a
 * new password (the same form and rules as the emailed-link reset: `updatePassword`), and the requirement is lifted only once that succeeds.
 *
 * It deliberately uses `getAuthUser` (not `requireUser`, which would redirect back here and loop). Anyone who does not have to change a password is
 * sent on to the app, so the page is not a second way to change one.
 */
export default async function ChangePasswordPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!mustChangePassword(user)) redirect("/");

  return (
    <AuthCardLayout>
      <div className="mb-8">
        <h1 className="text-page-title font-semibold text-text-primary">Change your temporary password</h1>
        <p className="text-body mt-1 text-text-secondary">
          You signed in with a temporary password from your administrator. Choose a new password to continue. It must be different from the temporary one.
        </p>
      </div>

      <ResetPasswordForm />

      <form action={signOut} className="mt-4 flex justify-center">
        <Button type="submit" variant="ghost">
          Sign out
        </Button>
      </form>
    </AuthCardLayout>
  );
}
