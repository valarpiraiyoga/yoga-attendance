"use client";

import { useRef } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The one canonical tab pattern in the application
 * (06-ui-implementation-rules.md §15): underline tabs. Folder tabs
 * (`.folder-tabs-track` / `.folder-tab-active` in `app/globals.css`) are
 * retired — this component replaces both the former "page-level" folder
 * tabs (Reports, Settings) and the former entity-detail underline-styled
 * tabs, because there is only one tab treatment now, not two.
 *
 * Two usage shapes, selected with `as`:
 *   - `as="link"` — tabs are routes (Reports, Settings). Renders `<Link>`s
 *     inside a `<nav>`; the active tab is read from the current route by
 *     the caller and passed as `active`. No client state here.
 *   - `as="button"` (default) — tabs are local UI state (entity detail
 *     pages). Renders a real `role="tablist"`/`role="tab"` set with arrow-
 *     key roving focus; `onChange(key)` is called on click or arrow-key
 *     activation.
 *
 * `size="sm"` is a scale variant only (smaller type, tighter gaps) for tabs
 * nested inside a panel (e.g. Settings › Roles & Permissions' Permissions /
 * Assigned Users / Role Info) — it is still the same underline pattern, per
 * §15.2: "Scale only — not a different pattern."
 *
 * `items`: `{ key, label, href?, icon?, count?, disabled? }[]`.
 * `href` is required per item when `as="link"`.
 */
export default function Tabs({
  items,
  active,
  onChange,
  as = "button",
  size = "default",
  ariaLabel,
  className,
  children,
}) {
  const listRef = useRef(null);

  function focusTabAt(index) {
    const tabs = listRef.current?.querySelectorAll('[role="tab"]:not([aria-disabled="true"])');
    if (!tabs || tabs.length === 0) return;
    const target = tabs[(index + tabs.length) % tabs.length];
    target?.focus();
    const key = target?.getAttribute("data-key");
    if (key) onChange?.(key);
  }

  function handleKeyDown(event, currentIndex) {
    if (as !== "button") return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusTabAt(currentIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusTabAt(currentIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTabAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTabAt(items.length - 1);
    }
  }

  const isSmall = size === "sm";

  return (
    <div className={cn("w-full", className)}>
      <nav aria-label={ariaLabel} className="border-b border-border">
        <ul
          ref={listRef}
          role={as === "button" ? "tablist" : undefined}
          aria-label={as === "button" ? ariaLabel : undefined}
          className={cn("flex items-end gap-6 overflow-x-auto", isSmall && "gap-4")}
        >
          {items.map((item, index) => {
            const isActive = item.key === active;
            const Icon = item.icon;

            const tabClassName = cn(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 pb-3 text-body transition-colors",
              isSmall && "pb-2 text-small",
              isActive
                ? "border-brand font-semibold text-brand"
                : "border-transparent text-text-secondary hover:text-text-primary",
              item.disabled && "pointer-events-none text-text-secondary/50"
            );

            const content = (
              <>
                {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
                {item.label}
                {typeof item.count === "number" ? (
                  <span
                    className={cn(
                      "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-small font-semibold",
                      isActive ? "bg-brand text-surface" : "bg-neutral/15 text-text-secondary"
                    )}
                  >
                    {item.count}
                  </span>
                ) : null}
              </>
            );

            if (as === "link") {
              return (
                <li key={item.key}>
                  {item.disabled ? (
                    <span
                      aria-disabled="true"
                      title="Not available yet"
                      className={cn(tabClassName, "cursor-not-allowed")}
                    >
                      {content}
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={tabClassName}
                    >
                      {content}
                    </Link>
                  )}
                </li>
              );
            }

            return (
              <li key={item.key} role="presentation">
                <button
                  type="button"
                  role="tab"
                  data-key={item.key}
                  id={`tab-${item.key}`}
                  aria-selected={isActive}
                  aria-controls={`tabpanel-${item.key}`}
                  aria-disabled={item.disabled || undefined}
                  disabled={item.disabled}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => onChange?.(item.key)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  className={tabClassName}
                >
                  {content}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {children ? (
        as === "button" ? (
          <div role="tabpanel" id={`tabpanel-${active}`} aria-labelledby={`tab-${active}`}>
            {children}
          </div>
        ) : (
          children
        )
      ) : null}
    </div>
  );
}
