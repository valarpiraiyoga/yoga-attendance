"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The one "Sort by" control (`02`/`05`/`08`/`12`/`14`/`15` — right-aligned
 * beside the results count). Sort state lives in the URL like every other
 * list control: choosing an option writes `?sort=` (dropped when it equals
 * `defaultValue`, so the default URL stays clean) and resets `page`, keeping
 * every other param (search, filters, view).
 *
 * `options`: `{ value, label }[]`. `value` is the currently applied key,
 * resolved by the server page from the URL — this component holds no state.
 *
 * The "Sort by" label is a literal-class span (not through `cn()`) so its
 * `text-small` can't be stripped by tailwind-merge — see `StatTile`.
 */
export default function SortSelect({ id, options, value, defaultValue, className }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(next) {
    const params = new URLSearchParams(searchParams);
    if (next === defaultValue) {
      params.delete("sort");
    } else {
      params.set("sort", next);
    }
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      <span id={`${id}-label`} className="text-small text-text-secondary">
        Sort by
      </span>
      <Select items={options} value={value} onValueChange={handleChange}>
        <SelectTrigger id={id} aria-labelledby={`${id}-label`} className="h-9 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
