import Link from "next/link";
import AuthLayout from "@/components/auth/AuthLayout";
import ForgotPasswordForm from "./forgot-password-form";

export const metadata = {
  title: "Reset password · Yoga Center Attendance System",
};

export default function ForgotPasswordPage() {
  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="text-page-title font-semibold text-text-primary">
          Reset your password
        </h1>
        <p className="text-body mt-1 text-text-secondary">
          Enter your email and we&apos;ll send you a link to set a new password.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="text-body mt-6 text-text-secondary">
        <Link href="/login" className="font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
