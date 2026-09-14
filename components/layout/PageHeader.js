import { cn } from "@/lib/utils";

/**
 * Top-level heading area for an application page.
 *
 * Renders the page's single <h1>, an optional supporting description and
 * optional actions. Actions sit beside the title on wider screens and stack
 * beneath it on narrow screens.
 */
export default function PageHeader({ title, description, actions, className }) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-page-title font-semibold break-words text-text-primary">
          {title}
        </h1>
        {description ? (
          <p className="text-body mt-1 break-words text-text-secondary">{description}</p>
        ) : null}
      </div>

      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
