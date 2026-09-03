import { Bell, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import MobileMenu from "@/components/global/MobileMenu";
import UserMenu from "@/components/global/UserMenu";

export default function Header({ role }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-4 md:px-6">
      <div className="flex items-center gap-3">
        <MobileMenu role={role} />
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="size-4" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Help">
          <HelpCircle className="size-4" aria-hidden="true" />
        </Button>

        <div className="mx-2 h-6 w-px bg-border" aria-hidden="true" />

        <UserMenu role={role} />
      </div>
    </header>
  );
}
