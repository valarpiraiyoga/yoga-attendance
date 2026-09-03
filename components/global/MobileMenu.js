"use client";

import { useState } from "react";
import { Menu, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import NavList from "@/components/global/NavList";

export default function MobileMenu({ role }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation menu" />
        }
      >
        <Menu className="size-5" aria-hidden="true" />
      </SheetTrigger>

      <SheetContent side="left" className="flex w-72 flex-col p-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex flex-col items-start text-left leading-tight">
            <span className="text-sm font-semibold text-text-primary">Yoga Center</span>
            <span className="text-xs font-normal text-text-secondary">Attendance System</span>
          </SheetTitle>
          <SheetDescription className="sr-only">
            Application navigation menu
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col justify-between overflow-y-auto px-3 py-4">
          <NavList role={role} onNavigate={() => setOpen(false)} />

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-background hover:text-text-primary"
          >
            <LogOut className="size-4 shrink-0" aria-hidden="true" />
            Logout
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
