import { cn } from "@/lib/utils";

/**
 * The centre's uploaded logo (Center Settings) in the shell's brand slot.
 * Renders nothing when no logo has been set, so the brand text sits exactly
 * where it always has. Decorative (`alt=""`): the centre's name is right beside
 * it, so a screen reader hears it once. The logo is contained, never cropped or
 * stretched, at a fixed square so every logo aspect ratio fits the same slot.
 *
 * It sits on a white tile with inner padding (and a hairline border), so a logo with
 * its own background or no margin never touches the tile's edge, and one with a
 * transparent background stays legible on the sidebar's tinted surface.
 */
export default function CenterLogo({ url, className }) {
  if (!url) return null;

  return (
    // A plain <img>: the same tradeoff as every other stored image here (see Avatar).
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={cn("size-12 shrink-0 rounded-lg border border-border/60 bg-surface object-contain p-2", className)} />
  );
}
