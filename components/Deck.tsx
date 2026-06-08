"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type DeckHandle = { goTo: (index: number) => void };

type DeckProps = {
  labels: string[];
  surfaces: ReactNode[];
  onActiveChange?: (index: number) => void;
};

// A horizontally scroll-snapped deck of full-screen surfaces. Swipe / trackpad,
// arrow keys, indicator dots, and an imperative goTo() (for AUGUST's nav tool).
const Deck = forwardRef<DeckHandle, DeckProps>(function Deck(
  { labels, surfaces, onActiveChange },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const count = surfaces.length;

  const goTo = (index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const i = Math.max(0, Math.min(count - 1, index));
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  useImperativeHandle(ref, () => ({ goTo }), [count]);

  // Track the active surface from scroll position.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let t = 0;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const i = Math.round(el.scrollLeft / el.clientWidth);
        setActive((prev) => {
          if (i !== prev) onActiveChange?.(i);
          return i;
        });
      }, 60);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(t);
    };
  }, [onActiveChange]);

  // Arrow keys — but never hijack typing in the composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(active + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(active - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <>
      <div ref={scrollRef} className="deck-scroll">
        {surfaces.map((surface, i) => (
          <section key={i} className="deck-surface" aria-label={labels[i]}>
            {surface}
          </section>
        ))}
      </div>

      <div className="deck-indicators" role="tablist" aria-label="Surfaces">
        {labels.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={`deck-dot${i === active ? " active" : ""}`}
            onClick={() => goTo(i)}
            title={label}
          >
            <span className="deck-dot-mark" />
            <span className="deck-dot-label">{label}</span>
          </button>
        ))}
      </div>
    </>
  );
});

export default Deck;
