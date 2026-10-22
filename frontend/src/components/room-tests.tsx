import { useEffect, useRef, useState } from "react";
import { Beaker, Droplets, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { number } from "@/components/dashboard";
import { canRefill, duration, levelPct, type FeedDocument } from "@/lib/feed";
import { fillRefusal, levelMm, readBatchStatus } from "@/lib/feed-status";
import { descriptor } from "@/lib/model";
import type { Controller } from "@/lib/types";
import { errorText } from "@/lib/utils";
import "./room-tests.css";

/** How long a zone's Test Shot waters it (controller.py TEST_SHOT_S). */
export const TEST_SHOT_S = 10;

export interface TestZone {
  id: number;
  name: string;
  plants: number;
  drippers: number;
  /** Each dripper's flow, L/h. */
  flowLph: number;
}

/** What a zone's test shot delivers, L: its drippers' flow for TEST_SHOT_S. null when unsized. */
export function testShotLitres(zone: TestZone): number | null {
  const litres = (TEST_SHOT_S * zone.plants * zone.drippers * zone.flowLph) / 3600;
  return Number.isFinite(litres) && litres > 0 ? litres : null;
}

const clock = (iso: string | null | undefined) => {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at)
    ? ` at ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "";
};

/** Settings → Rooms & hardware → Tests: check that the room's hardware works. Each test asks the
 * controller app, as a button in Home Assistant does: a zone's Test Shot (test_shot), and a refill of
 * the reservoir (feed_mix). The controller refuses a refill asked for by hand that could overflow
 * the reservoir; a person who has checked that the fill fits may run it anyway. */
export function RoomTests({
  controller,
  zones,
  shared = false,
  why,
}: {
  controller: Controller;
  /** The room's active zones, as saved. */
  zones: TestZone[];
  /** One valve waters every zone (as saved): a test shot waters them all, asked for on the first. */
  shared?: boolean;
  /** Why no test can run now, or null. */
  why: string | null;
}) {
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? 0);
  const [ask, setAsk] = useState<"shot" | "refill" | null>(null);
  const [doc, setDoc] = useState<FeedDocument | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const zone = (shared ? undefined : zones.find((z) => z.id === zoneId)) ?? zones[0];
  // One valve for every zone: the shot waters them all, each its own drippers' worth.
  const watered = shared ? zones : zone ? [zone] : [];
  const each = watered.map(testShotLitres);
  const litres =
    each.length && each.every((l) => l !== null) ? each.reduce((a, b) => a! + b!, 0) : null;
  const plants = watered.reduce((sum, z) => sum + z.plants, 0);
  const named = shared ? "every zone" : zone?.name;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // Feed → Reservoir's "Refill by hand" opens this page at its tests.
    if (/\?tests$/.test(window.location.hash)) ref.current?.scrollIntoView({ block: "start" });
  }, []);

  const room = controller.room.room;
  const attributes = descriptor(controller.states, room)?.attributes ?? {};
  // Only a room with what a refill needs is offered one.
  const refillable = canRefill(attributes);
  const status = readBatchStatus(controller.states, room.prefix);
  const running = !!status?.step && status.step !== "idle";
  const refillWhy = running
    ? "A refill is running: Feed → Reservoir shows its steps."
    : status?.blocked
      ? `A refill cannot start now: ${status.blocked}.`
      : null;
  // What the controller checks before a refill asked for by hand (controller.py _fill_overflow).
  const sensor = attributes.reservoir_distance_sensor;
  // The controller's reading once it reports, as on the Reservoir page.
  const level = status
    ? status.levelMm
    : typeof sensor === "string" && sensor
      ? levelMm(controller.states[sensor])
      : null;
  const plan = doc?.plan;
  // An integration from before the reservoir's distances sends none.
  const levelSetUp =
    typeof sensor === "string" &&
    !!sensor &&
    !!plan &&
    (plan.full_mm ?? 0) > 0 &&
    plan.full_mm < plan.empty_mm;
  const pct = !plan
    ? null
    : status
      ? status.levelPct
      : levelPct(level, plan.full_mm ?? 0, plan.empty_mm);
  const refusal = plan
    ? fillRefusal(pct, levelSetUp, plan.batch_l, plan.min_pct ?? 0, status?.litresPerPct ?? null)
    : null;
  // Only whether the fill fits is a person's to judge: a level that reads nothing stops a refill
  // half-way (it cannot show that the reservoir fills), so that one is never run anyway.
  const forceable = !!refusal && pct !== null;

  function close() {
    if (busy) return;
    setAsk(null);
    setError("");
  }
  async function openRefill() {
    setNotice("");
    setError("");
    setAnyway(false);
    setDoc(null);
    setAsk("refill");
    try {
      setDoc(await controller.operator<FeedDocument>("feed_get"));
    } catch (err) {
      setError(errorText(err));
    }
  }
  async function run() {
    setBusy(true);
    setError("");
    try {
      if (ask === "shot" && zone) {
        const result = await controller.operator<{ requested?: string | null }>("test_shot", {
          zone: zone.id,
        });
        setNotice(
          `Test shot for ${named} asked for${clock(result.requested)}. The controller app runs it at its next pass, within a minute; Insights → Activity says how it went.`,
        );
      } else if (ask === "refill") {
        const force = forceable && anyway;
        const result = await controller.operator<FeedDocument>("feed_mix", force ? { force } : {});
        setNotice(
          `Test refill asked for${clock(result.requested)}${force ? ", to run anyway" : ""}. The controller app starts it at its next pass, within a minute, or says why it cannot; Feed → Reservoir shows its steps.`,
        );
      }
      setAsk(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel workspace-card" data-room-tests ref={ref}>
      <div className="workspace-section-heading">
        <div>
          <h2>Tests</h2>
          <p className="muted">
            Check that the hardware works. The controller app runs each test at its next pass,
            through the same safety checks as everything it does, and Insights → Activity says how
            it went.
          </p>
        </div>
      </div>
      {why && <p className="workspace-message">{why}</p>}
      {notice && (
        <p className="workspace-message" role="status">
          {notice}
        </p>
      )}
      <div className="room-tests">
        <div className="room-test">
          <h3>Test shot</h3>
          <p className="muted small">
            {shared
              ? `Waters every zone for ${TEST_SHOT_S} seconds: the pump, then the valve for every zone, in the order a shot opens them.`
              : `Waters one zone for ${TEST_SHOT_S} seconds: the pump, the mainline and the zone's valve, in the order a shot opens them.`}
          </p>
          <div className="room-test-controls">
            {!shared && (
              <div>
                <Label htmlFor="room-test-zone">Zone</Label>
                <select
                  id="room-test-zone"
                  value={zone?.id ?? ""}
                  disabled={!!why || busy || !zones.length}
                  onChange={(event) => setZoneId(Number(event.target.value))}
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Button
              disabled={!!why || busy || !zone}
              onClick={() => {
                setNotice("");
                setError("");
                setAsk("shot");
              }}
            >
              <Droplets size={16} /> Run a test shot
            </Button>
          </div>
        </div>
        {refillable && (
          <div className="room-test">
            <h3>Test refill</h3>
            <p className="muted small">
              Refills and mixes the reservoir now, as an automatic refill does: fresh water, then
              the pump and recirculation, then each doser in turn. Every room's watering waits while
              it runs.
            </p>
            <div className="room-test-controls">
              <Button disabled={!!why || busy || !!refillWhy} onClick={() => void openRefill()}>
                <Beaker size={16} /> Run a test refill
              </Button>
              {!why && refillWhy && <small className="muted">{refillWhy}</small>}
            </div>
          </div>
        )}
      </div>
      {ask === "shot" && zone && (
        <Dialog open onOpenChange={(open) => !open && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Water {named} for {TEST_SHOT_S} seconds now?
              </DialogTitle>
              <DialogDescription>
                The controller app runs it at its next pass, within a minute. It is held, and
                Insights → Activity says why, while watering is switched off, the zone is off, a
                refill is running or the zone's daily water limit is spent.
              </DialogDescription>
            </DialogHeader>
            <p>
              {litres === null
                ? "This zone's plants, drippers and dripper flow are not all set, so the controller cannot size it."
                : `About ${number(litres, 2)} L across ${plants} plants, ${number((litres * 1000) / plants, 0)} mL each.`}{" "}
              Its water counts toward the zone's day, but it is not one of the day's shots, and Auto
              setpoints learns nothing from it.
            </p>
            {error && (
              <p className="workspace-message error" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void run()}>
                {busy && <LoaderCircle className="spin" size={16} />} Run the test shot
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {ask === "refill" && (
        <Dialog open onOpenChange={(open) => !open && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {plan ? `Refill and mix a ${plan.stage ?? ""} batch now?` : "Test refill"}
              </DialogTitle>
              <DialogDescription>
                {plan
                  ? `The fresh water runs for ${duration(plan.fill_s)}, with the pump and recirculation from half-way; then the dosers run one after another, and it recirculates for ${duration(plan.mix_s)}. Watering in every room waits until it finishes.`
                  : "Reading the room's feed recipe…"}
              </DialogDescription>
            </DialogHeader>
            {plan && (
              <>
                {!!plan.doses.length && (
                  <table className="data-table res-plan" aria-label="This batch's doses">
                    <tbody>
                      {plan.doses.map((dose) => (
                        <tr key={dose.doser}>
                          <td>
                            {dose.label} <span className="muted small">doser {dose.doser}</span>
                          </td>
                          <td className="numeric">
                            {number(dose.ml, 0)}
                            <span className="unit"> mL</span>
                          </td>
                          <td className="numeric">{duration(dose.seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {plan.problem && (
                  <p className="workspace-message error" role="alert">
                    {plan.problem} The controller app will not start it.
                  </p>
                )}
                {!plan.problem && refusal && !forceable && (
                  <p className="workspace-message error" role="alert">
                    {refusal} The controller app will not start it until the level reads again.
                  </p>
                )}
                {!plan.problem && forceable && (
                  <div className="workspace-message room-test-refusal">
                    <p>{refusal} The controller app will not start it on its own.</p>
                    <label>
                      <input
                        type="checkbox"
                        checked={anyway}
                        disabled={busy}
                        onChange={(event) => setAnyway(event.target.checked)}
                      />
                      Run anyway: I have checked that the reservoir has room for{" "}
                      {number(plan.batch_l, 1)}&nbsp;L.
                    </label>
                  </div>
                )}
                {!plan.problem && !levelSetUp && (
                  <p className="workspace-message">
                    {sensor
                      ? "The reservoir's distances when full and when empty are not set"
                      : "No level sensor is mapped"}
                    , so nothing checks the level first: make sure the fill fits, or it may overflow
                    the reservoir.
                  </p>
                )}
              </>
            )}
            {error && (
              <p className="workspace-message error" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button
                disabled={busy || !plan || !!plan.problem || (!!refusal && !(forceable && anyway))}
                onClick={() => void run()}
              >
                {busy && <LoaderCircle className="spin" size={16} />}{" "}
                {forceable && anyway ? "Refill and mix anyway" : "Refill and mix"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
