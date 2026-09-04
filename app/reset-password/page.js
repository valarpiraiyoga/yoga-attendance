import AuthLayout from "@/components/auth/AuthLayout";
import ResetPasswordForm from "./reset-password-form";

export const metadata = {
  title: "Set a new password · Yoga Center Attendance System",
};

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="text-page-title font-semibold text-text-primary">
          Set a new password
        </h1>
        <p className="text-body mt-1 text-text-secondary">
          Choose a new password for your account.
        </p>
      </div>

      <ResetPasswordForm />
    </AuthLayout>
  );
}
