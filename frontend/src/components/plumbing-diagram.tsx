import { ArrowRight, CircleCheck, CircleDashed, Droplets, Gauge, GitFork } from "lucide-react";
import { number } from "@/components/dashboard";
import { zoneColor } from "@/lib/room-mode";
import type { SetupRoom } from "@/lib/operator-types";
import { plumbingUses } from "@/lib/plumbing";
import "./plumbing-diagram.css";

/** Jump to a mapping on the page by its label, as its button names it ("Map Room pump"). */
function focusMapping(label: string) {
  const button = document.querySelector<HTMLButtonElement>(
    `[aria-label="Map ${CSS.escape(label)}"]`,
  );
  button?.scrollIntoView({ behavior: "smooth", block: "center" });
  button?.focus({ preventScroll: true });
}

/** How water reaches each zone, as the room is set up in the draft: the pump and the main line its
 * plumbing has, then each zone's valve with its probes and sizing. A part not mapped yet says so;
 * each opens its mapping below. */
export function PlumbingDiagram({ draft, plumbing }: { draft: SetupRoom; plumbing: string }) {
  const chain = (
    [
      ["pump_switch", "Room pump", "Pump", "Runs first, whenever a zone waters", Gauge],
      ["main_line_switch", "Mainline valve", "Main line", "Opens before a zone valve", GitFork],
    ] as const
  ).filter(([key]) => plumbingUses(plumbing, key));
  const zones = draft.zones.filter((zone) => zone.active);
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return (
    <div className="plumbing-diagram" role="group" aria-label="How water reaches each zone">
      {chain.map(([key, label, name, note, Icon]) => {
        const entity = text(draft.hardware[key]);
        return (
          <div className="plumbing-step" key={key}>
            <button
              type="button"
              className="plumbing-part"
              data-mapped={!!entity}
              onClick={() => focusMapping(label)}
            >
              <span className="plumbing-part-head">
                <span className="plumbing-icon" aria-hidden="true">
                  <Icon size={17} />
                </span>
                <strong>{name}</strong>
                {entity ? (
                  <CircleCheck size={18} className="plumbing-ok" aria-label="Mapped" />
                ) : (
                  <CircleDashed size={18} className="plumbing-missing" aria-label="Not mapped" />
                )}
              </span>
              <code>{entity ?? "Not mapped"}</code>
              <small>{note}</small>
            </button>
            <ArrowRight size={22} className="plumbing-arrow" aria-hidden="true" />
          </div>
        );
      })}
      <div className="plumbing-zones">
        {zones.map((zone) => {
          const index = zones.indexOf(zone);
          const sizing = [
            zone.plant_count
              ? `${zone.plant_count} ${zone.plant_count === 1 ? "plant" : "plants"}`
              : null,
            zone.substrate_volume ? `${number(zone.substrate_volume)} L each` : null,
            zone.drippers_per_plant && zone.dripper_flow_rate
              ? `${zone.drippers_per_plant} ${zone.drippers_per_plant === 1 ? "dripper" : "drippers"} at ${number(zone.dripper_flow_rate)} L/h`
              : null,
          ].filter(Boolean);
          return (
            <button
              type="button"
              key={zone.id}
              className="plumbing-zone"
              data-mapped={!!zone.valve}
              onClick={() => focusMapping(`${zone.name} valve`)}
            >
              <i style={{ background: zoneColor(index) }} aria-hidden="true" />
              <span className="plumbing-zone-text">
                <strong>{zone.name || `Zone ${zone.id}`}</strong>
                <code>{zone.valve || "Valve not mapped"}</code>
              </span>
              <span className="plumbing-zone-side">
                <span>
                  <Droplets size={13} aria-hidden="true" /> {zone.vwc_sensors.length} moisture ·{" "}
                  {zone.ec_sensors.length} EC
                </span>
                {sizing.length > 0 && <small>{sizing.join(" · ")}</small>}
              </span>
            </button>
          );
        })}
        {!zones.length && <p className="muted">No zones yet: add one below.</p>}
      </div>
    </div>
  );
}
