"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListFilter } from "lucide-react";

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
 * `compactOnMobile` shows the control below `sm` as the compact "Sort [icon]"
 * (the label reads "Sort", the select is just its list-filter icon, and the
 * current value stays available to assistive tech); from `sm` up it is the
 * usual "Sort by [ value ]". Off by default.
 *
 * `triggerClassName` overrides the select's width (default `w-44`) and
 * `labelClassName` adds to the "Sort by" label (e.g. `sr-only` for a tight row;
 * the label still names the select for assistive tech).
 *
 * The "Sort by" label is a literal-class span (not through `cn()`) so its
 * `text-small` can't be stripped by tailwind-merge — see `StatTile`.
 */
export default function SortSelect({
  id,
  options,
  value,
  defaultValue,
  className,
  triggerClassName,
  labelClassName,
  compactOnMobile = false,
}) {
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
      <span id={`${id}-label`} className={cn("text-small text-text-secondary", labelClassName)}>
        {compactOnMobile ? (
          <>
            <span className="max-sm:hidden">Sort by</span>
            <span className="sm:hidden">Sort</span>
          </>
        ) : (
          "Sort by"
        )}
      </span>
      <Select items={options} value={value} onValueChange={handleChange}>
        <SelectTrigger id={id} aria-labelledby={`${id}-label`} className={cn(
            "h-9 w-44",
            compactOnMobile &&
              "max-sm:w-auto max-sm:gap-0 max-sm:border-0 max-sm:bg-transparent max-sm:px-1 max-sm:[&>span:last-child]:hidden",
            triggerClassName
          )}
        >
          {compactOnMobile ? <ListFilter className="text-text-secondary sm:hidden" aria-hidden="true" /> : null}
          <SelectValue className={compactOnMobile ? "max-sm:sr-only" : undefined} />
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
