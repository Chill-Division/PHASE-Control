import { DayTimeline } from "@/components/day-timeline";
import { TankStatus } from "@/components/tank-status";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Controller } from "@/lib/types";
import { leadingNotices } from "@/lib/model";
import { useDrybackTrends } from "@/lib/use-recent-moisture";
import { coreWaterValue, waterParameters } from "@/lib/water-delivery";
import { roomPlants } from "@/lib/water-view";
import { AllZonesSwitch, RoomPower, WateringPower } from "@/components/room-controls";
import { Empty, Heading, Metrics, ZoneDetails, ZoneTable, type Page } from "@/components/dashboard";

export function Overview({
  controller,
  navigate,
}: {
  controller: Controller;
  navigate: (page: Page, zoneId?: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [allNotices, setAllNotices] = useState(false);
  const room = controller.room;
  const notices = allNotices ? room.alerts : leadingNotices(room.alerts);
  const trends = useDrybackTrends(controller);
  // The limit the controller enforces: the configured value inside its safety bounds.
  const plants = roomPlants(controller);
  const limits = Object.fromEntries(
    room.zones.map((zone) => [
      zone.id,
      coreWaterValue("max_daily_volume", waterParameters(controller, zone.id).max_daily_volume)
        .value,
    ]),
  );
  return (
    <>
      <Heading
        title={controller.roomId ? `${room.room.name} overview` : "Overview"}
        action={
          <div className="heading-actions">
            <RoomPower controller={controller} />
            <WateringPower controller={controller} />
            <Button variant="outline" onClick={() => navigate("grow-plan")}>
              Irrigation strategy <ArrowUpRight size={16} />
            </Button>
          </div>
        }
      />
      {!!room.alerts.length && (
        <div className="attention-list">
          {notices.map((notice) => (
            <div className={`attention attention-${notice.severity}`} key={notice.id}>
              <TriangleAlert size={20} />
              <div>
                <strong>{notice.title}</strong>
                <p>{notice.detail}</p>
              </div>
              {notice.zoneId !== undefined && (
                <Button variant="ghost" onClick={() => setSelected(notice.zoneId!)}>
                  View zone <ArrowRight size={15} />
                </Button>
              )}
            </div>
          ))}
          {room.alerts.length > notices.length && (
            <Button variant="ghost" onClick={() => setAllNotices(true)}>
              Show {room.alerts.length - notices.length} more{" "}
              {room.alerts.length - notices.length === 1 ? "notice" : "notices"}
            </Button>
          )}
        </div>
      )}
      <Metrics
        metrics={room.metrics}
        zones={room.zones}
        waterLimits={limits}
        waterPlants={plants}
      />
      <DayTimeline controller={controller} />
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Zones</h2>
            <div className="zones-heading-actions">
              {room.zones.length > 0 && <AllZonesSwitch controller={controller} />}
            </div>
          </div>
          {room.zones.length ? (
            <ZoneTable
              controller={controller}
              zones={room.zones}
              trends={trends}
              limits={limits}
              plants={plants}
              onSelect={(zone) => setSelected(zone.id)}
              navigate={navigate}
            />
          ) : (
            <Empty
              title="No zones discovered"
              detail="Connect Home Assistant in Settings. Zones are discovered from the controller entities available to your account."
              action={
                <Button onClick={() => navigate("settings")}>Open connection settings</Button>
              }
            />
          )}
        </section>
        <TankStatus controller={controller} onConfigure={() => navigate("setup")} />
      </div>
      <ZoneDetails
        controller={controller}
        zone={room.zones.find((z) => z.id === selected) || null}
        close={() => setSelected(null)}
        navigate={navigate}
      />
    </>
  );
}
