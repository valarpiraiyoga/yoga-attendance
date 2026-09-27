import AuthCardLayout from "@/components/auth/AuthCardLayout";
import LoginForm from "./login-form";

export const metadata = {
  title: "Sign in · YogaSync",
};

// Never echo Supabase's own error text on this page. app/auth/confirm's
// route.js redirects here with one of these fixed, pre-chosen codes; an
// unrecognized or absent code (including the older /auth/callback recovery
// failure text, which is untouched and unrelated) shows no message at all.
const ERROR_MESSAGES = {
  invite:
    "Your invitation link is invalid or has expired. Please ask an administrator to send a new invitation.",
  recovery: "Your password reset link is invalid or has expired. Please request a new one.",
};

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const initialError = ERROR_MESSAGES[params?.error];

  return (
    <AuthCardLayout>
      <div className="mb-6 text-center">
        <h1 className="text-page-title font-semibold text-text-primary">Welcome Back</h1>
        <p className="text-body mt-1 text-text-secondary">Sign in to your account</p>
      </div>

      <LoginForm initialError={initialError} />

      <p className="text-small mt-6 text-center text-text-secondary">Need help? Contact your administrator.</p>
    </AuthCardLayout>
  );
}
