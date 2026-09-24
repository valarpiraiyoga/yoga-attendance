import Avatar from "@/components/ui/avatar";
import { getBatchColor } from "@/lib/batches/identity";
import { cn } from "@/lib/utils";

/**
 * The batch's identity mark - the one place a batch's colour and image turn
 * into UI (Batch Identity, lib/batches/identity.js). It is the shared `Avatar`
 * in its square shape: the batch image when there is one, otherwise the initials
 * tile tinted in the batch colour. Either way it carries a soft outline in the
 * colour, so the accent reads even when an image fills the tile.
 *
 * Decorative by default (`alt=""`, initials `aria-hidden`): the batch name is
 * always shown beside it, so it adds no duplicate announcement. The colour is
 * never the only identifier. Pass `alt` where the mark stands alone (the form's
 * preview).
 *
 * `batch` is anything with `name`, `batch_color` and `batch_image_url`, so a
 * batches row, a schedule's joined `batches` object and an option all work.
 */
export default function BatchAvatar({ batch, size = "md", alt = "", className }) {
  const color = getBatchColor(batch?.batch_color);
  const name = batch?.name ?? "";
  const imageUrl = batch?.batch_image_url ?? null;

  if (imageUrl) {
    // A plain <img>: the same tradeoff as every other stored image here (see
    // Avatar). It is small and square-cropped, so next/image adds nothing.
    return (
      <Avatar
        name={name}
        src={imageUrl}
        alt={alt}
        shape="square"
        size={size}
        className={cn("border bg-surface", color.border, className)}
      />
    );
  }

  return <Avatar name={name} shape="square" size={size} className={cn("border", color.tile, color.border, className)} />;
}

/**
 * A small colour dot for a batch, for dense rows and headers where a whole
 * mark would be noise. Decorative: hidden from assistive technology, since the
 * batch name / code is always shown beside it.
 */
export function BatchColorDot({ color, className }) {
  return <span aria-hidden="true" className={cn("inline-block size-2.5 shrink-0 rounded-full", getBatchColor(color).dot, className)} />;
}
