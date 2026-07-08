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
  // Ref mirrors active for change-detection inside the scroll handler without
  // needing a setState updater — calling onActiveChange inside an updater would
  // invoke the parent's setState during Deck's render, which React forbids.
  const activeRef = useRef(0);
  const count = surfaces.length;

  const goTo = (index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const i = Math.max(0, Math.min(count - 1, index));
    // Target the slide's REAL offset, not i×clientWidth — identical when the
    // geometry is exact, still correct at fractional zoom widths.
    const slide = el.children[i] as HTMLElement | undefined;
    const left = slide ? slide.offsetLeft : i * el.clientWidth;
    // An explicit "smooth" overrides CSS scroll-behavior, so reduced motion has
    // to be honored here — the deck slide is the largest animation in the app.
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";
    el.scrollTo({ left, behavior });
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
        if (i === activeRef.current) return; // no change — nothing to do
        activeRef.current = i;
        setActive(i);
        // Defer the parent callback to after paint — calling onActiveChange
        // synchronously here (or inside a setState updater) would setState on
        // Home while Deck is still rendering, triggering React's "update during
        // render of different component" warning.
        requestAnimationFrame(() => onActiveChange?.(i));
      }, 60);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(t);
    };
  }, [onActiveChange]);

  // The deck must never REST off-snap — that is how a surface's docked chrome
  // ends up half off-viewport (the World LAYERS chip clipped at the left edge).
  // Two real drift sources exist:
  //  1. Sequential focus (Tab) into an off-screen slide's control: the browser
  //     scrolls this container just far enough to reveal the control, and
  //     Chromium does not re-snap mandatory snap containers after focus scrolls
  //     — the deck rests misaligned by up to a panel's width.
  //  2. Window resizes: scrollLeft is preserved while the snap offsets move.
  // Heal both: promote a focus scroll into a proper slide navigation, and re-pin
  // the active slide (instantly — it's a layout correction, not motion) once a
  // resize settles. Both are no-ops when the deck is already aligned.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      const idx = (Array.from(el.children) as HTMLElement[]).findIndex((k) => k.contains(t));
      if (idx >= 0) goTo(idx);
    };
    let rt = 0;
    const onResize = () => {
      window.clearTimeout(rt);
      rt = window.setTimeout(() => {
        const slide = el.children[activeRef.current] as HTMLElement | undefined;
        if (!slide || Math.abs(el.scrollLeft - slide.offsetLeft) <= 1) return;
        const prev = el.style.scrollBehavior;
        el.style.scrollBehavior = "auto";
        el.scrollLeft = slide.offsetLeft;
        el.style.scrollBehavior = prev;
      }, 120);
    };
    el.addEventListener("focusin", onFocusIn);
    window.addEventListener("resize", onResize);
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(rt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chrome parallax: while the deck scrolls, fixed chrome (boot HUD, indicator
  // dots) drifts a few px against the scroll velocity and eases back to 0 at
  // rest. Velocity-based, so there is no discontinuity at snap midpoints. The
  // rAF loop sleeps once settled and wakes on the next scroll event.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Cinematic depth: the leaving surface eases back (scale + dim) while the
    // entering one comes forward. Pure transform + opacity — GPU-composited, no
    // layout, no blur — so it stays buttery even over the WebGL surfaces.
    const surfaces = Array.from(el.children) as HTMLElement[];
    const applyDepth = () => {
      const w = el.clientWidth || 1;
      const sl = el.scrollLeft;
      for (let i = 0; i < surfaces.length; i++) {
        const off = Math.min(1, Math.abs(i - sl / w));
        if (off < 0.001) {
          surfaces[i].style.transform = "";
          surfaces[i].style.opacity = "";
        } else {
          surfaces[i].style.transform = `scale(${(1 - 0.06 * off).toFixed(4)})`;
          surfaces[i].style.opacity = `${(1 - 0.5 * off).toFixed(3)}`;
        }
      }
    };

    let raf = 0;
    let lastLeft = el.scrollLeft;
    let drift = 0;
    let settled = 0;
    const tick = () => {
      applyDepth();
      const left = el.scrollLeft;
      const vel = left - lastLeft;
      lastLeft = left;
      const target = Math.max(-9, Math.min(9, -vel * 0.18));
      drift += (target - drift) * 0.16;
      settled = vel === 0 && Math.abs(drift) < 0.05 ? settled + 1 : 0;
      document.documentElement.style.setProperty("--chrome-drift", `${drift.toFixed(2)}px`);
      if (settled > 30) {
        document.documentElement.style.setProperty("--chrome-drift", "0px");
        applyDepth();
        surfaces.forEach((s) => (s.style.willChange = ""));
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!raf) {
        lastLeft = el.scrollLeft;
        settled = 0;
        surfaces.forEach((s) => (s.style.willChange = "transform, opacity"));
        raf = requestAnimationFrame(tick);
      }
    };
    applyDepth();
    el.addEventListener("scroll", wake, { passive: true });
    return () => {
      el.removeEventListener("scroll", wake);
      if (raf) cancelAnimationFrame(raf);
      document.documentElement.style.removeProperty("--chrome-drift");
      surfaces.forEach((s) => {
        s.style.transform = "";
        s.style.opacity = "";
        s.style.willChange = "";
      });
    };
  }, []);

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
