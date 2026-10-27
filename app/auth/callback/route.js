import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOriginRedirect } from "@/lib/auth/safe-next-path";

/**
 * Exchanges the code from a Supabase auth email link (password reset) for a
 * session, then forwards the user to the target page.
 *
 * The target (`next`) comes from the link's query string, so it is untrusted: `sameOriginRedirect` (lib/auth/safe-next-path.js) only ever
 * returns a page of this site - an external, protocol-relative or malformed `next` goes to "/" instead.
 */
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(sameOriginRedirect(next, origin));
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=Invalid or expired reset link`
  );
}
