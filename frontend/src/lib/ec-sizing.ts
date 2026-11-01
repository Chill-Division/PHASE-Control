/** How pore EC sizes a zone's routine shots now, as the controller publishes it beside what the zone
 * waits for (sensor.crop_steering_<prefix>zone_N_waiting_for_app, crop_steering_engine.ec_sizing):
 * the reading it sizes by and, for the ramp (P1) and maintenance (P2) shots, their EC target and the
 * factor that gives (ec_adjust). Owner, 2 Nov 2026: GR1's ramp was set to start at 5% and every
 * shot went in at 2.5%, its EC 0.62 against a target of 5, and nothing here said so. */
export interface EcSizing {
  /** The pore EC the controller sizes by, mS/cm: the settled reading when it has one. */
  ec: number;
  P1: EcSizingPhase;
  P2: EcSizingPhase;
}
export interface EcSizingPhase {
  /** The phase's EC target, mS/cm. */
  target: number;
  /** What a shot set for the phase goes in at: 0.5 halves it, 2 doubles it, 1 leaves it as set. */
  scale: number;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function readPhase(raw: unknown): EcSizingPhase | null {
  if (!raw || typeof raw !== "object") return null;
  const { target, scale } = raw as Record<string, unknown>;
  return finite(target) && finite(scale) && scale > 0 ? { target, scale } : null;
}

/** The controller's EC sizing, or null when it publishes none: no EC reading, or a controller from
 * before it said. */
export function readEcSizing(raw: unknown): EcSizing | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const P1 = readPhase(value.P1),
    P2 = readPhase(value.P2);
  return finite(value.ec) && P1 && P2 ? { ec: value.ec, P1, P2 } : null;
}

/** Where pore EC is against the phase's target, and how its shots go in, by the factor: the engine's
 * ec_scale tiers. */
const TIERS: Record<string, { where: string; goes: string }> = {
  "0.5": { where: "under half", goes: "halved" },
  "0.7": { where: "under 0.8 times", goes: "at 70% of their size" },
  "1.2": { where: "over", goes: "1.2 times bigger, to dilute" },
  "1.5": { where: "over 1.2 times", goes: "1.5 times bigger, to dilute" },
  "2": { where: "over 1.5 times", goes: "doubled, to dilute" },
};

export interface EcSized {
  phase: "P1" | "P2";
  /** What a shot set for the phase goes in at. */
  scale: number;
  /** "under half": where pore EC is against the target. */
  where: string;
  /** "halved": how the phase's shots go in. */
  goes: string;
  ec: number;
  target: number;
}

/** How EC sizes the phase's shots now, or null when they go in as set. */
export function ecSized(sizing: EcSizing | null | undefined, phase: "P1" | "P2"): EcSized | null {
  const tier = sizing ? TIERS[String(sizing[phase].scale)] : undefined;
  return sizing && tier
    ? { phase, ...tier, scale: sizing[phase].scale, ec: sizing.ec, target: sizing[phase].target }
    : null;
}

/** Each shot size on Today, and the phase EC sizes it for. */
export const EC_SIZED_SETTINGS: Record<string, "P1" | "P2"> = {
  p1_initial_shot_size: "P1",
  p1_shot_size_increment: "P1",
  p2_shot_size: "P2",
};

/** Beside a shot size set to `value`: the size it goes in at while pore EC reads what it does, as
 * "Root-zone EC reads 0.62, under half its P1 target of 5, so ramp shots go in halved: the first at
 * 2.5%" (then `given`, what that is at the drippers). Null when it goes in as set. */
export function ecSizedWords(
  param: string,
  value: number | null,
  sizing: EcSizing | null | undefined,
  format: (value: number) => string,
  given?: string | null,
): string | null {
  const phase = EC_SIZED_SETTINGS[param];
  const sized = phase ? ecSized(sizing, phase) : null;
  if (!sized || value === null || !Number.isFinite(value)) return null;
  const size = `${format(value * sized.scale)}%`;
  if (param === "p1_shot_size_increment")
    return `Ramp shots go in ${sized.goes} while root-zone EC reads ${sized.where} its P1 target, so each adds ${size}.`;
  const shots = phase === "P1" ? "ramp shots" : "maintenance shots";
  return (
    `Root-zone EC reads ${format(sized.ec)}, ${sized.where} its ${phase} target of ${format(sized.target)}, ` +
    `so ${shots} go in ${sized.goes}: ${param === "p1_initial_shot_size" ? "the first at " : ""}${size}` +
    `${given ? `, ${given}` : ""}.`
  );
}
