/** A zone the dryback words are about: its name, its phase and its own highest reading of the day as
 * the controller publishes it beside what the zone waits for (null before it says). */
export interface DrybackZone {
  name: string;
  phase: string;
  peak: number | null;
}

/** What a P3 dryback target works out to, beside it on Irrigation strategy. A zone in P2 or P3 has
 * had its day's peak, so the line it holds tonight is said from that peak. Before then, the line is
 * worked out from the Peak target, as a plan. In a room whose zones share one valve, each zone dries
 * back from its own peak, and the first zone to reach its own line waters them all (owner, 27 Nov
 * 2026: GT1-AT peaked at 99.4% and GT1-BP at 86.4%, and the card said 59.6% from the 85.1% Peak
 * target while the controller held one 60.5% line from the room's 86.4%). `zones`: the zone shown,
 * or every zone on the one valve. */
export function drybackWords(
  value: number,
  plannedPeak: number,
  zones: readonly DrybackZone[],
  shared: boolean,
  number: (value: number) => string,
): string {
  const line = (peak: number) => number(peak * (1 - value / 100));
  const today = zones.filter(
    (zone): zone is DrybackZone & { peak: number } =>
      (zone.phase === "P2" || zone.phase === "P3") && zone.peak !== null && zone.peak > 0,
  );
  const planned = Number.isFinite(plannedPeak) && plannedPeak > 0;
  if (shared) {
    const rule = `${number(value)}% of each zone’s own peak, and the first zone to reach its own line waters them all.`;
    if (today.length)
      return `${rule} Tonight: ${today.map((zone) => `${zone.name} ${line(zone.peak)}% (from ${number(zone.peak)}%)`).join(", ")}.`;
    return planned
      ? `${rule} From a ${number(plannedPeak)}% peak, that is ${line(plannedPeak)}%.`
      : rule;
  }
  const [zone] = today;
  if (zone)
    return `${number(value)}% of the day’s peak. Today’s was ${number(zone.peak)}%, so tonight’s line is ${line(zone.peak)}%.`;
  return planned
    ? `${number(value)}% of the day’s peak: from a ${number(plannedPeak)}% peak, down to ${line(plannedPeak)}%.`
    : `${number(value)}% of the day’s peak.`;
}
