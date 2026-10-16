import { useState } from "react";
import { Droplets, Layers, Power, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReviewDialog, Status } from "@/components/dashboard";
import { allZones, allZonesChanges } from "@/lib/all-zones";
import {
  autoFrozenReason,
  autoHoldText,
  autoStateLabel,
  autoStatusText,
  type AutoSetpointStatus,
} from "@/lib/auto-setpoints";
import type { Controller } from "@/lib/types";
import "./room-controls.css";

const writable = (controller: Controller, entityId: string | null) =>
  !!entityId &&
  ["on", "off"].includes(controller.states[entityId]?.state ?? "") &&
  ["live", "demo"].includes(controller.connection);

/** Room On/Off. Hidden when the controller has no room switch (the room is then on).
 * Writes go through the shared review dialog: turn_on/turn_off, then readback. */
export function RoomPower({
  controller,
  showStatus = true,
}: {
  controller: Controller;
  showStatus?: boolean;
}) {
  const [review, setReview] = useState(false);
  const { room } = controller;
  if (!room.roomActiveEntity) return null;
  const on = room.roomActive;
  const name = room.room.name;
  return (
    <>
      <div className="room-power" role="group" aria-label={`${name} on or off`}>
        {showStatus && <Status enabled={on ? true : null} label={on ? "Room on" : "Room off"} />}
        <Button
          variant="outline"
          size="sm"
          disabled={!writable(controller, room.roomActiveEntity)}
          onClick={() => setReview(true)}
        >
          <Power size={15} />
          {on ? "Switch room off…" : "Switch room on…"}
        </Button>
      </div>
      <ReviewDialog
        open={review}
        onOpenChange={setReview}
        controller={controller}
        title={on ? `Switch ${name} off?` : `Switch ${name} on?`}
        items={[
          {
            change: { entityId: room.roomActiveEntity, value: !on },
            label: `${name} room status`,
            before: on ? "On" : "Off",
            after: on ? "Off" : "On",
          },
        ]}
        note={
          on
            ? `Nothing growing in ${name}? Irrigation and alerts stop until you switch it back on.`
            : "Back on within a day, it carries on where it was. After longer, it starts a fresh run: daily counters and learned phase state reset."
        }
      />
    </>
  );
}

/** The room's watering switch, its engine switch. Off, the controller opens no valve in the room
 * but keeps reading the probes and following the phases. Hidden without an engine switch. */
export function WateringPower({ controller }: { controller: Controller }) {
  const [review, setReview] = useState(false);
  const { engine, room } = controller.room;
  if (!engine.entityId) return null;
  const on = engine.enabled;
  return (
    <>
      <div className="room-power" role="group" aria-label={`${room.name} watering`}>
        <Status
          enabled={on}
          label={on === true ? "Watering on" : on === false ? "Watering off" : undefined}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!writable(controller, engine.entityId)}
          onClick={() => setReview(true)}
        >
          <Droplets size={15} />
          {on ? "Switch watering off…" : "Switch watering on…"}
        </Button>
      </div>
      <ReviewDialog
        open={review}
        onOpenChange={setReview}
        controller={controller}
        title="Review watering"
        items={[
          {
            change: { entityId: engine.entityId, value: !on },
            label: `${room.name} watering`,
            before: on ? "On" : "Off",
            after: on ? "Off" : "On",
          },
        ]}
        note={
          on
            ? "Off, the controller opens no valve in this room and stops a running shot within a few seconds; it keeps reading the probes and following the phases. It is not an emergency stop: use the installation's physical shut-off for that."
            : "On, the controller waters this room by its targets again."
        }
      />
    </>
  );
}

/** Every zone of the room at once, in the zones' heading, as Home Assistant's entities card has
 * its header toggle: on while any zone is on. Switching it reviews switching every zone the same
 * way, a zone paused on purpose included; each zone keeps its own switch in its details. */
export function AllZonesSwitch({ controller }: { controller: Controller }) {
  const { zones } = controller.room;
  const state = allZones(zones);
  const enable = state.checked === false;
  const items = allZonesChanges(zones, enable);
  const connected = ["live", "demo"].includes(controller.connection);
  // The review keeps what it was opened with: its own writes move the zones under it.
  const [review, setReview] = useState(false);
  const [opened, setOpened] = useState({ enable, items });
  return (
    <span className="all-zones" data-all-zones={state.checked ?? "unknown"}>
      <span className="all-zones-count">
        {state.checked === null ? "Zones unavailable" : `${state.on} of ${state.known} zones on`}
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={state.checked === true}
        aria-label={`Every zone in ${controller.room.room.name}`}
        disabled={!connected || !items.length}
        onClick={() => {
          setOpened({ enable, items });
          setReview(true);
        }}
      >
        <span className="switch-thumb" aria-hidden="true" />
      </button>
      <ReviewDialog
        open={review}
        onOpenChange={setReview}
        controller={controller}
        title={opened.enable ? "Switch every zone on" : "Pause every zone"}
        items={opened.items}
        note={
          opened.enable
            ? "Every zone is switched on, including any you had paused. The controller waters them from its next check."
            : "Paused, a zone gets no water, not even a rescue shot. Switch them back on here, or one at a time from each zone."
        }
      />
    </span>
  );
}

/** Calm, page-independent reminder that the selected room is off, with its switch unless the
 * page has one of its own (the Overview's heading). */
export function RoomOffBanner({
  controller,
  switchable = true,
}: {
  controller: Controller;
  switchable?: boolean;
}) {
  if (!controller.roomId || controller.room.roomActive) return null;
  return (
    <div className="room-off-banner" role="status">
      <Power size={18} aria-hidden="true" />
      <div>
        <strong>Room off – no irrigation, no alerts</strong>
        <p>
          Nothing is growing in {controller.room.room.name}. Readings are still shown, but the
          engine will not water this room or raise alerts for it.
        </p>
      </div>
      {switchable && <RoomPower controller={controller} showStatus={false} />}
    </div>
  );
}

/** Room-level Auto setpoints On/Off. Hidden when the controller has no such switch. */
export function AutoSetpointsControl({ controller }: { controller: Controller }) {
  const [review, setReview] = useState(false);
  const { entityId, enabled } = controller.room.autoSetpoints;
  if (!entityId) return null;
  const name = controller.room.room.name;
  return (
    <>
      <div className="room-power" role="group" aria-label={`${name} auto setpoints`}>
        <Status
          enabled={enabled === true ? true : null}
          label={
            enabled === true
              ? "Auto setpoints on"
              : enabled === false
                ? "Auto setpoints off"
                : "Auto setpoints unavailable"
          }
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!writable(controller, entityId)}
          onClick={() => setReview(true)}
        >
          <Sparkles size={15} />
          {enabled ? "Turn auto off…" : "Turn auto on…"}
        </Button>
      </div>
      <ReviewDialog
        open={review}
        onOpenChange={setReview}
        controller={controller}
        title={enabled ? "Turn auto setpoints off?" : "Turn auto setpoints on?"}
        items={[
          {
            change: { entityId, value: !enabled },
            label: `${name} auto setpoints`,
            before: enabled ? "On" : "Off",
            after: enabled ? "Off" : "On",
          },
        ]}
        note={
          enabled
            ? "The engine still fires every shot. Managed setpoints will no longer be rewritten automatically; they keep their current values until you change them."
            : "The engine still fires every shot. Managed setpoints will be rewritten automatically from what the probes do, so manual edits to those fields will be overwritten."
        }
      />
    </>
  );
}

/** Room-level EC stacking On/Off: in P2 the controller moves each zone's maintenance trigger to
 * steer its settled substrate EC toward the zone's P2 EC target. Hidden without the switch. */
export function EcStackingControl({ controller }: { controller: Controller }) {
  const [review, setReview] = useState(false);
  const { entityId, enabled } = controller.room.ecStacking;
  if (!entityId) return null;
  const name = controller.room.room.name;
  return (
    <>
      <div className="room-power" role="group" aria-label={`${name} EC stacking`}>
        <Status
          enabled={enabled === true ? true : null}
          label={
            enabled === true
              ? "EC stacking on"
              : enabled === false
                ? "EC stacking off"
                : "EC stacking unavailable"
          }
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!writable(controller, entityId)}
          onClick={() => setReview(true)}
        >
          <Layers size={15} />
          {enabled ? "Turn EC stacking off…" : "Turn EC stacking on…"}
        </Button>
      </div>
      <ReviewDialog
        open={review}
        onOpenChange={setReview}
        controller={controller}
        title={enabled ? "Turn EC stacking off?" : "Turn EC stacking on?"}
        items={[
          {
            change: { entityId, value: !enabled },
            label: `${name} EC stacking`,
            before: enabled ? "On" : "Off",
            after: enabled ? "Off" : "On",
          },
        ]}
        note={
          enabled
            ? "No new moves. A move already made today stays until lights-on, when each zone's maintenance trigger is back where it is set."
            : "In P2 the controller moves each zone's maintenance trigger by up to a point, at most every 30 minutes, to steer its settled substrate EC toward its P2 EC target: down while EC is under 90% of it, so less water lets EC build, and up while it is over 110%, so more water dilutes it. Never by more than a fifth of the trigger, and each grow-day starts from the trigger as set."
        }
      />
    </>
  );
}

const STATE_CLASS: Record<AutoSetpointStatus["state"], string> = {
  tracking: "status-good",
  learning: "status-good",
  frozen: "status-paused",
  off: "status-neutral",
  unavailable: "status-neutral",
};
/** Per-zone supervisor status: state (and why it is frozen), learned peak, last change. */
export function AutoZoneChip({ status, name }: { status: AutoSetpointStatus; name?: string }) {
  const hold = autoHoldText(status),
    reason = autoFrozenReason(status);
  return (
    <div className="auto-chip" data-auto-state={status.state} title={autoStatusText(status)}>
      <Badge variant="outline" className={STATE_CLASS[status.state]}>
        <span className="status-dot" />
        {name ? `${name} · ` : ""}Auto · {autoStateLabel(status.state)}
      </Badge>
      {reason && (
        <span>
          Frozen because <b>{reason}</b>
        </span>
      )}
      <span>
        Learned peak{" "}
        <b>{status.learnedPeak === null ? "not yet known" : `${status.learnedPeak.toFixed(1)}%`}</b>
        {hold ? ` (${hold})` : ""}
      </span>
      <span>
        Last change <b>{status.lastChange ?? "none yet"}</b>
      </span>
      {status.state === "tracking" && status.drybackNote && (
        <span>
          Tonight <b>{status.drybackNote}</b>
        </span>
      )}
    </div>
  );
}
export function AutoBadge() {
  return (
    <Badge variant="outline" className="auto-badge" title="Managed by auto setpoints">
      <Sparkles aria-hidden="true" />
      Auto
    </Badge>
  );
}
