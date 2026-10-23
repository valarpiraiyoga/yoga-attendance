// The reminder data layer's queries and assembly, written against a Supabase client passed in (01-product.md §5 "Reminders"). Pure of framework
// imports - relative imports only, no "server-only", no Next.js - so `npm test` drives it with a fake client. `lib/reminders/data.js` is the
// server-only, Admin-only entry point that supplies the client and the centre's date.
//
// Three reads, each paged so no result is silently cut at the API's row limit:
//   1. CANDIDATES - non-cancelled memberships that could have a reminder today: an end date on or before today + 6 (the expiry window, already
//      expired included) OR a Payment Status of Pending / Partially Paid. Everything else can have neither reminder, so it is not read.
//   2. STUDENT CONTEXT - EVERY membership of the students with an expiry candidate, whatever its status or dates (active, future, expired,
//      cancelled): which membership is the student's latest-ending one, and whether another membership covers today, must be judged on all of
//      them, never only on those inside the window.
//   3. PAYMENTS - the recorded payment amounts of the payment candidates, so each balance is the existing calculation (`outstandingBalancePaise`
//      -> `summarizePayments`), never a separate formula.
// The rules themselves are R1's (`lib/reminders/rules.js`); this file only gathers their inputs and attaches what the screens show.

import { expiryReminderOf, expiryReminderStart, outstandingBalancePaise, paymentReminderOf, PAYMENT_REMINDER_STATUSES } from "./rules.js";
import { expiringSoonCutoff } from "../memberships/validity.js";

/** The API returns at most this many rows per request; every read pages through with this size. */
export const PAGE_SIZE = 1000;

/** Ids per `.in(...)` filter, so a request URL stays short however many students or memberships are involved. */
export const IN_CHUNK_SIZE = 100;

// Only what the rules and the reminder screens need - no notes or pricing breakdown. The student's phone and email are for the reminder message
// popup's WhatsApp and email links (opened from the Dashboard's reminders); the rules never read them.
const CANDIDATE_COLUMNS =
  "id, membership_code, student_id, kind, plan, package_name, start_date, end_date, cancelled_at, payment_status, amount, currency, students(id, full_name, student_code, photo_url, phone, phone_country_code, email)";
const CONTEXT_COLUMNS = "id, student_id, start_date, end_date, cancelled_at";
const PAYMENT_COLUMNS = "membership_id, amount";

const chunk = (values, size) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

// Every row of a query, page by page. `build()` must return a fresh, ordered query each time (a builder cannot be reused once awaited).
async function readAll(build, label) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(`[reminders] Could not load ${label}:`, error.code, error.message);
      throw new Error("Could not load reminders.");
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

/** Read 1: memberships that could have a reminder on `today`. */
export function fetchReminderCandidates(supabase, today) {
  // The latest end date that is inside the expiry window today: today + 6 - the "Expiring Soon" cutoff (an end date at or before it, expired ones
  // included, is in the window).
  const cutoff = expiringSoonCutoff(today);
  const statuses = PAYMENT_REMINDER_STATUSES.join(",");
  return readAll(
    () =>
      supabase
        .from("memberships")
        .select(CANDIDATE_COLUMNS)
        .is("cancelled_at", null)
        .or(`and(end_date.not.is.null,end_date.lte.${cutoff}),payment_status.in.(${statuses})`)
        .order("id", { ascending: true }),
    "reminder candidates"
  );
}

/** Read 2: every membership of these students - the renewal context - whatever its status or dates. */
export async function fetchStudentMemberships(supabase, studentIds) {
  const rows = [];
  for (const ids of chunk([...new Set(studentIds)].filter(Boolean), IN_CHUNK_SIZE)) {
    rows.push(
      ...(await readAll(
        () => supabase.from("memberships").select(CONTEXT_COLUMNS).in("student_id", ids).order("id", { ascending: true }),
        "the students' memberships"
      ))
    );
  }
  return rows;
}

/** Read 3: the recorded payments (amounts only) of these memberships, grouped by membership. */
export async function fetchPaymentsByMembership(supabase, membershipIds) {
  const byMembership = new Map();
  for (const ids of chunk([...new Set(membershipIds)].filter(Boolean), IN_CHUNK_SIZE)) {
    const rows = await readAll(
      () => supabase.from("membership_payments").select(PAYMENT_COLUMNS).in("membership_id", ids).order("id", { ascending: true }),
      "the memberships' payments"
    );
    for (const row of rows) {
      const list = byMembership.get(row.membership_id) ?? [];
      list.push(row);
      byMembership.set(row.membership_id, list);
    }
  }
  return byMembership;
}

// What a reminder row shows about its membership and student (R3 turns these into words).
function displayOf(membership) {
  return {
    membership: {
      id: membership.id,
      code: membership.membership_code,
      kind: membership.kind ?? null,
      plan: membership.plan ?? null,
      packageName: membership.package_name ?? null,
      startDate: membership.start_date,
      endDate: membership.end_date ?? null,
      paymentStatus: membership.payment_status,
      currency: membership.currency ?? null,
    },
    student: {
      id: membership.students?.id ?? membership.student_id,
      fullName: membership.students?.full_name ?? null,
      studentCode: membership.students?.student_code ?? null,
      photoUrl: membership.students?.photo_url ?? null,
      phone: membership.students?.phone ?? null,
      phoneCountryCode: membership.students?.phone_country_code ?? null,
      email: membership.students?.email ?? null,
    },
  };
}

/**
 * Every current reminder on `today`, with what the screens show for each. Expiry and payment reminders are separate entries (a membership with
 * both contributes two). Ordered most urgent first: expiry reminders by end date (longest overdue first), then payment reminders by start date.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase - the signed-in Admin's own client (RLS applies).
 * @param {string} today - the centre's date, "YYYY-MM-DD".
 * @returns {Promise<{ today: string, reminders: object[], counts: { total: number, expiry: number, payment: number } }>}
 */
export async function loadReminders(supabase, today) {
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new TypeError("A centre-local `today` (YYYY-MM-DD) is required: reminders never read the machine's clock.");
  }
  const candidates = await fetchReminderCandidates(supabase, today);

  // Expiry needs the renewal context of its students; payment needs the balances of its memberships. Neither is read when nothing needs it.
  const expiryCandidates = candidates.filter((membership) => membership.end_date && today >= expiryReminderStart(membership.end_date));
  const paymentCandidates = candidates.filter((membership) => PAYMENT_REMINDER_STATUSES.includes(membership.payment_status));

  const [studentMemberships, paymentsByMembership] = await Promise.all([
    expiryCandidates.length > 0 ? fetchStudentMemberships(supabase, expiryCandidates.map((membership) => membership.student_id)) : [],
    paymentCandidates.length > 0 ? fetchPaymentsByMembership(supabase, paymentCandidates.map((membership) => membership.id)) : new Map(),
  ]);

  const byStudent = new Map();
  for (const membership of studentMemberships) {
    const list = byStudent.get(membership.student_id) ?? [];
    list.push(membership);
    byStudent.set(membership.student_id, list);
  }

  const expiry = [];
  const payment = [];
  for (const membership of candidates) {
    const expiryReminder = expiryReminderOf(membership, { today, studentMemberships: byStudent.get(membership.student_id) ?? [] });
    if (expiryReminder) expiry.push({ ...expiryReminder, ...displayOf(membership) });

    if (PAYMENT_REMINDER_STATUSES.includes(membership.payment_status)) {
      const balancePaise = outstandingBalancePaise(membership, paymentsByMembership.get(membership.id) ?? []);
      const paymentReminder = paymentReminderOf(membership, { balancePaise });
      if (paymentReminder) payment.push({ ...paymentReminder, ...displayOf(membership) });
    }
  }

  expiry.sort((a, b) => a.endDate.localeCompare(b.endDate) || a.membershipId.localeCompare(b.membershipId));
  payment.sort((a, b) => a.membership.startDate.localeCompare(b.membership.startDate) || a.membershipId.localeCompare(b.membershipId));

  const reminders = [...expiry, ...payment];
  return { today, reminders, counts: { total: reminders.length, expiry: expiry.length, payment: payment.length } };
}
