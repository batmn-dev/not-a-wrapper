"use client"

import { Badge } from "@/components/ui/badge"
import { Icon } from "@/components/ui/icon"
import {
  RiCheckLine,
  RiCloseLine,
  RiLoader4Line,
  type RemixiconComponentType,
} from "@remixicon/react"
import { AnimatePresence, motion } from "motion/react"

export type ToolChipStatus =
  "review" | "running" | "stopped" | "failed" | "denied" | "completed"

type ChipMeta = {
  label: string
  variant: "warning" | "info" | "neutral" | "danger" | "success"
  icon?: RemixiconComponentType
  spin?: boolean
}

// status → appearance, as data. The tones are Badge variants (the design
// system's status colors), so this record only names label + icon. `failed`
// and `denied` deliberately share tone + icon — only the label differs.
const CHIP: Record<ToolChipStatus, ChipMeta> = {
  review: { label: "Review", variant: "warning" },
  running: {
    label: "Running",
    variant: "info",
    icon: RiLoader4Line,
    spin: true,
  },
  stopped: { label: "Stopped", variant: "neutral" },
  failed: { label: "Failed", variant: "danger", icon: RiCloseLine },
  denied: { label: "Denied", variant: "danger", icon: RiCloseLine },
  completed: { label: "Completed", variant: "success", icon: RiCheckLine },
}

// One pure first-match ladder decides the status (mirrors the "Assistant turn
// phase" philosophy: one derivation, not per-affordance gates). The order is
// load-bearing — approval and in-flight outrank terminal outcomes.
export function deriveToolChipStatus(flags: {
  isAwaitingApproval: boolean
  isLoading: boolean
  isStopped: boolean
  isError: boolean
  isDenied: boolean
}): ToolChipStatus {
  if (flags.isAwaitingApproval) return "review"
  if (flags.isLoading) return "running"
  if (flags.isStopped) return "stopped"
  if (flags.isError) return "failed"
  if (flags.isDenied) return "denied"
  return "completed"
}

/**
 * The single tool-call status pill. One animated Badge, keyed by status so a
 * transition crossfades on change. Replaces six hand-rolled `motion.div` chips
 * that each re-declared the same blur/scale transition and bypassed Badge.
 */
export function StatusChip({ status }: { status: ToolChipStatus }) {
  const meta = CHIP[status]
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={status}
        initial={{ opacity: 0, scale: 0.9, filter: "blur(2px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.9, filter: "blur(2px)" }}
        transition={{ duration: 0.15 }}
      >
        <Badge variant={meta.variant}>
          {meta.icon && (
            <Icon
              icon={meta.icon}
              slotSize={12}
              className={meta.spin ? "animate-spin" : undefined}
            />
          )}
          {meta.label}
        </Badge>
      </motion.div>
    </AnimatePresence>
  )
}
