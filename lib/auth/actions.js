"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearPasswordChangeRequirement, mustChangePassword } from "@/lib/auth/password-change-required";
import { changeOwnPassword, CHANGE_PASSWORD_MESSAGES } from "@/lib/auth/change-password";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-rules";
import { passwordResetRedirectUrl } from "@/lib/auth/site-url";

/**
 * Server actions for authentication.
 *
 * All credential handling happens on the server. Errors are returned as plain
 * objects so forms can render them; they are deliberately generic so the
 * response does not reveal whether an account exists.
 */

export async function signIn(_prevState, formData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Generic on purpose — do not disclose whether the email is registered.
    return { error: "Incorrect email or password." };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/login");
}

export async function requestPasswordReset(_prevState, formData) {
  const email = String(formData.get("email") || "").trim();

  if (!email) {
    return { error: "Enter your email address." };
  }

  // The link in the email points at this application's own address, from the SITE_URL setting (lib/auth/site-url.js) - never from the
  // request's Origin header, which whoever makes the request controls. Without a valid SITE_URL nothing is sent, and the message does
  // not depend on the email, so it reveals nothing about accounts.
  const redirect = passwordResetRedirectUrl(process.env);
  if (!redirect.ok) {
    console.error(`[auth] Password reset is unavailable: SITE_URL is not usable (${redirect.reason}).`);
    return { error: "Password reset is not available right now. Please contact your administrator." };
  }

  const supabase = await createClient();

  // /auth/recovery (not /auth/callback or /auth/confirm) — this project uses
  // Supabase's DEFAULT, unmodified recovery email template, which redirects
  // there via GoTrue's own /verify with the session in a URL fragment
  // (#access_token=...), not a ?code= or ?token_hash= query param. Only a
  // client page can read a fragment, so app/auth/recovery/page.js is a page,
  // not another route.js — see its own comment for the full trace, and
  // lib/instructors/actions.js's identical redirectTo for the invite case
  // this mirrors.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirect.url,
  });

  if (error) {
    console.error("[auth] Could not send password reset email:", error.code, error.status, error.message);
  }

  // Always report success so the response does not reveal account existence.
  return {
    success:
      "If an account exists for that email, a password reset link has been sent.",
  };
}

export async function updatePassword(_prevState, formData) {
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.updateUser({ password });

  if (error) {
    // A user replacing an Admin-generated temporary password is signed in (not following an emailed link), so say what to do here.
    if (error.code === "same_password") return { error: "Choose a password different from your current one." };
    if (error.code === "weak_password") return { error: "That password is too weak. Choose a stronger one." };
    return { error: "Could not update the password. Request a new reset link." };
  }

  // The user has now chosen a password of their own: lift the temporary-password requirement. The user id is the verified session's (what
  // Supabase Auth just returned for this session), never a form field, and only the Auth Admin API can write the flag. The requirement is
  // cleared only AFTER the password changed, so a failure can never leave a temporary password usable without the requirement.
  if (mustChangePassword(data?.user)) {
    let cleared = false;
    try {
      cleared = await clearPasswordChangeRequirement({ admin: createAdminClient(), userId: data.user.id });
    } catch (configError) {
      console.error("[auth] Admin client unavailable to finish the password change:", configError.message);
    }
    if (!cleared) {
      return {
        error: "Your password was updated, but we could not finish setting up your account. Choose another new password to try again.",
      };
    }
  }

  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Change the signed-in user's OWN password (Settings -> Reset Password).
 *
 * Who is changing is never taken from the form: it is the verified session user (`getAuthUser()` asks Supabase
 * Auth), and the form carries only the three password fields. The rules, the current-password check and the
 * update itself live in `changeOwnPassword` (lib/auth/change-password.js), which acts on this session's user
 * and no one else. Unlike `updatePassword` (the emailed-link flow) this stays on the page: it returns a
 * result for the form to show instead of redirecting.
 *
 * Passwords are never logged, stored or returned.
 */
export async function changePassword(_prevState, formData) {
  const user = await getAuthUser();

  if (!user) {
    return { error: CHANGE_PASSWORD_MESSAGES.sessionExpired };
  }

  const supabase = await createClient();

  return changeOwnPassword({
    supabase,
    user: { id: user.id, email: user.email },
    currentPassword: String(formData.get("currentPassword") || ""),
    newPassword: String(formData.get("newPassword") || ""),
    confirmPassword: String(formData.get("confirmPassword") || ""),
  });
}
