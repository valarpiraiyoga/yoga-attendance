import AuthLayout from "@/components/auth/AuthLayout";
import LoginForm from "./login-form";

export const metadata = {
  title: "Sign in · Yoga Center Attendance System",
};

export default function LoginPage() {
  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="text-page-title font-semibold text-text-primary">
          Welcome back
        </h1>
        <p className="text-body mt-1 text-text-secondary">
          Sign in to continue to your dashboard.
        </p>
      </div>

      <LoginForm />
    </AuthLayout>
  );
}
