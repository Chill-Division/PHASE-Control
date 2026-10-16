import { useId } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/mini-visuals";
import type { Controller } from "@/lib/types";
import { tankTelemetry, type TankReading } from "@/lib/tank-telemetry";
import { TankLevelChart } from "./tank-level-chart";
import "./tank-status.css";

export function TankStatus({
  controller,
  onConfigure,
}: {
  controller: Controller;
  onConfigure: () => void;
}) {
  const tank = tankTelemetry(controller.states, controller.room.room);
  const refill = tank.refill;
  const clipId = useId();
  const connected = ["live", "demo"].includes(controller.connection);
  const value = (r: TankReading, digits = 1) =>
    r.value === null
      ? r.issue
      : `${r.value.toLocaleString(undefined, { maximumFractionDigits: digits })} ${r.unit}`;
  const pump = tank.pump.on === null ? tank.pump.issue : tank.pump.on ? "On" : "Off";
  const lastKnown = connected ? "" : " · last known";
  const level = tank.level.value;
  // Nothing refills it by itself, and it is down to the level a reminder comes at (CS-706).
  const remind = tank.source?.remindPct ?? null;
  const soon = remind !== null && level !== null && level <= remind;
  // The drawing's inside runs from y=119 (empty) to y=1 (full): 1.18 units per percent.
  const surface = level === null ? null : 119 - level * 1.18;
  return (
    <section className="panel tank-panel" aria-label="Tank and pump status" data-tank-status>
      <div className="panel-heading">
        <h2>Tank & pump</h2>
        {!connected && <span className="tank-stale">Disconnected · last received</span>}
        <div className="tank-actions">
          <Button variant="ghost" onClick={onConfigure}>
            <Settings2 size={16} /> Map sensors
          </Button>
        </div>
      </div>
      <div className="tank-layout">
        <div
          className="tank-vessel"
          data-tank-level={level ?? "unknown"}
          title={tank.level.entityId || undefined}
        >
          <svg viewBox="0 0 100 120" role="img" aria-label={`Tank level: ${value(tank.level)}`}>
            <defs>
              <clipPath id={clipId}>
                <rect x="1" y="1" width="98" height="118" rx="12" />
              </clipPath>
            </defs>
            <rect x="1" y="1" width="98" height="118" rx="12" className="tank-shell" />
            {surface !== null && (
              <g clipPath={`url(#${clipId})`}>
                <rect x="1" y={surface} width="98" height={119 - surface} className="tank-water" />
                <path d={`M1 ${surface} H99`} className="tank-waterline" />
              </g>
            )}
            {[25, 50, 75].map((p) => (
              <path key={p} d={`M86 ${119 - p * 1.18}h13`} className="tank-tick" />
            ))}
            <text x="50" y="58" textAnchor="middle" className="tank-percent">
              {level === null ? "—" : `${Math.round(level)}%`}
            </text>
            <text x="50" y="76" textAnchor="middle" className="tank-caption">
              {tank.level.issue || "full"}
            </text>
          </svg>
          {soon && (
            <Pill tone="warn" dot data-refill-soon>
              Refill soon
            </Pill>
          )}
        </div>
        <TankLevelChart controller={controller} source={tank.source} current={level} />
        <dl className="tank-equipment">
          <div
            className={connected && tank.pump.on ? "is-on" : undefined}
            data-pump-state={tank.pump.on === null ? "unknown" : tank.pump.on ? "on" : "off"}
          >
            <dt>Pump{lastKnown}</dt>
            <dd>{pump}</dd>
          </div>
          {refill && (
            <>
              <div
                className={connected && refill.running ? "is-on" : undefined}
                data-refill-state={refill.running ? "running" : refill.now ? "idle" : "unknown"}
              >
                <dt>Refill{lastKnown}</dt>
                <dd>{refill.now ?? refill.issue}</dd>
              </div>
              <div>
                <dt>Last refill</dt>
                <dd>
                  {refill.lastAt ? (
                    <>
                      <time dateTime={refill.lastAt}>
                        {new Date(refill.lastAt).toLocaleString([], {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </time>
                      {refill.lastStopped && " · stopped"}
                    </>
                  ) : (
                    (refill.issue ?? "None yet")
                  )}
                </dd>
              </div>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

/** The reservoir at a glance, for the Overview: how full it is against its minimum, what its refill
 * is doing, and the way to Feed (or to map it, where nothing is). */
export function ReservoirSummary({
  controller,
  open,
  configure,
}: {
  controller: Controller;
  open: () => void;
  configure: () => void;
}) {
  const tank = tankTelemetry(controller.states, controller.room.room);
  const { refill, source } = tank;
  const connected = ["live", "demo"].includes(controller.connection);
  const level = tank.level.value;
  const remind = source?.remindPct ?? null;
  const soon = remind !== null && level !== null && level <= remind;
  const min = source?.minPct ?? null;
  const mapped = !!(tank.level.entityId || tank.pump.entityId || refill);
  if (!mapped)
    return (
      <section
        className="card reservoir-summary"
        aria-labelledby="reservoir-title"
        data-tank-status
      >
        <div className="reservoir-text">
          <h2 id="reservoir-title">Reservoir</h2>
          <span className="muted">
            No reservoir is mapped: its level sensor and pump show here once they are.
          </span>
        </div>
        <button type="button" className="button-quiet" onClick={configure}>
          Map sensors
        </button>
      </section>
    );
  const state = refill?.running
    ? (refill.now ?? "Refilling")
    : tank.pump.on
      ? "Pump on"
      : refill?.now === "Not running"
        ? "Idle"
        : (refill?.now ?? (tank.pump.on === false ? "Pump off" : null));
  const line = [
    refill?.lastAt &&
      `last refill ${new Date(refill.lastAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}${refill.lastStopped ? " (stopped)" : ""}`,
    min !== null && `minimum ${Math.round(min)}%`,
    remind !== null && `reminder at ${Math.round(remind)}%`,
  ].filter(Boolean);
  return (
    <section className="card reservoir-summary" aria-labelledby="reservoir-title" data-tank-status>
      <div
        className="reservoir-vessel"
        role="img"
        data-tank-level={level ?? "unknown"}
        aria-label={
          level === null
            ? `Reservoir level: ${tank.level.issue ?? "unknown"}`
            : `Reservoir ${Math.round(level)}% full${min !== null ? `; its minimum ${Math.round(min)}%` : ""}`
        }
      >
        {level !== null && <span className="reservoir-water" style={{ height: `${level}%` }} />}
        {min !== null && <span className="reservoir-min" style={{ bottom: `${min}%` }} />}
      </div>
      <div className="reservoir-text">
        <span className="reservoir-head">
          <h2 id="reservoir-title">Reservoir</h2>
          {state && (
            <span
              className="tone-badge"
              data-tone={refill?.running || tank.pump.on ? "info" : undefined}
              data-pump-state={tank.pump.on === null ? "unknown" : tank.pump.on ? "on" : "off"}
            >
              {state}
              {connected ? "" : " · last known"}
            </span>
          )}
          {soon && (
            <span className="tone-badge" data-tone="warning" data-refill-soon>
              Refill soon
            </span>
          )}
        </span>
        <span className="reservoir-level">
          <strong>{level === null ? "–" : `${Math.round(level)}%`}</strong>
          <span>{level === null ? tank.level.issue : "full"}</span>
        </span>
        {line.length > 0 && <span className="reservoir-line">{line.join(" · ")}</span>}
      </div>
      {/* The reservoir's own page once it has one; a room with only a pump maps the rest first. */}
      {tank.level.entityId || refill ? (
        <button type="button" className="link-button" onClick={open}>
          Feed
        </button>
      ) : (
        <button type="button" className="link-button" onClick={configure}>
          Map sensors
        </button>
      )}
    </section>
  );
}
