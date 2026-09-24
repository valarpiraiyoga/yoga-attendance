import "server-only";

/**
 * Server-side entry point for the profile-photo / batch-image Storage helpers.
 * The logic lives in `photo-staging.js` (plain functions over a Supabase client,
 * so it can be unit-tested with a fake one); this file only marks it server-only
 * so nothing here can be imported into a client component.
 */
export * from "./photo-staging.js";
