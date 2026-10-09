"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function Popover({ ...props }) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  align = "end",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  className,
  ...props
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-lg bg-popover p-4 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverTitle({ className, ...props }) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("text-body font-semibold text-text-primary", className)}
      {...props}
    />
  )
}

export { Popover, PopoverTrigger, PopoverContent, PopoverTitle }
