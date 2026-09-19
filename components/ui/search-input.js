import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The one search field (06-ui-implementation-rules.md §16.2): leading
 * search icon, visually-hidden label, otherwise a plain `Input`. Search
 * stays independent of the filter drawer, submitted on its own — this
 * component owns only the field's appearance, not a form or URL-writing
 * behaviour, matching how every existing search field is wired today.
 */
export default function SearchInput({ id, label = "Search", className, inputClassName, ...props }) {
  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary"
        aria-hidden="true"
      />
      <Input id={id} className={cn("pl-9", inputClassName)} {...props} />
    </div>
  );
}
