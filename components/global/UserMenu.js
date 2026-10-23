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
 * The account control: the person's initials in a rounded-square avatar (the app's avatar shape, in the brand tint with a soft border) that opens
 * the account menu. It is the first of the four equal targets in the Sidebar's utility row, so the trigger is the avatar alone; the name and
 * role are the menu's heading (and the tooltip), and the menu keeps its Log out item.
 */
export default function UserMenu({ role, name }) {
  const roleLabel = ROLE_LABELS[role] ?? role;
  const displayName = name || "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${displayName} (${roleLabel})`}
        title={`${displayName} · ${roleLabel}`}
        className="group flex h-10 w-full items-center justify-center rounded-lg outline-none transition-colors hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand/20 bg-brand/10 text-small font-semibold text-brand shadow-xs transition-colors group-hover:bg-brand/15 group-data-popup-open:border-brand/40 group-data-popup-open:bg-brand/20"
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
