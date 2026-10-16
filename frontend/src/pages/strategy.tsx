import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, Check, ChevronRight, Download, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Empty, ReviewDialog, number, type ReviewItem } from "@/components/dashboard";
import { TargetsBanner } from "@/components/targets-banner";
import { zoneColor } from "@/lib/room-mode";
import { duration } from "@/lib/day-timeline";
import { estimatePercent, waterParameters } from "@/lib/water-delivery";
import { plantText } from "@/lib/water-view";
import type { Controller, Setting } from "@/lib/types";
import { PlanningCurve } from "@/components/planning-curve";
import { buildSetpointPreview, validateSetpoint } from "@/lib/setpoint-preview";
import { smoothRecorded, type PlanningPhaseId } from "@/lib/planning-curve";
import {
  FieldSuggestionLine,
  SensorContextCard,
  useSensorContext,
} from "@/components/sensor-context";
import {
  AutoBadge,
  AutoSetpointsControl,
  AutoZoneChip,
  EcStackingControl,
} from "@/components/room-controls";
import { SettingHelp } from "@/components/setting-help";
import { managedBy } from "@/lib/auto-setpoints";
import { scheduleStatus } from "@/lib/schedule-words";
import { localDate } from "@/lib/grow-plan";
import {
  exportTargets,
  loadTargets,
  readTargets,
  targetsFileName,
  type LoadedTargets,
} from "@/lib/targets-file";
import { errorText } from "@/lib/utils";
import { levelWarning } from "@/lib/level-order";
import {
  fieldHint,
  referenceLines,
  setpointMetric,
  setpointParam,
  suggestedDraft,
} from "@/lib/sensor-context";
import {
  DRYBACK_UNIT,
  GROUP_HELP,
  PHASE_GROUPS,
  TAG_TEXT,
  settingWords,
} from "@/lib/setting-words";
import { ScaleLegend, ScaleMark } from "@/components/scale-mark";
import "./setpoint-preview.css";
import "./strategy.css";

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fieldGroup(setting: Setting) {
  const ecPhase = setting.entityId.match(/_ec_target_(?:veg|gen)_p([012])$/);
  return ecPhase ? PHASE_GROUPS[Number(ecPhase[1])] : setting.group;
}

export type Drafts = Record<
  string,
  {
    value: string;
    original: number | string | null;
    label: string;
    zone: string;
  }
>;
export function Strategy({
  controller,
  drafts,
  setDrafts,
  selectedZone,
}: {
  controller: Controller;
  drafts: Drafts;
  setDrafts: React.Dispatch<React.SetStateAction<Drafts>>;
  selectedZone?: number;
}) {
  const [zoneId, setZoneId] = useState<string>(
    selectedZone === undefined
      ? String(controller.room.zones[0]?.id ?? "room")
      : String(selectedZone),
  );
  const [review, setReview] = useState(false);
  const [saved, setSaved] = useState(false);
  // The phase card open on the right; null: all closed.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [roomPreviewZone, setRoomPreviewZone] = useState(controller.room.zones[0]?.id);
  // What the last targets file loaded into the draft, or why it could not be read.
  const [loaded, setLoaded] = useState<{ from: string; result: LoadedTargets } | null>(null);
  const [fileError, setFileError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectedZone !== undefined) setZoneId(String(selectedZone));
  }, [selectedZone]);
  const planEngaged = controller.room.strategy.engaged;
  // The controller can require the schedule before its sensor says so: that is a running one.
  const reported = scheduleStatus(controller.room.strategy.status);
  const scheduleState =
    planEngaged && !["active", "disarming", "error"].includes(reported) ? "active" : reported;
  const allSettings = controller.room.settings;
  const zone = controller.room.zones.find((z) => String(z.id) === zoneId);
  const fields =
    zoneId === "room"
      ? allSettings.filter((field) => field.zoneId === undefined)
      : zone?.fields || [];
  const choices = (controller.room.choices || []).filter((choice) =>
    zoneId === "room" ? choice.zoneId === undefined : String(choice.zoneId) === zoneId,
  );
  const previewZoneId =
    zone?.id ??
    controller.room.zones.find((z) => z.id === roomPreviewZone)?.id ??
    controller.room.zones[0]?.id;
  const preview = buildSetpointPreview(
    controller.room,
    controller.states,
    previewZoneId ?? 0,
    drafts,
  );
  const activeMode =
    preview.draft.mode === "Vegetative"
      ? "veg"
      : preview.draft.mode === "Generative"
        ? "gen"
        : null;
  const visibleFields = fields.filter((setting) => {
    // Pot size, plants and drippers are the room's hardware: edited in Settings › Rooms & hardware.
    if (fieldGroup(setting) === "Hardware sizing") return false;
    if (showInactive || !activeMode) return true;
    const mode = setting.entityId.match(
      /_(vegetative|generative)_dryback_target$|_ec_target_(veg|gen)_p[012]$/,
    );
    return !mode || (mode[1]?.slice(0, 3) ?? mode[2]) === activeMode;
  });
  // The zone's moisture levels as the controller will read them, drafts included: what each one
  // does against the others (level-order.ts). A room's defaults are not a zone's levels.
  const levels = zone
    ? {
        peak: preview.draft.parameters.p1_target_vwc,
        fieldCapacity: preview.draft.parameters.field_capacity,
        trigger: preview.draft.parameters.p2_vwc_threshold,
        rescue: preview.draft.parameters.p3_emergency_vwc_threshold,
        dryback: preview.draft.parameters.dryback_target,
      }
    : null;
  const groups = [...new Set(visibleFields.map(fieldGroup))];
  // The card open by default: the zone's phase now, else the first.
  const group =
    openGroup !== null && groups.includes(openGroup)
      ? openGroup
      : openGroup === null && groups.length
        ? (groups.find((item) => zone && item.startsWith(zone.phase)) ?? groups[0])
        : null;
  const phase = group?.match(/^P[0-3]/)?.[0];
  const invalid = validateSetpoint;
  const canEdit = !planEngaged && ["live", "demo"].includes(controller.connection);
  // Recorded probe behaviour for the zone being previewed. The chart lines and the hints
  // under each input read the same draft state as the form, so they move as you type.
  const sensorZone = controller.room.zones.find((z) => z.id === previewZoneId);
  // Seeing the probe never depends on being allowed to edit: a schedule-owned day still plots.
  const sensor = useSensorContext(
    controller,
    sensorZone,
    ["live", "demo"].includes(controller.connection),
  );
  // The plan graph redraws on every drag step, so the recorder dump is thinned once per load.
  // Medians, not extremes: drawn raw, pore EC is a wall of sensor flicker.
  const recorded = useMemo(
    () => ({
      vwc: smoothRecorded(sensor.vwc.points, 10),
      ec: smoothRecorded(sensor.ec.points, 20),
      now: sensor.now,
    }),
    [sensor.vwc.points, sensor.ec.points, sensor.now],
  );
  const sensorLines = referenceLines({
    draft: preview.draft.parameters,
    saved: preview.saved.parameters,
    typicalDailyPeak: sensor.vwc.stats?.typicalDailyPeak ?? null,
    learnedPeak: sensorZone?.auto?.learnedPeak ?? null,
  });
  const supervisors = controller.room.zones.map((z) => z.auto);
  const errors = Object.entries(drafts)
    .map(([id, draft]) => {
      const setting = allSettings.find((s) => s.entityId === id);
      const choice = controller.room.choices.find((c) => c.entityId === id);
      return setting
        ? invalid(setting, draft.value)
        : choice
          ? choice.options.includes(draft.value)
            ? ""
            : "Select an available mode."
          : "A draft setting is no longer available. Discard it before continuing.";
    })
    .filter(Boolean);
  const items: ReviewItem[] = Object.entries(drafts).flatMap<ReviewItem>(([id, draft]) => {
    const setting = allSettings.find((s) => s.entityId === id);
    const choice = controller.room.choices.find((c) => c.entityId === id);
    if (choice && choice.options.includes(draft.value))
      return [
        {
          change: { entityId: id, value: draft.value },
          label: `${draft.zone} · ${draft.label}`,
          before: choice.value || "Unavailable",
          after: draft.value,
        },
      ];
    return !setting || invalid(setting, draft.value)
      ? []
      : [
          {
            change: { entityId: id, value: Number(draft.value) },
            label: `${draft.zone} · ${draft.label}`,
            before: `${number(setting.value)} ${setting.unit}`,
            after: `${number(Number(draft.value))} ${setting.unit}`,
          },
        ];
  });
  function edit(setting: Setting, value: string) {
    setSaved(false);
    setDrafts((current) => {
      const next = { ...current };
      if (value.trim() && Number(value) === (current[setting.entityId]?.original ?? setting.value))
        delete next[setting.entityId];
      else
        next[setting.entityId] = {
          value,
          original: current[setting.entityId]?.original ?? setting.value,
          label: setting.label,
          zone:
            setting.zoneId === undefined
              ? "Room settings"
              : (controller.room.zones.find((item) => item.id === setting.zoneId)?.name ??
                `Zone ${setting.zoneId}`),
        };
      return next;
    });
  }
  function exportFile() {
    download(
      exportTargets(controller.room, new Date().toISOString()),
      targetsFileName(controller.room.room.name, localDate()),
    );
  }
  async function importFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setLoaded(null);
    setFileError("");
    try {
      const targets = readTargets(await file.text());
      const result = loadTargets(targets, controller.room);
      const exported = Date.parse(targets.exported_at);
      const when = Number.isFinite(exported)
        ? `, exported ${new Date(exported).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
        : "";
      setSaved(false);
      setDrafts(result.drafts);
      setLoaded({ from: `${targets.room || "another room"}’s targets${when}`, result });
    } catch (e) {
      setFileError(errorText(e));
    }
  }
  const drafted = Object.keys(drafts).length;
  const connected = ["live", "demo"].includes(controller.connection);
  // Draft values over the controller's, for what a percentage works out to.
  const overrides = Object.fromEntries(
    Object.entries(drafts)
      .filter(([, draft]) => draft.value.trim() && Number.isFinite(Number(draft.value)))
      .map(([id, draft]) => [id, Number(draft.value)]),
  );
  const water =
    previewZoneId === undefined
      ? null
      : waterParameters(controller, previewZoneId, undefined, overrides);
  const scaleWords = (param: string, value: number | null): string | null => {
    const words = settingWords(param);
    if (!words?.scale || value === null) return null;
    if (words.scale === "absolute") return "A moisture reading, on the probe’s own scale.";
    if (words.scaleOf === "each plant’s substrate") {
      const given = water && estimatePercent(water, value);
      const shot = given?.effective ?? given?.requested;
      return shot
        ? `${number(value)}% of each plant’s substrate: ≈ ${plantText(shot.mlPerPlant)} a plant, ${duration(shot.seconds * 1000)} at the drippers.`
        : `${number(value)}% of each plant’s substrate.`;
    }
    if (param.endsWith("dryback_target")) {
      const peak = preview.draft.parameters.p1_target_vwc;
      return Number.isFinite(peak)
        ? `${number(value)}% of the day’s peak: from a ${number(peak)}% peak, down to ${number(peak * (1 - value / 100))}%.`
        : `${number(value)}% of the day’s peak.`;
    }
    return `${number(value)}% of ${words.scaleOf}.`;
  };
  const summary = (items: Setting[]) =>
    items
      .slice(0, 2)
      .map((setting) => {
        const value = drafts[setting.entityId]?.value ?? setting.value;
        return `${setting.short ?? setting.label} ${value === null || value === "" ? "–" : number(Number(value))}${setting.unit === "%" ? "%" : setting.unit ? ` ${setting.unit}` : ""}`;
      })
      .join(" · ");
  const firstDraft = Object.values(drafts)[0];
  return (
    <div className="strategy-page">
      <TargetsBanner
        controller={controller}
        status={scheduleState}
        open={
          planEngaged || scheduleState === "armed"
            ? { label: "Open schedule", href: "#/grow-plan" }
            : undefined
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Import targets"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {fileError && (
        <div className="workspace-message error" role="alert">
          {fileError}
        </div>
      )}
      {loaded && (
        <div className="workspace-message targets-loaded" role="status">
          <p>
            <strong>
              {Object.keys(loaded.result.drafts).length
                ? `Loaded ${Object.keys(loaded.result.drafts).length} ${
                    Object.keys(loaded.result.drafts).length === 1 ? "change" : "changes"
                  } from ${loaded.from}.`
                : `Nothing to change: ${loaded.from} match this room’s.`}
            </strong>{" "}
            {Object.keys(loaded.result.drafts).length > 0 &&
              "They’re in your draft: nothing changes until you review and apply them."}
          </p>
          {loaded.result.left.length > 0 && (
            <p>Left as this room has them: {loaded.result.left.join(", ")}.</p>
          )}
          {loaded.result.rounded.length > 0 && (
            <p>Rounded to this room’s steps: {loaded.result.rounded.join("; ")}.</p>
          )}
          {loaded.result.skipped.length > 0 && <p>Skipped: {loaded.result.skipped.join("; ")}.</p>}
          {loaded.result.missingZones.length > 0 && (
            <p>Not in this room: {loaded.result.missingZones.join(", ")}.</p>
          )}
        </div>
      )}
      <div className="strategy-toolbar">
        <div className="target-chips" role="group" aria-label="Targets of">
          {controller.room.zones.map((z, index) => {
            const count = Object.values(drafts).filter((d) => d.zone === z.name).length;
            return (
              <button
                key={z.id}
                type="button"
                className="target-chip"
                aria-pressed={zoneId === String(z.id)}
                onClick={() => {
                  setZoneId(String(z.id));
                  setOpenGroup(null);
                }}
              >
                <i style={{ background: zoneColor(index) }} aria-hidden="true" />
                {z.name}
                {count > 0 && (
                  <b className="chip-count" aria-label={`${count} unsaved`}>
                    {count}
                  </b>
                )}
              </button>
            );
          })}
          <button
            type="button"
            className="target-chip"
            aria-pressed={zoneId === "room"}
            onClick={() => {
              setZoneId("room");
              setOpenGroup(null);
            }}
          >
            <i className="target-chip-room" aria-hidden="true" />
            Whole room
            {Object.values(drafts).filter((d) => d.zone === "Room settings").length > 0 && (
              <b className="chip-count">
                {Object.values(drafts).filter((d) => d.zone === "Room settings").length}
              </b>
            )}
          </button>
        </div>
        <div className="strategy-toolbar-actions">
          <Button
            variant="outline"
            onClick={exportFile}
            disabled={planEngaged || !allSettings.length}
            title={
              planEngaged
                ? "While a schedule runs the room follows it: export the schedule instead"
                : "Save these targets to a file, both steering modes, for another room or a tester"
            }
          >
            <Download size={16} /> Export targets
          </Button>
          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={!canEdit || drafted > 0}
            title={
              drafted
                ? "Review or discard your draft first"
                : "Load a targets file into the draft, to review before anything changes"
            }
          >
            <Upload size={16} /> Import
          </Button>
        </div>
      </div>
      <div className="strategy-modes">
        {!planEngaged &&
          choices.map((choice) => (
            <div className="steering-choice" key={choice.entityId}>
              <Label htmlFor={`choice-${choice.entityId}`}>
                {choice.label}
                {drafts[choice.entityId] && <span className="draft-dot" />}
              </Label>
              <select
                id={`choice-${choice.entityId}`}
                value={drafts[choice.entityId]?.value ?? choice.value ?? ""}
                disabled={!connected}
                onChange={(event) => {
                  const value = event.target.value;
                  setSaved(false);
                  setDrafts((current) => {
                    const next = { ...current };
                    if (value === (current[choice.entityId]?.original ?? choice.value))
                      delete next[choice.entityId];
                    else
                      next[choice.entityId] = {
                        value,
                        original: current[choice.entityId]?.original ?? choice.value,
                        label: choice.label,
                        zone: zone?.name || "Room settings",
                      };
                    return next;
                  });
                }}
              >
                <option value="" disabled>
                  Select a mode
                </option>
                {choice.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <SettingHelp
                label={choice.label}
                param={choice.entityId.replace(/^select\.crop_steering_/, "")}
                detail={{
                  what: "Vegetative or Generative: which of their two values this zone's P3 dryback target and its substrate EC targets for P0 to P2 use, and, with Auto setpoints on, how early its maintenance shots may stop (3 hours before lights-off at the earliest when vegetative, from the middle of the day when generative).",
                  when: "From the controller's next check after you apply it.",
                  affects:
                    "Only those. Its peak target, maintenance trigger, shot sizes and timing stay as they are: change those too if the new steering calls for it. Nothing changes until you review and apply.",
                }}
              />
              {drafts[choice.entityId] && (
                <span className="small muted">Now {choice.value || "unavailable"}</span>
              )}
            </div>
          ))}
        {zone && activeMode && !planEngaged && (
          <label className="setpoint-mode-visibility">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            Show both modes
          </label>
        )}
        <span className="strategy-modes-gap" />
        <AutoSetpointsControl controller={controller} />
        <EcStackingControl controller={controller} />
      </div>
      {saved && (
        <div className="success-banner" role="status">
          <Check size={18} />
          Changes applied and verified by controller readback.
        </div>
      )}
      <div className="strategy-columns setpoint-workspace">
        <div className="strategy-main">
          <section
            className="card strategy-curve setpoint-preview"
            aria-label="Setpoint planning preview"
          >
            <div className="card-head">
              <h2>
                {controller.room.zones.find((z) => z.id === previewZoneId)?.name ?? "No zone"}’s day
              </h2>
              <span>
                {preview.readOnly
                  ? "The schedule’s targets today · read only"
                  : `${preview.draft.mode ?? "Mode unavailable"} · drag a line, or type in the phase cards`}
              </span>
            </div>
            {zoneId === "room" && (
              <div className="setpoint-preview-zone">
                <Label htmlFor="setpoint-preview-zone">The room’s values, drawn on</Label>
                <select
                  id="setpoint-preview-zone"
                  value={previewZoneId ?? ""}
                  onChange={(event) => setRoomPreviewZone(Number(event.target.value))}
                >
                  {controller.room.zones.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <p>A zone’s own value, where it has one, wins over the room’s.</p>
              </div>
            )}
            <PlanningCurve
              recorded={recorded}
              retention={sensorZone?.auto?.gain}
              parameters={preview.draft.parameters}
              lightsOn={preview.draft.lightsOn}
              lightsOff={preview.draft.lightsOff}
              baseline={preview.readOnly ? undefined : preview.saved}
              bounds={preview.bounds}
              showEditors={false}
              selectedPhase={phase as PlanningPhaseId | undefined}
              description={
                preview.readOnly
                  ? "Today’s active scheduled targets. Open Schedule to edit the dated strategy."
                  : "Drag a target or adjust the controls beside this graph. Nothing is written until you review and apply."
              }
              onChange={
                canEdit
                  ? (key, value) => {
                      const setting = preview.fields[key];
                      if (setting) edit(setting, String(value));
                    }
                  : undefined
              }
            />
            <p className="setpoint-preview-note">
              Your targets run across the whole day; the dark lines are what this zone’s probe
              recorded, today and on earlier days. The P3 boundary is shown at lights-off; the
              controller may stop earlier on the dryback it measures, and P2 can also move for EC
              and safety limits.
            </p>
            {preview.notes.map((note) => (
              <p className="setpoint-preview-note" key={note}>
                {note}
              </p>
            ))}
            {preview.issues.length > 0 && (
              <div className="workspace-message" role="status">
                {preview.issues.map((issue) => (
                  <p key={issue}>{issue}</p>
                ))}
              </div>
            )}
          </section>
          <SensorContextCard
            context={sensor}
            lines={sensorLines}
            disabledNote={
              planEngaged
                ? "The active schedule owns today’s targets, so nothing can be typed here. Recorded sensor behaviour is shown while manual targets are editable."
                : undefined
            }
          />
          {(zone ? [zone] : controller.room.zones).some((item) => item.auto) && (
            <section className="card strategy-auto" aria-label="Auto setpoints">
              <div className="card-head">
                <h2>Auto setpoints</h2>
              </div>
              {(zone ? [zone] : controller.room.zones).map(
                (item) =>
                  item.auto && (
                    <AutoZoneChip
                      key={item.id}
                      status={item.auto}
                      name={zone ? undefined : item.name}
                    />
                  ),
              )}
            </section>
          )}
        </div>
        <div className="strategy-side setpoint-controls">
          <ScaleLegend />
          {planEngaged ? (
            <section className="phase-card is-open scheduled-targets">
              <div className="phase-card-head">
                <span className="phase-badge" data-schedule="">
                  <CalendarRange size={15} aria-hidden="true" />
                </span>
                <span className="phase-card-title">
                  <strong>The schedule’s targets today</strong>
                  <small>Read only: edit them in the Schedule</small>
                </span>
              </div>
              <div className="setting-fields">
                {Object.entries(preview.draft.parameters).map(([key, value]) => {
                  const field =
                    allSettings.find(
                      (item) => item.zoneId === previewZoneId && item.entityId.endsWith(`_${key}`),
                    ) ??
                    allSettings.find(
                      (item) => item.zoneId === undefined && item.entityId.endsWith(`_${key}`),
                    );
                  const ecPhase = key.match(/^ec_target_p([012])$/);
                  const label =
                    settingWords(key)?.label ?? field?.label ?? key.replaceAll("_", " ");
                  const unit =
                    key === "dryback_target"
                      ? DRYBACK_UNIT
                      : ecPhase
                        ? "mS/cm"
                        : (field?.unit ?? "");
                  const words = settingWords(key);
                  const said = scaleWords(key, value);
                  return (
                    <div className="setting-field" key={key}>
                      <span>{label}</span>
                      <strong>
                        {number(value)} {unit}
                        {words?.scale && <ScaleMark scale={words.scale} of={words.scaleOf} />}
                      </strong>
                      {said && <p className="scale-words">{said}</p>}
                    </div>
                  );
                })}
                {preview.source === "unavailable-plan" && (
                  <p>Scheduled targets are unavailable. Reconnect to verify the active schedule.</p>
                )}
              </div>
            </section>
          ) : !fields.length && !choices.length ? (
            <section className="panel">
              <Empty
                title="No editable settings available"
                detail="This controller has not exposed editable number entities for this selection. Sensor readings cannot be edited."
              />
            </section>
          ) : (
            groups.map((item) => {
              const id = item.match(/^P[0-3]/)?.[0];
              const name = id ? item.replace(/^P[0-3]\s*·\s*/, "") : item;
              const open = item === group;
              const inGroup = visibleFields.filter((field) => fieldGroup(field) === item);
              const changed = inGroup.filter((field) => drafts[field.entityId]).length;
              return (
                <section
                  className={`phase-card settings-group${open ? " is-open" : ""}`}
                  key={item}
                  data-phase={id}
                  aria-label={item}
                >
                  <button
                    type="button"
                    className="phase-card-head"
                    aria-expanded={open}
                    onClick={() => setOpenGroup(open ? "" : item)}
                  >
                    <span className="phase-badge" data-phase={id}>
                      {id ?? "•"}
                    </span>
                    <span className="phase-card-title">
                      <strong>{name}</strong>
                      <small>{open ? (GROUP_HELP[item] ?? "") : summary(inGroup)}</small>
                    </span>
                    {changed > 0 && <b className="chip-count">{changed}</b>}
                    <ChevronRight size={18} aria-hidden="true" className="phase-card-chevron" />
                  </button>
                  {open && (
                    <div className="setting-fields">
                      {inGroup.map((setting) => {
                        const draft = drafts[setting.entityId];
                        const error = draft ? invalid(setting, draft.value) : "";
                        const stale = draft && draft.original !== setting.value;
                        const param = setpointParam(setting.entityId, controller.room.room.prefix);
                        const metric = param ? setpointMetric(param) : null;
                        const typed = !draft
                          ? setting.value
                          : draft.value.trim() && Number.isFinite(Number(draft.value))
                            ? Number(draft.value)
                            : null;
                        const hint =
                          param && metric
                            ? fieldHint(
                                param,
                                typed,
                                sensor[metric].stats,
                                sensor.hours,
                                sensorZone?.auto?.learnedPeak,
                              )
                            : null;
                        // A dryback target only for the steering mode in use: the other
                        // mode's is not tonight's.
                        const inUse =
                          !param?.endsWith("dryback_target") || param.slice(0, 3) === activeMode;
                        const order = param && levels && inUse ? levelWarning(param, levels) : null;
                        // Auto setpoints' plan for tonight, beside the dryback target it could
                        // not reach: the steering mode in use only.
                        const autoNote =
                          param?.endsWith("dryback_target") &&
                          param.slice(0, 3) === activeMode &&
                          zone?.auto?.state === "tracking"
                            ? zone.auto.drybackNote
                            : null;
                        const suggested = hint?.suggestion
                          ? suggestedDraft(hint.suggestion.value, setting)
                          : null;
                        const auto = managedBy(supervisors, setting.entityId);
                        const words = param ? settingWords(param) : undefined;
                        // The daily water limit is the zone's, for all its plants: per plant too.
                        const plants =
                          param === "max_daily_volume"
                            ? (allSettings.find(
                                (other) =>
                                  other.zoneId === setting.zoneId &&
                                  other.entityId.endsWith("_plant_count"),
                              )?.value ?? null)
                            : null;
                        const perPlant =
                          plants && plants > 0 && typed !== null ? typed / plants : null;
                        const tag = words?.tag;
                        const said = param ? scaleWords(param, typed) : null;
                        return (
                          <div
                            className={`setting-field ${draft ? "is-draft" : ""}`}
                            key={setting.entityId}
                          >
                            <div>
                              <div className="setting-name">
                                {tag && (
                                  <span className="setting-tag" data-tag={tag}>
                                    {TAG_TEXT[tag]}
                                  </span>
                                )}
                                <Label htmlFor={`setting-${setting.entityId}`}>
                                  {setting.label}
                                  {draft && <span className="draft-dot" title="Unsaved draft" />}
                                  {auto && <AutoBadge />}
                                </Label>
                                {param && (
                                  <SettingHelp
                                    label={setting.label}
                                    param={param}
                                    detail={words?.detail}
                                    limits={`${setting.min}–${setting.max}${setting.unit ? ` ${setting.unit}` : ""} · step ${setting.step}`}
                                  />
                                )}
                              </div>
                              <p>
                                {setting.description ||
                                  `Allowed range: ${setting.min}–${setting.max}${setting.unit ? ` ${setting.unit}` : ""}.`}
                              </p>
                            </div>
                            <div className="setting-input">
                              <div>
                                <Input
                                  id={`setting-${setting.entityId}`}
                                  type="number"
                                  min={setting.min}
                                  max={setting.max}
                                  step={setting.step}
                                  value={draft?.value ?? setting.value ?? ""}
                                  placeholder={setting.value === null ? "Unavailable" : undefined}
                                  aria-invalid={Boolean(error)}
                                  aria-describedby={
                                    `hint-${setting.entityId}` +
                                    (hint || auto || order || autoNote || perPlant !== null || said
                                      ? ` context-${setting.entityId}`
                                      : "")
                                  }
                                  disabled={planEngaged || !connected}
                                  onChange={(e) => edit(setting, e.target.value)}
                                />
                                <span>{setting.unit}</span>
                              </div>
                              {words?.scale && <ScaleMark scale={words.scale} of={words.scaleOf} />}
                              <p
                                id={`hint-${setting.entityId}`}
                                className={error ? "field-error" : "small muted"}
                              >
                                {error ||
                                  (stale
                                    ? `Controller now reports ${number(setting.value)}. Review before applying.`
                                    : draft
                                      ? `Was ${number(setting.value)} ${setting.unit}`
                                      : "")}
                              </p>
                            </div>
                            {(hint || auto || order || autoNote || perPlant !== null || said) && (
                              <div className="setting-context" id={`context-${setting.entityId}`}>
                                {said && (
                                  <p className="scale-words" data-scale-words={words?.scale}>
                                    {said}
                                  </p>
                                )}
                                {perPlant !== null && (
                                  <p className="setting-sensor-hint" data-per-plant>
                                    {number(perPlant, 2)} L per plant each grow-day, across {plants}{" "}
                                    plants.
                                  </p>
                                )}
                                {auto && (
                                  <p className="setting-auto-hint">
                                    Managed automatically – manual edits will be overwritten.
                                  </p>
                                )}
                                {autoNote && (
                                  <p className="setting-auto-hint" data-auto-dryback>
                                    Auto setpoints: {autoNote}.
                                  </p>
                                )}
                                {hint?.text && (
                                  <p className="setting-sensor-hint">
                                    {setting.zoneId === undefined
                                      ? `${sensor.zoneName} probe · `
                                      : ""}
                                    {hint.text}
                                  </p>
                                )}
                                {hint?.suggestion && (
                                  <FieldSuggestionLine
                                    suggestion={hint.suggestion}
                                    zoneName={
                                      setting.zoneId === undefined ? sensor.zoneName : undefined
                                    }
                                    draftValue={suggested}
                                    unit={setting.unit}
                                    action="in draft"
                                    disabled={!canEdit || typed === suggested}
                                    onUse={(value) => edit(setting, String(value))}
                                  />
                                )}
                                {[hint?.warning, order].filter(Boolean).map((warning) => (
                                  <p className="setting-advisory" key={warning}>
                                    <TriangleAlert size={13} aria-hidden="true" />
                                    <span>
                                      {warning![0].toUpperCase() + warning!.slice(1)}. Advisory
                                      only; you can still save this value.
                                    </span>
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
      {drafted > 0 && (
        <div className="draft-bar" role="region" aria-label="Unsaved changes">
          <span className="draft-count">{drafted}</span>
          <span className="draft-bar-text">
            <strong>
              {drafted === 1 && firstDraft
                ? `${firstDraft.zone} · ${firstDraft.label}`
                : `${drafted} unsaved changes`}
            </strong>
            <span>
              {errors.length
                ? " · fix the invalid values before review"
                : " · nothing changes until you apply"}
            </span>
          </span>
          <button
            type="button"
            className="draft-bar-discard"
            onClick={() => {
              setDrafts({});
              setSaved(false);
              setLoaded(null);
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="draft-bar-review"
            disabled={Boolean(errors.length) || !items.length || planEngaged || !connected}
            onClick={() => setReview(true)}
          >
            Review and apply
          </button>
        </div>
      )}
      <ReviewDialog
        open={review}
        onOpenChange={setReview}
        controller={controller}
        items={items}
        onApplied={(applied) => {
          setDrafts((current) =>
            Object.fromEntries(Object.entries(current).filter(([id]) => !applied.includes(id))),
          );
          if (applied.length) {
            setSaved(true);
            setLoaded(null);
          }
        }}
      />
    </div>
  );
}
