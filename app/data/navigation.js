import {
  LayoutDashboard,
  Users,
  CreditCard,
  Layers,
  Calendar,
  BookOpen,
  CircleCheck,
  History,
  BarChart3,
  Settings,
} from "lucide-react";

/**
 * Single source of truth for primary navigation. Order matches the approved
 * IA in docs/02-ux.md for both roles — filtering by role preserves
 * each role's exact approved order without needing separate lists.
 *
 * "Assigned Classes" is approved instructor IA (02-ux.md's Role-Based IA)
 * but has no screen yet — D9 defers a dedicated Assigned Classes screen, so
 * `roles` stays empty rather than pointing an instructor at a 404 (Phase 15
 * Instructor Access, Step 5): it has no admin equivalent, so its list
 * becomes empty and it renders for no one. "Attendance History" now has a
 * real screen (Phase 16) open to both roles.
 */
export const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, roles: ["admin", "instructor"] },
  { label: "Assigned Classes", href: "/assigned-classes", icon: BookOpen, roles: [] },
  { label: "Students", href: "/students", icon: Users, roles: ["admin"] },
  { label: "Memberships", href: "/memberships", icon: CreditCard, roles: ["admin"] },
  { label: "Batches", href: "/batches", icon: Layers, roles: ["admin"] },
  { label: "Schedule", href: "/schedule", icon: Calendar, roles: ["admin"] },
  { label: "Attendance", href: "/attendance", icon: CircleCheck, roles: ["admin", "instructor"] },
  { label: "Attendance History", href: "/attendance-history", icon: History, roles: ["admin", "instructor"] },
  { label: "Reports", href: "/reports", icon: BarChart3, roles: ["admin"] },
  { label: "Settings", href: "/settings", icon: Settings, roles: ["admin"] },
];

export const ROLE_LABELS = {
  admin: "Admin",
  instructor: "Instructor",
};

export function getNavItemsForRole(role) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
