/**
 * Split layout shared by the authentication screens, following wireframe p1:
 * a brand/information panel beside the form.
 *
 * Branding is the YogaSync mark (the product's own brand, not a centre's uploaded
 * logo). The brand panel is hidden on small screens so the form gets the full width.
 */
export default function AuthLayout({ children }) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="hidden bg-background px-12 py-16 lg:flex lg:w-[42%] lg:flex-col lg:justify-between lg:border-r lg:border-border">
        {/* eslint-disable-next-line @next/next/no-img-element -- same tradeoff as CenterLogo */}
        <img src="/yogasync.png" alt="YogaSync" className="h-10 w-auto" />

        <p className="text-page-title max-w-sm font-semibold text-text-primary">
          Manage your classes and attendance in one place.
        </p>

        <div aria-hidden="true" />
      </aside>

      <main className="flex flex-1 items-center justify-center bg-surface px-4 py-12 sm:px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- same tradeoff as CenterLogo */}
            <img src="/yogasync.png" alt="YogaSync" className="h-9 w-auto" />
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}
