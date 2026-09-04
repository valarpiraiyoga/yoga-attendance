"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import AuthLayout from "@/components/auth/AuthLayout";
import { createClient } from "@/lib/supabase/client";

/**
 * Lands here only from a DEFAULT, unmodified Supabase invite email link
 * (lib/instructors/actions.js `provideLoginAccess`'s `redirectTo`).
 *
 * GoTrue's own `/auth/v1/verify` endpoint checks the invite token and
 * redirects here, attaching the session as a URL FRAGMENT
 * (`#access_token=...&refresh_token=...`) rather than the `?code=` or
 * `?token_hash=` query param app/auth/callback/route.js and
 * app/auth/confirm/route.js read — an admin-generated invite has no PKCE
 * code_verifier (it's minted for someone else's browser), so GoTrue falls
 * back to the implicit flow instead. A fragment is never sent to any
 * server, so no Route Handler can ever see it; only a page that actually
 * runs in the browser can. That is the entire reason this is a client page
 * and not another route.js.
 *
 * `setSession` still goes through Supabase's own SDK, validated the same way
 * any other session is — this changes where a session gets established, not
 * how it is authorized. Nothing here touches RLS, `current_instructor_id()`,
 * or `getCurrentInstructor()`.
 */

// Mirrors app/auth/confirm/route.js's safeNextPath exactly, except the
// default: a bad/missing `next` here should still land an invited instructor
// on the one page that makes sense for this flow, not the site root. A
// backslash is rejected alongside "//" and "://" — WHATWG URL parsing treats
// "\" as equivalent to "/", so "/\evil.com" is protocol-relative too.
function safeNextPath(next) {
  if (typeof next !== "string" || !next.startsWith("/")) return "/reset-password";
  if (next.startsWith("//") || next.includes("\\") || next.includes("://")) return "/reset-password";
  return next;
}

export default function AcceptInvitePage() {
  const router = useRouter();

  // Guards against React Strict Mode's dev-only double-mount (and any other
  // re-render) invoking setSession/navigation twice — this must run exactly
  // once.
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    // No session exists yet at this point, so a soft client-side navigation
    // is fine here — unlike the post-setSession success path below, there
    // are no new cookies that the next request needs to see.
    function goToLoginError() {
      router.push("/login?error=invite");
    }

    async function acceptInvite() {
      const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
      const hashParams = new URLSearchParams(window.location.hash.slice(1));

      if (
        hashParams.get("error") ||
        hashParams.get("error_code") ||
        hashParams.get("error_description")
      ) {
        goToLoginError();
        return;
      }

      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (!accessToken || !refreshToken) {
        goToLoginError();
        return;
      }

      const supabase = createClient();

      let result;
      try {
        result = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
      } catch {
        // setSession can reject outright, not just resolve with an error —
        // GoTrueClient's _setSession rethrows anything that isn't an
        // AuthError (e.g. a network failure). Without this, that throw would
        // leave "Completing your invitation…" showing forever.
        goToLoginError();
        return;
      }

      if (result.error) {
        goToLoginError();
        return;
      }

      // Scrub the tokens from the address bar/history before navigating —
      // the query string (`next`) is preserved, only the fragment is dropped.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);

      // A full navigation, not router.push: the next request must be a real
      // round-trip so the server (and the proxy) see the cookies setSession
      // just wrote.
      window.location.href = next;
    }

    acceptInvite();
  }, [router]);

  return (
    <AuthLayout>
      <div className="flex flex-col gap-2">
        <h1 className="text-page-title font-semibold text-text-primary">
          Completing your invitation…
        </h1>
        <p className="text-body text-text-secondary">Please wait while we sign you in.</p>
      </div>
    </AuthLayout>
  );
}
