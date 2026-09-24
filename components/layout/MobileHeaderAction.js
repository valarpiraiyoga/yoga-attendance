"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/** The right-hand slot of the mobile top bar (`components/global/Header.js`). */
export const MOBILE_HEADER_ACTIONS_ID = "mobile-header-actions";

const subscribe = () => () => {};
const getTarget = () => document.getElementById(MOBILE_HEADER_ACTIONS_ID);
const getServerTarget = () => null;

/**
 * Renders `children` into the mobile top bar's action slot — the page-level
 * control (e.g. Attendance History's date range) that belongs beside the
 * hamburger and app name, not below the page heading. The top bar lives in the
 * shared shell (AppShell), so a page hands its control up through this portal
 * rather than the shell knowing about any page.
 *
 * The slot only exists below `lg` (the top bar is hidden from `lg`), so a page
 * shows the same control in its own `PageHeader` actions from `lg` up.
 * Renders nothing on the server and until the slot is found.
 */
export default function MobileHeaderAction({ children }) {
  const target = useSyncExternalStore(subscribe, getTarget, getServerTarget);
  return target ? createPortal(children, target) : null;
}
