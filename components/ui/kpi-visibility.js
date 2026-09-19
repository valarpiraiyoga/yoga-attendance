"use client";

import { useSyncExternalStore } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Show/hide control for a list page's KPI strip. Two pieces that share one
 * preference per page (`pageKey`, e.g. "students" / "memberships"):
 *
 *   <KpiToggle pageKey="students" />              — compact header button (Eye / EyeOff + "KPIs")
 *   <KpiStrip pageKey="students">…tiles…</KpiStrip> — the collapsible strip
 *
 * They live in different parts of a server page (header actions vs. body),
 * so they don't share React state — they subscribe to the same external
 * store instead, keyed by `pageKey`. Nothing about the strip's contents,
 * data, or the rest of the page (filters, view, sort, pagination) is
 * involved; hiding only sets `hidden` on the strip's wrapper.
 *
 * The preference persists in `localStorage`, one entry per page, and
 * defaults to visible. If storage is unavailable (private mode, blocked),
 * the choice still works for the session via an in-memory fallback.
 *
 * SSR renders "visible"; a stored "hidden" applies right after hydration.
 */
const STORAGE_PREFIX = "yoga-center:kpi-visibility:";
const CHANGE_EVENT = "yoga-center:kpi-visibility-change";

// Fallback for the session when localStorage can't be written or read.
// Only ever populated on a storage failure, so a working localStorage stays
// the single source of truth (including changes made in another tab).
const memory = new Map();

function readVisible(pageKey) {
  if (memory.has(pageKey)) return memory.get(pageKey);
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + pageKey) !== "hidden";
  } catch {
    return true;
  }
}

function writeVisible(pageKey, visible) {
  memory.delete(pageKey);
  try {
    window.localStorage.setItem(STORAGE_PREFIX + pageKey, visible ? "visible" : "hidden");
  } catch {
    memory.set(pageKey, visible);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback) {
  window.addEventListener(CHANGE_EVENT, callback);
  // Another tab changed the preference.
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function useKpiVisible(pageKey) {
  const visible = useSyncExternalStore(
    subscribe,
    () => readVisible(pageKey),
    () => true
  );

  return [visible, (next) => writeVisible(pageKey, next)];
}

function stripId(pageKey) {
  return `kpi-strip-${pageKey}`;
}

/**
 * Compact visibility button: Eye + "KPIs" while the strip is shown, EyeOff +
 * "KPIs" while it is hidden (the icon communicates visibility, not a
 * dropdown). Disclosure semantics: the accessible name stays "KPIs" and
 * `aria-expanded` carries the state, with `aria-controls` pointing at the
 * strip. The `title` is a hover hint only.
 */
export function KpiToggle({ pageKey }) {
  const [visible, setVisible] = useKpiVisible(pageKey);
  const Icon = visible ? Eye : EyeOff;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-expanded={visible}
      aria-controls={stripId(pageKey)}
      title={visible ? "Hide KPIs" : "Show KPIs"}
      onClick={() => setVisible(!visible)}
    >
      <Icon className="size-4" aria-hidden="true" />
      KPIs
    </Button>
  );
}

/** Wrapper for the KPI strip; collapses (`hidden`) when the preference is off. */
export function KpiStrip({ pageKey, children }) {
  const [visible] = useKpiVisible(pageKey);

  return (
    <div id={stripId(pageKey)} hidden={!visible}>
      {children}
    </div>
  );
}
