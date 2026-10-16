import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Page } from "@/components/dashboard";
import { textPieces, type TourStep } from "@/lib/tour";
import "./tour.css";

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Every element the first of `selectors` finds, as one box on the screen; null when none shows. */
function boxOf(selectors: readonly string[]): Box | null {
  for (const selector of selectors) {
    const rects = [...document.querySelectorAll(selector)]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rects.length) continue;
    const top = Math.min(...rects.map((rect) => rect.top)),
      left = Math.min(...rects.map((rect) => rect.left));
    return {
      top,
      left,
      width: Math.max(...rects.map((rect) => rect.right)) - left,
      height: Math.max(...rects.map((rect) => rect.bottom)) - top,
    };
  }
  return null;
}
/** The menu's entry for the page on show: the rail's on a tablet or a desktop, the tab's on a phone. */
const MENU = [
  ".app-rail .rail-item[aria-current='page']",
  ".phone-tabs .phone-tab[aria-current='page']",
];
const still = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Scroll `box` up under the top of the window, when the card or the window's edge hides it. */
function bringIntoView(box: Box, card: HTMLElement | null) {
  const bottom = Math.min(window.innerHeight, card?.getBoundingClientRect().top ?? Infinity);
  if (box.top >= 8 && box.top + Math.min(box.height, 120) <= bottom - 8) return;
  window.scrollBy({ top: box.top - 16, behavior: still() ? "auto" : "smooth" });
}

/** The first-run tour: a card that walks through the dashboard's pages one stop at a time, opening
 * each and ringing what it is about (and, on a wide screen, its entry in the menu). It ends on the
 * room's switches. Escape, or the close button, ends it anywhere. */
export function Tour({
  steps,
  index,
  page,
  navigate,
  onIndex,
  onClose,
}: {
  steps: TourStep[];
  index: number;
  page: Page;
  navigate: (page: Page) => void;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const titleId = useId(),
    textId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  // The step's page, once per step; then where the tour is, for a screen reader.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (opened.current === step.id) return;
    opened.current = step.id;
    if (step.page && step.page !== page) navigate(step.page);
    heading.current?.focus({ preventScroll: true });
  }, [step, page, navigate]);
  // Ring what the step is about, wherever it is drawn now: pages load and the window scrolls.
  useEffect(() => {
    let frame = 0,
      drawn = "",
      scrolled = false;
    const track = () => {
      const target = boxOf(step.target),
        menu = step.page ? boxOf(MENU) : null;
      const next = [target, menu].filter((box): box is Box => box !== null);
      const key = next
        .map((box) => [box.top, box.left, box.width, box.height].map(Math.round))
        .join();
      if (key !== drawn) {
        drawn = key;
        setBoxes(next);
      }
      if (target && !scrolled) {
        scrolled = true;
        bringIntoView(target, card.current);
      }
      frame = requestAnimationFrame(track);
    };
    frame = requestAnimationFrame(track);
    return () => cancelAnimationFrame(frame);
  }, [step]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  return (
    <>
      {boxes.map((box, n) => {
        // Inside the window's width: a ring round a full-width panel stays on the screen.
        const left = Math.max(2, box.left - 6),
          right = Math.min(width - 2, box.left + box.width + 6);
        return (
          <div
            key={n}
            className="tour-ring"
            aria-hidden="true"
            data-tour-ring
            style={{ top: box.top - 6, left, width: right - left, height: box.height + 12 }}
          />
        );
      })}
      <div
        ref={card}
        className="tour-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={textId}
        data-tour-step={step.id}
      >
        <div className="tour-head">
          <span className="tour-count">
            {index + 1} of {steps.length}
          </span>
          <Button variant="ghost" size="icon" aria-label="Close the tour" onClick={onClose}>
            <X size={17} />
          </Button>
        </div>
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {step.title}
        </h2>
        <p id={textId}>
          {textPieces(step.text).map((piece, n) =>
            n % 2 ? <strong key={n}>{piece}</strong> : piece,
          )}
        </p>
        <div className="tour-actions">
          {index === 0 ? (
            <Button variant="ghost" onClick={onClose}>
              Skip
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onIndex(index - 1)}>
              Back
            </Button>
          )}
          <Button onClick={() => (last ? onClose() : onIndex(index + 1))}>
            {last ? "Done" : index === 0 ? "Show me" : "Next"}
          </Button>
        </div>
      </div>
    </>
  );
}
