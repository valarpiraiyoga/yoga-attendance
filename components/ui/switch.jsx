"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-neutral/40 outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-checked:bg-brand",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-surface shadow-xs transition-transform data-checked:translate-x-[18px]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
