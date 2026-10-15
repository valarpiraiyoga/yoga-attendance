import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { fetchDocumentList } from "@/lib/documents/list-core";

/**
 * Data Access Layer for the Central Documents register (Phase 1, read-only). The pure query and row shaping live in
 * `list-core.js`; this wrapper supplies the request's Supabase client and the Admin check.
 *
 * Like `lib/invoices/data.js`, it requires the Admin role ITSELF, so a document list can never be read on a path that forgot to
 * guard its page. Row-level security (`invoices_select_admin`) restricts the table to Admins as well, so an Instructor's query
 * would return nothing even without this check.
 *
 * @param {ReturnType<typeof import("@/lib/documents/list-core").parseDocumentListParams>} params
 */
export async function listDocuments(params) {
  await requireRole(ROLES.ADMIN);
  return fetchDocumentList(await createClient(), params);
}
