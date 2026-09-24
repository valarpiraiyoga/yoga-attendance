"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
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
import UtilityRow from "@/components/global/UtilityRow";
import CenterLogo from "@/components/global/CenterLogo";

export default function MobileMenu({ role, user, logoUrl }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation menu" />
        }
      >
        <Menu className="size-5" aria-hidden="true" />
      </SheetTrigger>

      <SheetContent side="left" className="sidebar-surface flex w-72 flex-col p-0">
        <SheetHeader className="border-b border-border/70">
          <SheetTitle className="flex items-center gap-3 text-left leading-tight">
            <CenterLogo url={logoUrl} />
            <span className="flex flex-col items-start">
              <span className="text-sm font-semibold text-text-primary">Yoga Center</span>
              <span className="text-xs font-normal text-text-secondary">Attendance System</span>
            </span>
          </SheetTitle>
          <SheetDescription className="sr-only">
            Application navigation menu
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <NavList role={role} onNavigate={() => setOpen(false)} />
        </div>

        <div className="shrink-0 border-t border-border/60 px-3 py-3">
          <UtilityRow role={role} name={user?.name} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
