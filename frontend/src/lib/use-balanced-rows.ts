import { useCallback, useState, type CSSProperties } from "react";

/** How many cards a row takes so a grid's rows come out as even as they can: as many rows as the
 * cards need at their least width, then as few cards a row as keep it to that many rows. Four that
 * fit three a row go two and two, not three and one; six that fit four go three and three. Null: no
 * cards, or no width to go on. */
export function balancedColumns(
  count: number,
  width: number,
  least: number,
  gap: number,
): number | null {
  if (count < 1 || !(width > 0) || !(least > 0)) return null;
  const fit = Math.max(1, Math.floor((width + gap) / (least + gap)));
  return Math.ceil(count / Math.ceil(count / fit));
}

/**
 * A grid of `count` cards in rows as even as they can be (balancedColumns), each row the full width.
 * A card's least width is the grid's `--card-min` and the gap its column gap, both from its CSS,
 * which lays the grid out (auto-fit) until it is measured. Owner, 2026-10-22: "Option B!" over a
 * last card alone on its row.
 */
export function useBalancedRows<T extends HTMLElement>(count: number) {
  const [columns, setColumns] = useState<number | null>(null);
  const ref = useCallback(
    (el: T | null) => {
      if (!el) return;
      const measure = () => {
        const style = getComputedStyle(el);
        const width =
          el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        setColumns(
          balancedColumns(
            count,
            width,
            parseFloat(style.getPropertyValue("--card-min")),
            parseFloat(style.columnGap) || 0,
          ),
        );
      };
      measure();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    },
    [count],
  );
  const style: CSSProperties | undefined = columns
    ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
    : undefined;
  return { ref, style };
}
