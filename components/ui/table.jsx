import * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-body", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-background [&_tr]:border-b [&_tr]:border-border", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t border-border bg-background font-medium", className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }) {
  return (
    <tr
      data-slot="table-row"
      className={cn("border-b border-border transition-colors", className)}
      {...props}
    />
  )
}

function TableHead({ className, ...props }) {
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn(
        "h-9 px-3 text-left align-middle text-small font-medium tracking-wide text-text-secondary uppercase",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }) {
  return (
    <td
      data-slot="table-cell"
      className={cn("p-3 align-middle text-body text-text-primary", className)}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-3 text-small text-text-secondary", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
