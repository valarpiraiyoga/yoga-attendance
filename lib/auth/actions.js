"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/dal";
import { changeOwnPassword, CHANGE_PASSWORD_MESSAGES } from "@/lib/auth/change-password";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-rules";

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

  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  // /auth/recovery (not /auth/callback or /auth/confirm) — this project uses
  // Supabase's DEFAULT, unmodified recovery email template, which redirects
  // there via GoTrue's own /verify with the session in a URL fragment
  // (#access_token=...), not a ?code= or ?token_hash= query param. Only a
  // client page can read a fragment, so app/auth/recovery/page.js is a page,
  // not another route.js — see its own comment for the full trace, and
  // lib/instructors/actions.js's identical redirectTo for the invite case
  // this mirrors.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/recovery?next=/reset-password`,
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
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: "Could not update the password. Request a new reset link." };
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
