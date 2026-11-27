import { useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingHelp } from "@/components/setting-help";
import { lastResetText, relearnedAt, type AutoSetpointStatus } from "@/lib/auto-setpoints";
import type { SettingDetail } from "@/lib/setting-words";
import type { Controller } from "@/lib/types";
import { errorText } from "@/lib/utils";
import "./relearn-peak.css";

/** What Relearn peak does, for its "?" beside the button. */
export const RELEARN_HELP: SettingDetail = {
  what: "Forgets the peak Auto setpoints learned for this zone: how wet its substrate gets before more water just runs off. It waters nothing.",
  when: "After the plants or the probe change: a defoliation, a transplant, a probe moved or reseated. Also when the zone's morning ramp keeps running out of shots well under its learned peak, and Auto setpoints has paused because of it.",
  affects:
    "The zone's next ramp stops where the substrate stops taking water, and that is its peak from then on. Pressed during a ramp, the ramp ends at its next shots that don't lift the moisture. What else Auto setpoints learned stays: how much a shot lifts the zone and how fast it dries.",
  auto: "The zone’s Peak target, Full saturation and Maintenance trigger follow the peak it learns next, from that morning’s ramp. With Auto setpoints off for the room it still forgets the peak, and the next one is ready for when you turn Auto setpoints on.",
};

const clock = (iso: string | null | undefined) => {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at)
    ? ` at ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "";
};

/** A zone's Relearn peak: asks the controller app (the relearn_peak service, which presses the
 * zone's Relearn Peak button) to forget the peak Auto setpoints learned for the zone. A confirm first,
 * with the peak it forgets; then the answer, when the controller acts. */
export function RelearnPeak({
  controller,
  zoneId,
  zoneName,
  status,
}: {
  controller: Controller;
  zoneId: number;
  zoneName: string;
  status: AutoSetpointStatus;
}) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const peak = status.learnedPeak;

  function close() {
    if (busy) return;
    setAsk(false);
    setError("");
  }
  async function run() {
    setBusy(true);
    setError("");
    try {
      const result = await controller.operator<{ requested?: string | null }>("relearn_peak", {
        zone: zoneId,
      });
      setNotice(
        `Asked for${clock(result.requested)}. The controller app forgets the peak at its next pass, within a minute.`,
      );
      setAsk(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // A fragment: in the zone's Auto setpoints line the button sits beside the learned peak, with
  // when it was last pressed after it, and the answer takes a line of its own under it.
  return (
    <>
      <span className="relearn-peak">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setNotice("");
            setError("");
            setAsk(true);
          }}
        >
          <RotateCcw size={14} aria-hidden="true" />
          Relearn peak…
        </Button>
        <SettingHelp label="Relearn peak" param="relearn_peak" detail={RELEARN_HELP} />
      </span>
      <span data-relearn-last>
        Last reset{" "}
        <b>
          {lastResetText(
            relearnedAt(controller.states, controller.room.room.prefix, zoneId),
            Date.now(),
          )}
        </b>
      </span>
      {notice && (
        <span className="relearn-peak-notice" role="status">
          {notice}
        </span>
      )}
      {ask && (
        <Dialog open onOpenChange={(open) => !open && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Relearn {zoneName}’s peak?</DialogTitle>
              <DialogDescription>
                {peak === null
                  ? `Auto setpoints hasn’t learned a peak for ${zoneName} yet, so there is nothing to forget: its next ramp finds one as it would anyway.`
                  : `Auto setpoints forgets the ${peak.toFixed(1)}% it learned for ${zoneName}. The zone’s next ramp stops where its substrate stops taking water, and that becomes its peak.`}
              </DialogDescription>
            </DialogHeader>
            <p>
              Use it after defoliating, transplanting or moving the probe. Nothing is watered, and
              the rest of what it learned stays: how much a shot lifts the zone and how fast it
              dries.
              {status.p1Outcome === "suspect" && " Its pause on automatic targets ends with it."}
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
                {busy && <LoaderCircle className="spin" size={16} />} Relearn the peak
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
