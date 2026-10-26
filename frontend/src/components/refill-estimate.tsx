import { useEffect, useState } from "react";
import type { Controller, Series } from "@/lib/types";
import { levelReadings, type LevelSource } from "@/lib/tank-telemetry";
import { inAbout, refillByWords, refillEstimate, type RefillEstimate } from "@/lib/refill-estimate";
import { whileVisible } from "@/lib/live";

/** How often the estimate reads the level's history again while it shows. */
const REFRESH_MS = 10 * 60_000;
/** A little over the day it goes by: the day's first quarter-hour needs a reading before it. */
const HOURS = 25;

export interface RefillBy {
  estimate: RefillEstimate;
  /** The level it is worked out to: the reservoir's minimum, 0 without one. */
  minimum: number;
  /** Refilled by hand: when the reminder to refill comes (at `remindPct`), where one does. */
  reminder: RefillEstimate | null;
  remindPct: number | null;
  /** The controller refills it by itself (LevelSource.selfRefilling). */
  selfRefilling: boolean;
  now: number;
}

/** The reservoir's estimated refill (lib/refill-estimate), from its recorded level; null while that
 * has not been read, or with no level to read. */
export function useRefillBy(
  controller: Controller,
  source: LevelSource | null,
  current: number | null,
): RefillBy | null {
  const [loaded, setLoaded] = useState<{ entityId: string; points: Series["points"] } | null>(null);
  const [tick, setTick] = useState(0);
  const entityId = source?.entityId ?? "";
  useEffect(() => whileVisible(() => setTick((value) => value + 1), REFRESH_MS), []);
  useEffect(() => {
    if (!entityId) return;
    let live = true;
    const abort = new AbortController();
    controller
      .history([entityId], HOURS, abort.signal)
      .then(([series]) => {
        if (live) setLoaded({ entityId, points: series?.points ?? [] });
      })
      .catch(() => {
        if (live) setLoaded({ entityId, points: [] });
      });
    return () => {
      live = false;
      abort.abort();
    };
  }, [controller.roomId, controller.connection, entityId, tick]);
  if (!source || loaded?.entityId !== entityId) return null;
  const now = Date.now();
  const minimum = source.minPct ?? 0;
  const readings = levelReadings(loaded.points, source);
  const remindPct = source.remindPct;
  return {
    estimate: refillEstimate(readings, current, minimum, now),
    minimum,
    reminder:
      remindPct !== null && current !== null && current > remindPct
        ? refillEstimate(readings, current, remindPct, now)
        : null,
    remindPct,
    selfRefilling: source.selfRefilling,
    now,
  };
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const pctWords = (pct: number) => `${pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`;

/** The estimate in words: what it is called, when ("Thu, around 9:00 am") and how it was worked out.
 * Owner, 2026-10-26: a reservoir refilled by hand needs its refill by then ("Estimated refill needed
 * by"); one the controller refills itself is refilled by then ("Estimated refill by"). */
export function refillByText({
  estimate,
  minimum,
  reminder,
  remindPct,
  selfRefilling,
  now,
}: RefillBy): { label: string; when: string; note: string } {
  const label = selfRefilling ? "Estimated refill by" : "Estimated refill needed by";
  const to = minimum > 0 ? `its ${pctWords(minimum)} minimum` : "empty";
  if (estimate.at === null) return { label, when: "Not known yet", note: estimate.reason ?? "" };
  const rate = `It used ${pctWords(estimate.perDay ?? 0)} of the tank in the last day.`;
  if (estimate.at <= now) return { label, when: "Now", note: `It is at ${to}.` };
  const remind =
    reminder?.at && reminder.at !== Infinity && remindPct !== null
      ? ` The reminder to refill comes at ${pctWords(remindPct)}, ${refillByWords(reminder.at, now)}.`
      : "";
  return {
    label,
    when: capital(refillByWords(estimate.at, now)),
    note: `${capital(inAbout(estimate.at - now))}, at ${to}. ${rate}${remind}`,
  };
}
