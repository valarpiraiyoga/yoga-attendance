import { Badge } from "@/components/ui/badge";
import { placesDisplay } from "@/lib/schedules/capacity";
import { cn } from "@/lib/utils";

/**
 * A schedule's places on a screen (V1 Final Improvements, S5; 01-product.md §7 "Schedule Capacity"): "10 / 20" (places taken /
 * capacity) with a Full badge once they are all taken, or "Unlimited". `places` is the series' reading a schedule row carries
 * (`attachSchedulePlaces`). When it could not be loaded a dash is shown - never a number that might be wrong. The same component
 * serves the Schedule list, the weekly grid's popup and Batch Details, so every screen reads the same; it holds no state, so it works
 * in server and client components alike. Capacity is per schedule: nothing here (or anywhere) is a batch-wide figure.
 *
 * @param {object} props
 * @param {object|null} [props.places] - `scheduleCapacity(...)`'s result, or null when unavailable.
 * @param {string} [props.className]
 */
export default function SchedulePlaces({ places, className }) {
  const view = placesDisplay(places);

  if (view.unavailable) {
    return (
      <span className={cn("text-text-secondary", className)} title="Places could not be loaded">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Places unavailable</span>
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums", className)}>
      <span className="text-text-secondary">{view.text}</span>
      {view.isFull ? <Badge variant="danger">Full</Badge> : null}
    </span>
  );
}
