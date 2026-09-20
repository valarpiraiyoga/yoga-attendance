"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Live search for the URL-driven list pages (Students, Memberships, Batches,
 * Schedule, Attendance, Attendance History, Instructors). Pair it with
 * `SearchInput` (`value={query}`, `onChange={(e) => searchFor(e.target.value)}`,
 * `onClear={() => searchFor("")}`).
 *
 * Every keystroke writes the `q` URL param — replacing the history entry, so
 * typing does not pile up back-button steps — and the server re-runs the same
 * list query, so filtering, sorting and pagination stay server-side. Other
 * params (filters, view, sort) are kept; `page` is reset. The page must NOT
 * put `q` in the key of the filters component, or every keystroke would
 * remount the field and drop focus.
 *
 * @param {string} defaultQuery - the page's current `q`.
 * @param {object} [options]
 * @param {(params: URLSearchParams) => void} [options.prepare] - mutates the outgoing params (e.g. pins `view`).
 * @param {string} [options.emptyHref] - where to go when no params remain; defaults to the pathname.
 * @returns {{ query: string, setQuery: (value: string) => void, searchFor: (value: string) => void }}
 */
export function useLiveSearch(defaultQuery, { prepare, emptyHref } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(defaultQuery);

  // `q` values requested from this field that the page has not rendered yet.
  // A `defaultQuery` that is not one of them came from somewhere else (an
  // empty state's "Clear Filters" link, browser history, Clear All), and the
  // field then follows it; otherwise a slower response for an earlier
  // keystroke would overwrite what has been typed since.
  const requestedQueries = useRef([]);
  const lastRequestedQuery = useRef(defaultQuery);

  useEffect(() => {
    const index = requestedQueries.current.indexOf(defaultQuery);
    if (index >= 0) {
      requestedQueries.current = requestedQueries.current.slice(index + 1);
      return;
    }
    requestedQueries.current = [];
    lastRequestedQuery.current = defaultQuery;
    // Syncs the field to a `q` that changed outside it.
    setQuery(defaultQuery);
  }, [defaultQuery]);

  function searchFor(value) {
    setQuery(value);
    const trimmed = value.trim();
    if (trimmed === lastRequestedQuery.current) return;
    lastRequestedQuery.current = trimmed;
    requestedQueries.current.push(trimmed);

    const params = new URLSearchParams(searchParams);
    if (trimmed) params.set("q", trimmed);
    else params.delete("q");
    prepare?.(params);
    params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : (emptyHref ?? pathname));
  }

  return { query, setQuery, searchFor };
}
