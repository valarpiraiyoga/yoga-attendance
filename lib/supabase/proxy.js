import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

/**
 * Refreshes the Supabase auth session on each request and reports the current
 * user, so `proxy.js` can decide whether to allow or redirect.
 *
 * Returns the response that must be returned from the proxy, so refreshed
 * session cookies are not dropped.
 */
export async function updateSession(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // getUser() revalidates the token with Supabase — do not trust getSession()
  // here, which only reads the cookie.
  //
  // If Supabase is unreachable or misconfigured, fail closed: report no user
  // so protected routes redirect to login rather than erroring open.
  let user = null;
  try {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser ?? null;
  } catch {
    user = null;
  }

  return { response, user };
}
