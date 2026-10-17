import { useState } from "react";
import { WaterDelivery } from "@/components/water-delivery";
import { zoneColor } from "@/lib/room-mode";
import { WaterUsePanel } from "@/components/water-use";
import type { Controller } from "@/lib/types";
import "./insights.css";

/** Insights › Water: what each zone has been given, and what a shot of a given length delivers. */
export function Water({ controller }: { controller: Controller }) {
  const zones = controller.room.zones;
  const [zoneId, setZoneId] = useState<number | null>(zones[0]?.id ?? null);
  const zone = zones.find((item) => item.id === zoneId) ?? zones[0];
  return (
    <div className="insights-page">
      <WaterUsePanel controller={controller} zones={zones} />
      {zone && (
        <>
          <div className="water-calculator-head">
            <h2>Shot calculator</h2>
            <div className="target-chips" role="group" aria-label="Shot calculator for">
              {zones.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className="target-chip"
                  aria-pressed={item.id === zone.id}
                  onClick={() => setZoneId(item.id)}
                >
                  <i style={{ background: zoneColor(index) }} aria-hidden="true" />
                  {item.name}
                </button>
              ))}
            </div>
          </div>
          <WaterDelivery controller={controller} zoneId={zone.id} />
        </>
      )}
    </div>
  );
}
