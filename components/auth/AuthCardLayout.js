/**
 * A single leaf: pointed at two opposite corners, drawn from the brand colour at a very low
 * opacity so it reads as a soft shape behind the card, never as content.
 */
function Leaf({ className }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <path d="M0 100 C0 42 42 0 100 0 C100 58 58 100 0 100 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The sign-in screen's chrome: a soft teal-white wash with large translucent leaves in two
 * corners, the YogaSync mark centred above a single white card, and the copyright line below.
 * The card's own content (heading, form, help text) is the page's `children`.
 *
 * This is the product's own brand (the YogaSync logo), separate from a centre's own uploaded
 * logo shown after sign-in (`CenterLogo`, Center Settings). Everything decorative is
 * `aria-hidden`.
 *
 * Used by the sign-in, forgot-password and reset-password screens — the recovery flow a signed-out
 * visitor walks end to end. Invitation and account-recovery links still use `AuthLayout`.
 */
export default function AuthCardLayout({ children }) {
  return (
    <div className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden bg-linear-to-br from-brand/5 via-surface to-brand/10 px-4 py-10">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <Leaf className="absolute -top-16 -right-16 size-72 rotate-12 text-brand/10 sm:size-96" />
        <Leaf className="absolute top-24 -right-24 size-56 -rotate-6 text-brand/5 sm:size-72" />
        <Leaf className="absolute -bottom-24 -left-16 size-72 -rotate-[100deg] text-brand/10 sm:size-[26rem]" />
        <Leaf className="absolute bottom-10 -left-28 size-56 rotate-[170deg] text-brand/5 sm:size-72" />
      </div>

      <div className="flex w-full max-w-md flex-col items-center">
        <div className="mb-6 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- same tradeoff as CenterLogo */}
          <img src="/yogasync.png" alt="YogaSync" className="h-40 w-auto" />
        </div>

        <main className="w-full rounded-card border border-border bg-surface p-6 shadow-sm sm:p-8">{children}</main>

        <p className="text-small mt-8 text-center text-text-secondary">
          © {new Date().getFullYear()} YogaSync. All rights reserved.
        </p>
      </div>
    </div>
  );
}
