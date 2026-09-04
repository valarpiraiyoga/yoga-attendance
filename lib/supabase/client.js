import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for browser/Client Components.
 *
 * Only the public URL and publishable key are used here. The secret key must
 * never be referenced in client code.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
