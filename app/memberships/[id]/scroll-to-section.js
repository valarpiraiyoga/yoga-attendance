"use client";

import { useEffect } from "react";
import { scrollTopBelowHeader } from "@/lib/memberships/payment-focus";

/**
 * Scrolls a section of this page into view once, when the page was opened with `?focus=...` (the page renders this only then): after
 * the first commit, so the section exists, it scrolls the shell's scroll container (`<main>`) to put the section just below the sticky
 * detail header (`[data-sticky-header]`, measured - its height varies - and counted only while it is actually sticky), smoothly unless
 * the person prefers reduced motion, and moves keyboard focus to the section. The `focus` parameter is then removed from the address
 * (history `replaceState`, as `FlashToast` does) so a reload or a copied link does not jump again.
 *
 * @param {object} props
 * @param {string} props.targetId - the section element's id.
 */
export default function ScrollToSection({ targetId }) {
  useEffect(() => {
    const target = document.getElementById(targetId);
    const container = target?.closest("main");
    if (target && container) {
      const header = container.querySelector("[data-sticky-header]");
      const sticky = header && getComputedStyle(header).position === "sticky";
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      container.scrollTo({
        top: scrollTopBelowHeader({
          targetTop: target.getBoundingClientRect().top,
          containerTop: container.getBoundingClientRect().top,
          scrollTop: container.scrollTop,
          headerBottom: sticky ? header.getBoundingClientRect().bottom : 0,
        }),
        behavior: reduceMotion ? "auto" : "smooth",
      });
      target.focus({ preventScroll: true });
    }

    const url = new URL(window.location.href);
    if (url.searchParams.has("focus")) {
      url.searchParams.delete("focus");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  }, [targetId]);

  return null;
}
