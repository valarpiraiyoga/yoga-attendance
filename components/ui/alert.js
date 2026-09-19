"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one alert/banner component (06-ui-implementation-rules.md §11),
 * replacing the 17 duplicated copies of the form-level error div
 * (`border-danger/30 bg-danger/5` + `role="alert"`) plus the ad-hoc
 * in-card and page-level notices. Same behaviour, same position as the
 * form error it replaces — pass `role="alert"` for errors raised in
 * response to a user action; leave it unset for a static informational
 * banner.
 */
const TONE_STYLES = {
  info: { container: "border-info/20 bg-info/5", icon: "text-info", text: "text-text-secondary" },
  success: { container: "border-success/20 bg-success/5", icon: "text-success", text: "text-text-secondary" },
  warning: { container: "border-warning/20 bg-warning/5", icon: "text-warning", text: "text-text-secondary" },
  danger: { container: "border-danger/30 bg-danger/5", icon: "text-danger", text: "text-danger" },
};

const DEFAULT_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

export default function Alert({
  variant = "info",
  icon,
  title,
  children,
  onDismiss,
  role,
  className,
}) {
  const palette = TONE_STYLES[variant] ?? TONE_STYLES.info;
  const Icon = icon === null ? null : icon ?? DEFAULT_ICON[variant];

  return (
    <div
      role={role}
      className={cn("flex items-start gap-2.5 rounded-card border p-3", palette.container, className)}
    >
      {Icon ? <Icon className={cn("mt-0.5 size-4 shrink-0", palette.icon)} aria-hidden="true" /> : null}
      <div className="min-w-0 flex-1">
        {title ? <p className="text-body font-semibold text-text-primary">{title}</p> : null}
        {children ? <div className={cn("text-body", title ? "mt-0.5 text-text-secondary" : palette.text)}>{children}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-text-secondary transition-colors hover:bg-background hover:text-text-primary"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
