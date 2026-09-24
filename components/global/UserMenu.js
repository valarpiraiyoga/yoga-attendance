"use client";

import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/app/data/navigation";
import { signOut } from "@/lib/auth/actions";

function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * The account control: an initials avatar (the existing avatar treatment) that
 * opens the account menu. It sits in the Sidebar's utility row, so the trigger
 * is the avatar alone; the name and role it used to print beside it are the
 * menu's heading instead, and the menu keeps its Log out item.
 */
export default function UserMenu({ role, name }) {
  const roleLabel = ROLE_LABELS[role] ?? role;
  const displayName = name || "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${displayName} (${roleLabel})`}
        title={`${displayName} · ${roleLabel}`}
        className="flex h-10 w-full items-center justify-center rounded-lg outline-none transition-colors hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-small font-medium text-brand"
        >
          {getInitials(displayName)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5">
            <span className="text-body font-medium text-text-primary">{displayName}</span>
            <span className="text-small font-normal tracking-wide text-text-secondary uppercase">{roleLabel}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <form action={signOut}>
          <DropdownMenuItem nativeButton render={<button type="submit" className="w-full" />}>
            <LogOut className="size-4" aria-hidden="true" />
            Log out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
