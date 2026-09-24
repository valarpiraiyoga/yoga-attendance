import { Check, Minus, ShieldCheck } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireRole, ROLES } from "@/lib/auth/dal";
import TabContentHeading from "@/components/layout/TabContentHeading";
import { NAV_ITEMS, ROLE_LABELS } from "@/app/data/navigation";

/**
 * Settings — Roles & Permissions (`01-product.md` §11 "Roles &
 * Permissions"; wireframe p.40). Read-only: there is no per-role
 * configuration in this product's V1 scope — Admin and Instructor are
 * fixed (`lib/auth/dal.js`'s `ROLES`), and this screen documents that
 * fixed model rather than editing it. No form, no save action, no data
 * query — nothing here is speculative configuration.
 *
 * The PRODUCT AREA rows and their Admin/Instructor access are read
 * directly from `NAV_ITEMS` (`app/data/navigation.js`) — the same array
 * that already gates the sidebar and every route's own `requireRole` call
 * — rather than a second, hand-maintained list. That is a deliberate
 * choice: a duplicated list could silently drift from what access
 * actually is; deriving from the single source of truth means this screen
 * can never claim a role has access it doesn't, or lacks access it has.
 *
 * "Assigned Classes" is excluded: its `roles: []` in `NAV_ITEMS` means no
 * one can reach it yet (D9, still deferred) — the wireframe's own product
 * area rows likewise never list it, so filtering it out here keeps this
 * screen honest about what actually exists today.
 */
export default async function RolesPermissionsPage() {
  await requireRole(ROLES.ADMIN);

  const productAreas = NAV_ITEMS.filter((item) => item.roles.length > 0);

  return (
    <div>
      <div className="mb-6">
        <TabContentHeading
          icon={ShieldCheck}
          title="Roles & Permissions"
          description="Manage access for Admin and Instructor roles."
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-4 shadow-xs">
          <h3 className="text-body font-semibold tracking-wide text-text-primary uppercase">
            {ROLE_LABELS[ROLES.ADMIN]}
          </h3>
          <p className="text-body mt-1 text-text-secondary">Full management access across the application.</p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4 shadow-xs">
          <h3 className="text-body font-semibold tracking-wide text-text-primary uppercase">
            {ROLE_LABELS[ROLES.INSTRUCTOR]}
          </h3>
          <p className="text-body mt-1 text-text-secondary">
            Operational access to assigned classes, attendance, and relevant attendance history.
          </p>
        </div>
      </div>

      {/* The finalized compact table surface; the matrix is three columns, so it
          fits a phone, and any overflow would scroll inside this card only. */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
        <Table aria-label="Roles and Permissions">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10 pl-4 text-small tracking-normal">Product Area</TableHead>
              <TableHead className="h-10 px-2 text-center text-small tracking-normal">
                {ROLE_LABELS[ROLES.ADMIN]}
              </TableHead>
              <TableHead className="h-10 px-2 pr-4 text-center text-small tracking-normal">
                {ROLE_LABELS[ROLES.INSTRUCTOR]}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {productAreas.map((item) => {
              const instructorHasFullAccess =
                item.roles.includes(ROLES.INSTRUCTOR) &&
                // Both roles reach the item, but for Attendance and
                // Attendance History an instructor's own access is scoped
                // to their assigned classes (RLS, not this screen) — the
                // asterisk footnote below is what the wireframe uses to
                // flag exactly that distinction.
                item.href !== "/attendance" &&
                item.href !== "/attendance-history";

              return (
                <TableRow key={item.href}>
                  <TableCell className="py-3 pl-4 text-body font-medium text-text-primary">{item.label}</TableCell>
                  <TableCell className="px-2 py-3 text-center">
                    {/* A check and a dash, each with a text alternative — the
                        state never rests on color alone. */}
                    {item.roles.includes(ROLES.ADMIN) ? (
                      <>
                        <Check className="mx-auto size-4 text-success" aria-hidden="true" />
                        <span className="sr-only">Access granted</span>
                      </>
                    ) : (
                      <>
                        <Minus className="mx-auto size-4 text-text-secondary/50" aria-hidden="true" />
                        <span className="sr-only">No access</span>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="px-2 py-3 pr-4 text-center">
                    {item.roles.includes(ROLES.INSTRUCTOR) ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="size-4 text-success" aria-hidden="true" />
                        <span className="sr-only">
                          {instructorHasFullAccess ? "Access granted" : "Access granted, limited to assigned classes"}
                        </span>
                        {!instructorHasFullAccess ? <span aria-hidden="true">*</span> : null}
                      </span>
                    ) : (
                      <>
                        <Minus className="mx-auto size-4 text-text-secondary/50" aria-hidden="true" />
                        <span className="sr-only">No access</span>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-small mt-3 text-text-secondary">
        * Instructor access is limited to assigned classes / relevant attendance history. Instructors have
        focused operational access to assigned classes and attendance.
      </p>
    </div>
  );
}
