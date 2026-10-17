import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, HistoryChart, Status, number, type Page } from "@/components/dashboard";
import { useDayData, WithLanes } from "@/components/day-timeline";
import { Findings, TrendTile, ZoneWeek } from "@/components/zone-week";
import { Pill } from "@/components/mini-visuals";
import { ageText } from "@/lib/controller-health";
import { zoneColor } from "@/lib/room-mode";
import type { Controller, Metric, Zone } from "@/lib/types";
import { weekDays, weekFindings, type Finding } from "@/lib/zone-week";
import "./insights.css";

/** Whether a zone's probe gives the controller a current reading, and how old its last one is. */
function Probe({ metric, controller }: { metric: Metric; controller: Controller }) {
  const entity = metric.entityId ? controller.states[metric.entityId] : undefined;
  const at = entity?.last_updated ? Date.parse(entity.last_updated) : NaN;
  return (
    <>
      <Pill dot tone={metric.value !== null ? "on" : "off"}>
        {metric.value !== null ? "Current" : "Unavailable / unverified"}
      </Pill>
      {Number.isFinite(at) && (
        <small className="muted"> Reading {ageText(Date.now() - at)} old</small>
      )}
    </>
  );
}

/** Its readings now against what it aims at, said as findings beside the week's. */
function nowFindings(zone: Zone): Finding[] {
  const found: Finding[] = [];
  if (zone.vwc.value !== null && zone.target.value !== null) {
    const off = zone.vwc.value - zone.target.value;
    found.push({
      tone: "info",
      text: `Moisture now ${number(zone.vwc.value)}%, ${Math.abs(off) < 0.05 ? "on" : `${number(Math.abs(off))} points ${off < 0 ? "below" : "above"}`} its ${zone.target.label}, ${number(zone.target.value)}%.${
        zone.phase === "P2"
          ? " The controller may move this trigger for EC."
          : zone.phase === "P3"
            ? " The rescue level is a safety floor, not a routine target."
            : ""
      }`,
    });
  }
  if (zone.ec.value !== null && zone.ecTarget.value !== null) {
    const off = zone.ec.value - zone.ecTarget.value;
    found.push({
      tone: "info",
      text: `Substrate EC now ${number(zone.ec.value, 2)} mS/cm, ${Math.abs(off) < 0.005 ? "on" : `${number(Math.abs(off), 2)} ${off < 0 ? "under" : "over"}`} its ${zone.ecTarget.label}, ${number(zone.ecTarget.value, 2)}.`,
    });
  }
  return found;
}

/** Insights › Zone: one zone's week, what it shows, its history, and every zone's probes. */
export function Insights({
  controller,
  navigate,
}: {
  controller: Controller;
  navigate?: (page: Page, zoneId?: number) => void;
}) {
  const [zoneId, setZoneId] = useState<number | null>(controller.room.zones[0]?.id ?? null);
  useEffect(() => {
    setZoneId(controller.room.zones[0]?.id ?? null);
  }, [controller.roomId]);
  const data = useDayData(controller);
  const zone = controller.room.zones.find((item) => item.id === zoneId) || controller.room.zones[0];
  const index = zone ? controller.room.zones.indexOf(zone) : 0;
  const open = (page: Page) => {
    if (navigate) navigate(page, zone?.id);
    else window.location.hash = `/${page}`;
  };
  if (!zone)
    return (
      <section className="panel">
        <Empty
          title="Choose a configured room"
          detail="Diagnostics need a discovered zone and its controller entities."
          action={<Button onClick={() => open("setup")}>Open Rooms &amp; hardware</Button>}
        />
      </section>
    );
  return (
    <div className="insights-page">
      <div className="target-chips" role="group" aria-label="Zone">
        {controller.room.zones.map((item, i) => (
          <button
            key={item.id}
            type="button"
            className="target-chip"
            aria-pressed={item.id === zone.id}
            onClick={() => setZoneId(item.id)}
          >
            <i style={{ background: zoneColor(i) }} aria-hidden="true" />
            {item.name}
          </button>
        ))}
      </div>
      <WithLanes controller={controller} data={data}>
        {(lanes) => {
          const lane = lanes?.lanes.find((item) => item.zone.id === zone.id);
          const traces = data.earlier?.traces.get(zone.id) ?? [];
          const days =
            data.day && lane
              ? weekDays({ day: data.day, points: lane.points, shots: lane.shots }, traces)
              : weekDays(null, traces);
          const complete = days.filter((day) => !day.today);
          const drybacks = complete.map((day) => day.dryback);
          const known = drybacks.filter((value): value is number => value !== null);
          const shots = complete.map((day) => day.shots);
          const peaks = complete.filter((day) => day.peak);
          const last = peaks.at(-1),
            first = peaks[0];
          const later = last && first ? Math.round((last.peak!.hour - first.peak!.hour) * 60) : 0;
          const findings = [
            ...nowFindings(zone),
            ...weekFindings(days, lane?.drybackTarget ?? null),
            ...controller.room.alerts
              .filter((notice) => notice.zoneId === undefined || notice.zoneId === zone.id)
              .map((notice): Finding => ({
                tone: "warn",
                text: `${notice.title}: ${notice.detail}`,
              })),
          ];
          return (
            <>
              <Findings title={`What ${zone.name}’s readings show`} findings={findings} />
              <ZoneWeek
                days={days}
                peakTarget={lane?.peakTarget ?? null}
                triggerTarget={lane?.triggerTarget ?? null}
                color={zoneColor(index)}
                name={zone.name}
              />
              {complete.length > 0 && (
                <div className="trend-tiles">
                  <TrendTile
                    label="Overnight dryback"
                    value={
                      known.length
                        ? `${number(known.reduce((a, b) => a + b, 0) / known.length, 0)}%`
                        : "–"
                    }
                    note={`average${lane?.drybackTarget != null ? ` · target ${number(lane.drybackTarget, 0)}%` : ""}`}
                    series={drybacks}
                  />
                  <TrendTile
                    label="Peak reached"
                    value={
                      last
                        ? new Date(last.day.start + last.peak!.hour * 3_600_000).toLocaleTimeString(
                            [],
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )
                        : "–"
                    }
                    note={
                      peaks.length > 1
                        ? later === 0
                          ? "the same time as a week ago"
                          : `${Math.abs(later)} min ${later > 0 ? "later" : "sooner"} than a week ago`
                        : "the last full grow-day"
                    }
                    series={complete.map((day) => (day.peak ? day.peak.hour : null))}
                  />
                  <TrendTile
                    label="Shots a day"
                    value={number(shots.reduce((a, b) => a + b, 0) / shots.length, 0)}
                    note={
                      Math.min(...shots) === Math.max(...shots)
                        ? "the same each day"
                        : `average · ${Math.min(...shots)} to ${Math.max(...shots)}`
                    }
                    series={shots}
                  />
                </div>
              )}
            </>
          );
        }}
      </WithLanes>
      <HistoryChart controller={controller} zones={[zone]} />
      <section className="card probe-cover" aria-labelledby="probe-cover-title">
        <div className="card-head">
          <h2 id="probe-cover-title">Every zone’s probes, now</h2>
          <span>Whether each gives the controller a current reading</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Zone</th>
                <th>VWC</th>
                <th>EC</th>
                <th>Scheduling</th>
              </tr>
            </thead>
            <tbody>
              {controller.room.zones.map((item, i) => (
                <tr key={item.id}>
                  <td>
                    <span className="probe-zone">
                      <i style={{ background: zoneColor(i) }} aria-hidden="true" />
                      {item.name}
                    </span>
                  </td>
                  {(["vwc", "ec"] as const).map((kind) => (
                    <td key={kind}>
                      <Probe metric={item[kind]} controller={controller} />
                    </td>
                  ))}
                  <td>
                    <Status enabled={item.enabled} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
