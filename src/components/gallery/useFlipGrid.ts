/**
 * FLIP for the grid: remember where each `[data-flip-id]` child was, and when
 * the order changes animate it from the old position to the new one; brand-new
 * children fade in. Web Animations API, no library. Skipped entirely under
 * prefers-reduced-motion.
 */
import { type RefObject, useLayoutEffect, useRef } from "react";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

interface Point {
  left: number;
  top: number;
}

export function useFlipGrid(
  ref: RefObject<HTMLElement | null>,
  orderKey: string,
): void {
  const previous = useRef<Map<string, Point>>(new Map());
  const running = useRef(new WeakMap<HTMLElement, Animation>());

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

    // Cancel any FLIP animation still applying its transform before we
    // measure: getBoundingClientRect() on a mid-animation element returns
    // its transformed (in-flight) box, which would corrupt the next delta.
    for (const el of children) running.current.get(el)?.cancel();

    // Measure relative to the grid root, not the viewport — otherwise page
    // scroll between two order changes gets folded into every tile's delta.
    const rootRect = root.getBoundingClientRect();
    const next = new Map<string, Point>();
    for (const el of children) {
      const rect = el.getBoundingClientRect();
      next.set(el.dataset.flipId as string, {
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
      });
    }

    if (!reduced && previous.current.size > 0) {
      for (const el of children) {
        const id = el.dataset.flipId as string;
        const before = previous.current.get(id);
        const after = next.get(id) as Point;
        if (!before) {
          // Opacity-only: a transform here would fight with the CSS
          // `animate-pop` a just-arrived tile also carries.
          const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 260,
            easing: EASE,
          });
          running.current.set(el, anim);
          continue;
        }
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (dx !== 0 || dy !== 0) {
          const anim = el.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: "none" },
            ],
            { duration: 320, easing: EASE },
          );
          running.current.set(el, anim);
        }
      }
    }
    previous.current = next;
  }, [ref, orderKey]);
}
