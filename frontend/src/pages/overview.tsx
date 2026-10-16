import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DayChart, useDayData, WithLanes } from "@/components/day-timeline";
import { ReservoirSummary } from "@/components/tank-status";
import { AllZonesSwitch } from "@/components/room-controls";
import { Empty, ZoneDetails, type Page } from "@/components/dashboard";
import {
  ComingUp,
  comingUp,
  useMedia,
  EarlierToday,
  ModeControl,
  NeedsYou,
  StatusRow,
  TargetsSource,
  TodayCard,
  ZoneCard,
} from "@/components/overview-parts";
import type { Controller, Notice } from "@/lib/types";
import { leadingNotices, roomStatus } from "@/lib/model";
import { useDrybackTrends } from "@/lib/use-recent-moisture";
import { coreWaterValue, waterParameters } from "@/lib/water-delivery";
import { roomPlants } from "@/lib/water-view";
import { time as clock } from "@/components/dashboard";
import "./overview.css";

const RANK = { critical: 0, warning: 1, info: 2 } as const;

export function Overview({
  controller,
  navigate,
  utilities,
}: {
  controller: Controller;
  navigate: (page: Page, zoneId?: number) => void;
  utilities: ReactNode;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [allNotices, setAllNotices] = useState(false);
  const phone = useMedia("(max-width: 767px)");
  const room = controller.room;
  const notices = allNotices ? room.alerts : leadingNotices(room.alerts);
  const trends = useDrybackTrends(controller);
  const data = useDayData(controller);
  // The limit the controller enforces: the configured value inside its safety bounds.
  const plants = roomPlants(controller);
  const limits = Object.fromEntries(
    room.zones.map((zone) => [
      zone.id,
      coreWaterValue("max_daily_volume", waterParameters(controller, zone.id).max_daily_volume)
        .value,
    ]),
  );
  const plantCount = Object.values(plants).reduce<number>((sum, count) => sum + (count ?? 0), 0);
  const { day, now } = data;
  const status = roomStatus(controller.states, room.room);
  const zone = room.zones.find((item) => item.id === selected) ?? null;
  // Each zone's most urgent notice, for its card.
  const noticeOf = (id: number): Notice | undefined =>
    room.alerts
      .filter((notice) => notice.zoneId === id)
      .sort((a, b) => RANK[a.severity] - RANK[b.severity])[0];
  const on = room.zones.filter((item) => item.enabled === true && item.override !== true).length;
  return (
    <div className="overview" data-overview>
      <header className="room-header">
        <div className="room-header-text">
          <h1>{controller.roomId ? room.room.name : "Overview"}</h1>
          <p>
            <span>
              {room.zones.length} {room.zones.length === 1 ? "zone" : "zones"}
              {plantCount > 0 ? `, ${plantCount} plants` : ""}
              {day ? ` · lights ${clock(day.start)} to ${clock(day.lightsOff)}` : ""}
            </span>
            <TargetsSource controller={controller} navigate={navigate} />
          </p>
        </div>
        <div className="room-header-actions">
          {utilities}
          <ModeControl controller={controller} />
        </div>
      </header>
      <StatusRow controller={controller} plants={plants} navigate={navigate} />
      <NeedsYou
        alerts={room.alerts}
        shown={notices}
        more={() => setAllNotices(true)}
        openZone={setSelected}
      />
      <WithLanes controller={controller} data={data}>
        {(lanes) => {
          const loading = !!day && !lanes && !data.error;
          return (
            <>
              <div className="overview-day">
                <TodayCard
                  controller={controller}
                  day={day}
                  lanes={lanes?.lanes ?? null}
                  now={now}
                  held={status.tone === "stopped" ? status.text : null}
                />
                <ComingUp
                  items={lanes && day ? comingUp(lanes.lanes, day, now) : []}
                  day={day}
                  now={now}
                  limit={phone ? 3 : 6}
                  loading={loading}
                />
              </div>
              <section className="zones-section" aria-labelledby="zones-title">
                <div className="zones-head">
                  <h2 id="zones-title">Zones</h2>
                  <span className="zones-note">
                    {room.zones.length
                      ? `each with its own day and its band from trigger to peak · ${on} of ${room.zones.length} watering`
                      : ""}
                  </span>
                  {room.zones.length > 0 && <AllZonesSwitch controller={controller} />}
                </div>
                {room.zones.length ? (
                  <div className="zone-cards">
                    {room.zones.map((item, index) => (
                      <ZoneCard
                        key={item.id}
                        controller={controller}
                        zone={item}
                        index={index}
                        lane={lanes?.lanes.find((lane) => lane.zone.id === item.id)}
                        day={day}
                        now={now}
                        limit={limits[item.id] ?? null}
                        plants={plants[item.id] ?? null}
                        trend={trends?.[item.id]}
                        notice={noticeOf(item.id)}
                        open={() => setSelected(item.id)}
                        navigate={navigate}
                      />
                    ))}
                  </div>
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
              <div className="overview-foot">
                <ReservoirSummary
                  controller={controller}
                  open={() => navigate("reservoir")}
                  configure={() => navigate("setup")}
                />
                <EarlierToday events={lanes?.events ?? []} loading={loading} />
              </div>
            </>
          );
        }}
      </WithLanes>
      <ZoneDetails
        controller={controller}
        zone={zone}
        close={() => setSelected(null)}
        navigate={navigate}
        chart={
          zone && (
            <DayChart
              controller={controller}
              data={data}
              zoneId={zone.id}
              title={`${zone.name} today`}
            />
          )
        }
      />
    </div>
  );
}
