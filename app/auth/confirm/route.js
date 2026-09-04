import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Verifies a Supabase email OTP (`token_hash` + `type`) server-side and
 * exchanges it for a session.
 *
 * This is the counterpart to app/auth/callback/route.js's PKCE `?code=`
 * exchange, which Admin Forgot Password / Recovery continues to use
 * unchanged. An admin-generated invite has no PKCE code_verifier — it is
 * minted server-side for someone else's browser — so Supabase's invite link
 * carries `token_hash`/`type` instead of `?code=`, which `/auth/callback`
 * cannot read. This route exists specifically for that link shape; it is a
 * second entry point for the same one authentication mechanism, not a
 * second auth system.
 */

// Only the OTP types this app's flows actually generate. `invite` is the
// Phase 9b instructor invitation; `recovery` is accepted defensively in case
// a recovery link is ever routed here, but Admin Forgot Password currently
// uses the PKCE flow above, not this route.
const ALLOWED_TYPES = new Set(["invite", "recovery"]);

// `next` must stay inside this app. A bare "/path" is safe; anything that
// could be interpreted as a different origin ("//host/path", "https://...",
// or a backslash — which WHATWG URL parsing treats as equivalent to "/", so
// "/\evil.com" is protocol-relative too) is rejected in favor of a fixed
// default, so this can never be turned into an open redirect via the query
// string.
function safeNextPath(next) {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.includes("\\") || next.includes("://")) return "/";
  return next;
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && ALLOWED_TYPES.has(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    // error.code/message describe the failure only — token_hash is never
    // logged, here or anywhere else in this route.
    console.error(`[auth] verifyOtp failed for type=${type}:`, error.code, error.message);
  }

  const errorCode = type === "recovery" ? "recovery" : "invite";
  return NextResponse.redirect(`${origin}/login?error=${errorCode}`);
}
