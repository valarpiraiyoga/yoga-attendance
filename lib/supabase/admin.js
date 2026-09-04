import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client authenticated with the project's secret key.
 *
 * This client bypasses RLS completely, so it is restricted to operations that
 * genuinely require the Auth Admin API — currently only inviting an
 * instructor (lib/instructors/actions.js). Every other query must keep using
 * lib/supabase/server.js, which acts as the signed-in user and is subject to
 * RLS.
 *
 * Two things keep the key out of the browser: `server-only` above, which
 * turns importing this from a Client Component into a build error, and the
 * variable name — `SUPABASE_SECRET_KEY` has no NEXT_PUBLIC_ prefix, so Next.js
 * never inlines it into client bundles.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. It is required for admin-only Supabase " +
        "operations such as inviting an instructor — see .env.example."
    );
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
