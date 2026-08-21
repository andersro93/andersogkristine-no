/**
 * FLIP for the grid: remember where each `[data-flip-id]` child was, and when
 * the order changes animate it from the old position to the new one; brand-new
 * children fade/scale in. Web Animations API, no library. Skipped entirely
 * under prefers-reduced-motion.
 */
import { type RefObject, useLayoutEffect, useRef } from "react";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export function useFlipGrid(
  ref: RefObject<HTMLElement | null>,
  orderKey: string,
): void {
  const previous = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Recorded on the root purely so this effect genuinely depends on
    // `orderKey` (it otherwise only changes to retrigger the effect below).
    root.dataset.flipOrder = orderKey;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const children = Array.from(
      root.querySelectorAll<HTMLElement>("[data-flip-id]"),
    );
    const next = new Map<string, DOMRect>();
    for (const el of children)
      next.set(el.dataset.flipId as string, el.getBoundingClientRect());

    if (!reduced && previous.current.size > 0) {
      for (const el of children) {
        const id = el.dataset.flipId as string;
        const before = previous.current.get(id);
        const after = next.get(id) as DOMRect;
        if (!before) {
          el.animate(
            [
              { opacity: 0, transform: "scale(0.9)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: 260, easing: EASE },
          );
          continue;
        }
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (dx !== 0 || dy !== 0) {
          el.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: "none" },
            ],
            { duration: 320, easing: EASE },
          );
        }
      }
    }
    previous.current = next;
  }, [ref, orderKey]);
}
