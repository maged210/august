// THE ONE DISCLAIMER COMPONENT (chore/ship-ready). Every surface that
// publishes a directional call, a level, a regime read, or THE CALL renders
// this. The strings live in lib/disclaimer so the non-React outputs (the push
// body, the share text, the JSON payloads) share the same source.
//
// IT IS RENDERED TEXT, NOT A TOOLTIP. No `title`, no hover, no sr-only, no
// `aria-label` standing in for visible copy. It is allowed to be small and
// quiet. It is not allowed to be unreadable: the styling in app/globals.css
// (.aug-disc) uses a real foreground token at 11px, not the 8.5px "disabled"
// grey the owner desk footer used to whisper in.

import { disclaimerText, type DisclaimerVariant } from "@/lib/disclaimer";

export default function Disclaimer({
  variant = "calls",
  className = "",
  block = true,
}: {
  variant?: DisclaimerVariant;
  /** extra positioning class from the host surface — never used to hide it */
  className?: string;
  /** false = inline flow (sits under a card); true = its own full-width row */
  block?: boolean;
}) {
  return (
    <p className={`aug-disc${block ? " aug-disc-block" : ""}${className ? ` ${className}` : ""}`}>
      {disclaimerText(variant)}
    </p>
  );
}
