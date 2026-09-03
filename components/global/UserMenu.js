"use client";

import { ChevronDown, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/app/data/navigation";

function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function UserMenu({ role, name = "Admin User" }) {
  const roleLabel = ROLE_LABELS[role] ?? role;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-background">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-xs font-medium text-brand"
        >
          {getInitials(name)}
        </span>
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="text-sm font-medium text-text-primary">{name}</span>
          <span className="text-xs tracking-wide text-text-secondary uppercase">{roleLabel}</span>
        </span>
        <ChevronDown className="size-3.5 text-text-secondary" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>
          <LogOut className="size-4" aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
