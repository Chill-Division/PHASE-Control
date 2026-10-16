import { useLayoutEffect, useEffect, useState } from "react";
import {
  Check,
  Plus,
  Search,
  Settings2,
  Trash2,
  RotateCcw,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Heading, Empty } from "@/components/dashboard";
import { WateringPower } from "@/components/room-controls";
import { RoomTests } from "@/components/room-tests";
import { Pill } from "@/components/mini-visuals";
import { SizingField, SubstratePresetPicker } from "@/components/zone-sizing";
import type { Controller } from "@/lib/types";
import { reviewValue, sizingError, stateText } from "@/lib/units";
import {
  PLUMBING_HINTS,
  PLUMBING_LABELS,
  PLUMBING_LAYOUTS,
  hardwareForLayout,
  isPlumbingLayout,
  plumbingErrors,
  plumbingUses,
  type PlumbingLayout,
} from "@/lib/plumbing";
import { errorText } from "@/lib/utils";
import { BATCH_SWITCH_KEYS, DOSER_KEYS } from "@/lib/feed";
import { setupChanges } from "@/lib/setup-changes";
import type { SetupCandidate, SetupDocument, SetupRoom, SetupZone } from "@/lib/operator-types";
import { PlumbingDiagram } from "@/components/plumbing-diagram";

function MappingPicker({
  label,
  values,
  candidates,
  multiple = false,
  onChange,
  disabled = false,
}: {
  label: string;
  values: string[];
  candidates: SetupCandidate[];
  multiple?: boolean;
  onChange: (values: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  const filtered = candidates.filter((c) =>
    (c.name + " " + c.entity_id + " " + c.unit).toLowerCase().includes(search.toLowerCase()),
  );
  const selected = values.filter(Boolean);
  // A mapped entity Home Assistant reports no state for is mapped, but not usable.
  const silent = selected.filter((id) =>
    ["unavailable", "unknown"].includes(
      candidates.find((c) => c.entity_id === id)?.state.toLowerCase() ?? "",
    ),
  ).length;
  return (
    <div className="mapping-picker">
      <div className="mapping-head">
        <span className="mapping-label">{label}</span>
        {!selected.length ? (
          <Pill tone="neutral">Not mapped</Pill>
        ) : silent ? (
          <Pill tone="warn">
            {selected.length === 1 ? "Unavailable" : `${silent} of ${selected.length} unavailable`}
          </Pill>
        ) : (
          <Pill tone="on">{selected.length === 1 ? "Mapped" : `${selected.length} mapped`}</Pill>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        className="mapping-button"
        aria-label={"Map " + label}
        disabled={disabled}
        onClick={() => {
          setSearch("");
          setOpen(true);
        }}
      >
        <span>
          {selected.length
            ? selected
                .map((id) => candidates.find((c) => c.entity_id === id)?.name || id)
                .join(", ")
            : "Choose " + (multiple ? "sensors" : "entity")}
        </span>
        <Search size={16} />
      </Button>
      {!!selected.length && <small className="muted mapping-id">{selected.join(", ")}</small>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="mapping-dialog">
          <DialogHeader>
            <DialogTitle>Map {label}</DialogTitle>
            <DialogDescription>
              {multiple
                ? "Choose one or more probes. The integration combines their readings."
                : "Choose the entity already configured in Home Assistant."}{" "}
              Availability and units are shown before selection.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Search name or entity ID…"
            aria-label={"Search " + label + " entities"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="mapping-results" role="group" aria-label={label + " candidates"}>
            {filtered.slice(0, 200).map((c) => (
              <button
                type="button"
                key={c.entity_id}
                className={"mapping-result" + (selected.includes(c.entity_id) ? " selected" : "")}
                aria-pressed={selected.includes(c.entity_id)}
                onClick={() => {
                  const next = multiple
                    ? selected.includes(c.entity_id)
                      ? selected.filter((id) => id !== c.entity_id)
                      : [...selected, c.entity_id]
                    : [c.entity_id];
                  onChange(next);
                  if (!multiple) setOpen(false);
                }}
              >
                <span className="mapping-check">
                  {selected.includes(c.entity_id) && <Check size={16} />}
                </span>
                <span>
                  <strong>{c.name}</strong>
                  <small>{c.entity_id}</small>
                </span>
                <span className="mapping-reading">
                  {stateText(c.state)}
                  <small>{c.unit || c.domain}</small>
                </span>
              </button>
            ))}
            {!filtered.length && (
              <p className="muted">
                No matching entities. Check the device integration or broaden your search.
              </p>
            )}
          </div>
          {filtered.length > 200 && (
            <p className="muted small">Showing the first 200 matches. Search to narrow the list.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onChange([])}>
              Clear mapping
            </Button>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function newZone(id: number): SetupZone {
  return {
    id,
    name: "Zone " + id,
    active: true,
    valve: "",
    vwc_sensors: [],
    ec_sensors: [],
    plant_count: 1,
    substrate_volume: 3.2,
    drippers_per_plant: 1,
    dripper_flow_rate: 4,
  };
}
const hardwareFields = [
  ["pump_switch", "Room pump", "switch"],
  ["main_line_switch", "Mainline valve", "switch"],
] as const;
/** The reservoir and dosers a room's nutrient batches use (Feed → Reservoir); the controller app
 * switches these. */
const reservoirFields: [string, string, string][] = [
  ["reservoir_distance_sensor", "Reservoir level sensor (distance)", "distance"],
  ["fresh_water_switch", "Fresh-water solenoid", "switch"],
  ["recirc_switch", "Recirculation solenoid", "switch"],
  ...DOSER_KEYS.map((key, i): [string, string, string] => [key, `Doser ${i + 1} power`, "switch"]),
];
export function Setup({
  controller,
  onDirtyChange,
}: {
  controller: Controller;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [data, setData] = useState<SetupDocument | null>(null),
    [draft, setDraft] = useState<SetupRoom | null>(null);
  const [original, setOriginal] = useState<SetupRoom | null>(null),
    [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [review, setReview] = useState<"save" | "remove" | null>(null),
    [confirmName, setConfirmName] = useState("");
  const dirty = !!draft && (isNew || JSON.stringify(draft) !== JSON.stringify(original));
  const connected = ["live", "demo"].includes(controller.connection);
  useLayoutEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  function selectRoom(room: SetupRoom | undefined) {
    setIsNew(false);
    setOriginal(room ? structuredClone(room) : null);
    setDraft(room ? structuredClone(room) : null);
    setError("");
    setNotice("");
  }
  async function load(selectId?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await controller.operator<SetupDocument>("setup_read");
      if (result.api_version !== 1 || !Array.isArray(result.rooms))
        throw new Error("Update PHASE Control to use room management.");
      setData(result);
      const room =
        result.rooms.find((r) => r.entry_id === (selectId || draft?.entry_id)) ||
        result.rooms.find((r) => r.prefix === controller.room.room.prefix && r.active) ||
        result.rooms.find((r) => r.active) ||
        result.rooms[0];
      selectRoom(room);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!data && connected) void load();
  }, [controller.connection]);
  function addRoom() {
    const room: SetupRoom = {
      entry_id: "",
      revision: 0,
      room_name: "",
      prefix: "",
      slug: "",
      active: true,
      num_zones: 1,
      active_zone_ids: [1],
      zones: [newZone(1)],
      hardware: {},
      plumbing: "",
      safety: { ready: true, blockers: [] },
    };
    setIsNew(true);
    setOriginal(null);
    setDraft(room);
    setNotice("");
    setError("");
  }
  function editZone(id: number, patch: Partial<SetupZone>) {
    if (draft)
      setDraft({ ...draft, zones: draft.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) });
  }
  function candidates(kind: string) {
    return (data?.candidates || [])
      .filter((c) => (kind === "switch" ? c.domain === "switch" : c.domain === "sensor"))
      .sort((a, b) => {
        const preferred = (c: SetupCandidate) =>
          kind === "distance"
            ? (/^(mm|cm|m)$/i.test(c.unit) ? 2 : 0) +
              (/distance|ultrasonic|level/i.test(c.name) ? 1 : 0)
            : kind === "vwc"
              ? (c.unit === "%" ? 2 : 0) + (/vwc|moisture|water.content/i.test(c.name) ? 1 : 0)
              : kind === "ec"
                ? (/mS\/cm|dS\/m|µS\/cm|uS\/cm/i.test(c.unit) ? 2 : 0) +
                  (/conductivity|\bec\b/i.test(c.name) ? 1 : 0)
                : 0;
        return preferred(b) - preferred(a) || a.name.localeCompare(b.name);
      });
  }
  const activeZones = draft?.zones.filter((z) => z.active) || [],
    archivedZones = draft?.zones.filter((z) => !z.active) || [];
  // An integration from before declared plumbing neither stores nor checks it: ask nothing.
  const asksPlumbing = !!data?.capabilities.plumbing;
  // What the room declared; else, for a room from before the question existed, what its SAVED
  // switches imply. Never the draft's switches: clearing the pump of a pumped room must raise
  // an error, not quietly turn the room into a tent. A new room has no answer until one is given.
  const plumbing = !asksPlumbing
    ? ""
    : draft?.plumbing || (isNew ? "" : original?.plumbing_inferred || "");
  const plumbingConfirmed = !asksPlumbing || isNew || !!draft?.plumbing;
  const errors: string[] = [];
  if (draft) {
    if (asksPlumbing && draft.active) {
      if (!plumbing) errors.push("Choose how this room is plumbed.");
      errors.push(...plumbingErrors(plumbing, draft.hardware));
    }
    if (!draft.room_name.trim()) errors.push("Name the room.");
    if (!draft.zones.length) errors.push("Add a zone.");
    if (activeZones.some((z) => !z.name.trim() || !z.valve))
      errors.push("Every active zone needs a name and valve.");
    const valves = activeZones.map((z) => z.valve).filter(Boolean);
    if (new Set(valves).size !== valves.length)
      errors.push("Each active zone must use a distinct valve.");
    // As the integration checks them (setup_api.py): every batch switch is its own.
    const batch = BATCH_SWITCH_KEYS.map((key) => draft.hardware[key]).filter(
      (id): id is string => typeof id === "string" && !!id,
    );
    if (new Set(batch).size !== batch.length)
      errors.push(
        "Each doser and the fresh-water and recirculation solenoids need a switch of their own.",
      );
    const watering = new Set([
      draft.hardware.pump_switch,
      draft.hardware.main_line_switch,
      ...draft.zones.map((z) => z.valve),
    ]);
    if (batch.some((id) => watering.has(id)))
      errors.push(
        "A doser or reservoir solenoid cannot also be the pump, mainline or a zone valve.",
      );
    if (
      activeZones.some(
        (z) =>
          !Number.isInteger(z.plant_count) ||
          z.plant_count < 1 ||
          !!sizingError(z.substrate_volume ?? NaN, "substrate_volume") ||
          !Number.isFinite(z.drippers_per_plant) ||
          Number(z.drippers_per_plant) < 1 ||
          !!sizingError(z.dripper_flow_rate ?? NaN, "dripper_flow_rate"),
      )
    )
      errors.push("Enter valid plant counts, pot volumes and dripper sizing.");
  }
  // What saving changes, as the integration will store it (names trimmed, the plumbing sent or
  // kept) and in the words its logbook records: the review lists these, not the whole room.
  const changes =
    draft && original && !isNew
      ? setupChanges(original, {
          ...draft,
          room_name: draft.room_name.trim(),
          zones: draft.zones.map((z) => ({ ...z, name: z.name.trim() })),
          plumbing: asksPlumbing && plumbing ? plumbing : original.plumbing,
        })
      : [];
  // The room as it will be saved: what a new room's review shows, and an existing room's on request.
  const wholeRoom = (
    <>
      {isNew && <h3>{draft?.room_name}</h3>}
      <p>
        {activeZones.length} active zones · {archivedZones.length} archived zones
      </p>
      {asksPlumbing && isPlumbingLayout(plumbing) && (
        <div className="workspace-message">
          <strong>Plumbing: {PLUMBING_LABELS[plumbing]}</strong>
          <p className="mapping-id">
            {[draft?.hardware.pump_switch, draft?.hardware.main_line_switch]
              .filter(Boolean)
              .join(" → ") || "No pump or main-line valve: each zone is its one switch."}
          </p>
        </div>
      )}
      {reservoirFields.some(([key]) => draft?.hardware[key]) && (
        <div className="workspace-message">
          <strong>Reservoir & dosers</strong>
          <p className="mapping-id">
            {reservoirFields
              .filter(([key]) => draft?.hardware[key])
              .map(([key, label]) => `${label}: ${draft?.hardware[key]}`)
              .join(" · ")}
          </p>
        </div>
      )}
      {activeZones.map((z) => (
        <div className="workspace-message" key={z.id}>
          <strong>
            {z.name} · ID {z.id}
          </strong>
          <p className="mapping-id">{z.valve}</p>
          <p>
            {z.vwc_sensors.length} VWC probes · {z.ec_sensors.length} EC probes
          </p>
          <p>
            {z.plant_count} plants × {reviewValue(z.substrate_volume ?? NaN, "substrate_volume")} ·{" "}
            {z.drippers_per_plant} drippers per plant ×{" "}
            {reviewValue(z.dripper_flow_rate ?? NaN, "dripper_flow_rate")}
          </p>
        </div>
      ))}
    </>
  );
  async function save() {
    if (!draft || !review) return;
    setBusy(true);
    setError("");
    try {
      const result = await controller.operator<{ entry_id: string }>(
        review === "remove" ? "setup_remove" : isNew ? "setup_create" : "setup_save",
        review === "remove"
          ? {
              entry_id: draft.entry_id,
              expected_revision: draft.revision,
              confirm_name: confirmName,
            }
          : {
              entry_id: draft.entry_id,
              expected_revision: draft.revision,
              room_name: draft.room_name,
              active: draft.active,
              zones: draft.zones,
              hardware: draft.hardware,
              ...(asksPlumbing && plumbing ? { plumbing } : {}),
            },
      );
      setReview(null);
      await load(result.entry_id);
      await controller.refresh();
      setNotice(
        review === "remove"
          ? "Room archived. Its identifiers and stored configuration are retained."
          : "Configuration saved in Home Assistant. Controller discovery and acknowledgement may follow on its next refresh; keep watering off until verified.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const engineConfig = Object.values(controller.states).find(
    (e) => e.entity_id.endsWith("engine_config") && e.attributes.prefix === draft?.prefix,
  );
  const heartbeat = Object.values(controller.states).find(
    (e) => e.entity_id === "sensor.crop_steering_" + draft?.prefix + "ai_heartbeat",
  );
  const confirmedRevision = Number(heartbeat?.attributes.setup_revision);
  const mappingConfirmed =
    !isNew && draft && Number.isFinite(confirmedRevision) && confirmedRevision >= draft.revision;
  return (
    <>
      <Heading
        title="Rooms & hardware"
        action={
          <Button
            disabled={!data?.capabilities.create || dirty || busy || !connected}
            onClick={addRoom}
          >
            <Plus size={16} />
            Add room
          </Button>
        }
      />
      {error && (
        <div className="workspace-message error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="workspace-message" role="status">
          {notice}
        </div>
      )}
      {!data ? (
        <>
          <section className="panel workspace-card">
            <Empty
              title={busy ? "Reading setup" : "Setup service unavailable"}
              detail="Connect as a Home Assistant administrator and install the current integration. Older installations need an update before room management is available."
              action={
                <Button disabled={busy || !connected} onClick={() => void load()}>
                  <RefreshCw size={16} />
                  Retry setup
                </Button>
              }
            />
          </section>
        </>
      ) : (
        <>
          <section className="panel workspace-card workspace-section-heading">
            <div className="setup-room-select">
              <Label htmlFor="setup-room">Room configuration</Label>
              <select
                id="setup-room"
                disabled={busy || dirty}
                value={isNew ? "new" : draft?.entry_id || ""}
                onChange={(e) => selectRoom(data.rooms.find((r) => r.entry_id === e.target.value))}
              >
                {isNew && <option value="new">New room</option>}
                {!data.rooms.length && !isNew && <option value="">No rooms configured</option>}
                {data.rooms.map((r) => (
                  <option key={r.entry_id} value={r.entry_id}>
                    {r.room_name}
                    {!r.active ? " (archived)" : ""}
                  </option>
                ))}
              </select>
              {dirty && <small className="muted">Save or discard before switching rooms.</small>}
            </div>
            <div className="workspace-actions">
              <Button
                variant="outline"
                disabled={!dirty || busy}
                onClick={() => {
                  if (isNew) selectRoom(data.rooms[0]);
                  else selectRoom(original || undefined);
                }}
              >
                Discard draft
              </Button>
              <Button variant="outline" disabled={dirty || busy} onClick={() => void load()}>
                <RefreshCw size={16} />
                Reload
              </Button>
              <Button
                disabled={!draft || !dirty || !!errors.length || busy || !connected}
                onClick={() => setReview("save")}
              >
                Review configuration
              </Button>
            </div>
          </section>
          {!draft ? (
            <Empty
              title="Create your first room"
              detail="Add a room and map devices that already exist in Home Assistant."
              action={<Button onClick={addRoom}>Add room</Button>}
            />
          ) : (
            <>
              {!draft.active && (
                <div className="workspace-message">
                  This room is archived. Existing entities and history are retained.{" "}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setDraft({ ...draft, active: true })}
                  >
                    <RotateCcw size={15} />
                    Restore room
                  </Button>
                </div>
              )}
              <section className="panel workspace-card">
                <div className="workspace-section-heading">
                  <div>
                    <h2>Room identity & readiness</h2>
                    <p className="muted">
                      Room labels can change. Existing controller identifiers stay stable.
                    </p>
                  </div>
                  {!isNew && (
                    <Pill dot tone={mappingConfirmed ? "on" : "warn"}>
                      {mappingConfirmed
                        ? "Mapping acknowledged"
                        : "Controller acknowledgement pending"}
                    </Pill>
                  )}
                </div>
                <div className="workspace-form-grid">
                  <div>
                    <Label htmlFor="room-name">Room name</Label>
                    <Input
                      id="room-name"
                      value={draft.room_name}
                      disabled={busy}
                      onChange={(e) => setDraft({ ...draft, room_name: e.target.value })}
                      placeholder="Flower room"
                    />
                  </div>
                  <div>
                    <span className="mapping-label">Configuration</span>
                    <p>
                      {isNew
                        ? "New namespace generated on creation"
                        : "Revision " + draft.revision + " · " + (draft.prefix || "Default room")}
                    </p>
                    <Pill dot tone={engineConfig ? "on" : "warn"}>
                      {engineConfig ? "Room descriptor discovered" : "Awaiting room descriptor"}
                    </Pill>
                  </div>
                </div>
                {!isNew && !draft.safety.ready && (
                  <div className="workspace-message">
                    {draft.safety.blockers.map((b) => (
                      <p key={b}>{b}</p>
                    ))}
                    <p>
                      Mapping writes are checked again on the server. Switch watering off and verify
                      the mapped hardware is off before saving.
                    </p>
                    <WateringPower controller={controller} />
                  </div>
                )}
              </section>
              <section className="panel workspace-card">
                <div className="workspace-section-heading">
                  <div>
                    <h2>Shared room hardware</h2>
                    <p className="muted">
                      How the room is plumbed, then the switches that go with it. Click a part to
                      map it.
                    </p>
                  </div>
                </div>
                {asksPlumbing && (
                  <div className="setup-plumbing">
                    <Label htmlFor="room-plumbing">How is this room plumbed?</Label>
                    <select
                      id="room-plumbing"
                      disabled={busy}
                      value={isPlumbingLayout(plumbing) ? plumbing : ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          plumbing: e.target.value,
                          hardware: hardwareForLayout(e.target.value, draft.hardware),
                        })
                      }
                    >
                      {!isPlumbingLayout(plumbing) && <option value="">Choose…</option>}
                      {(Object.keys(PLUMBING_LAYOUTS) as PlumbingLayout[]).map((name) => (
                        <option key={name} value={name}>
                          {PLUMBING_LABELS[name]}
                        </option>
                      ))}
                    </select>
                    <small className="muted">
                      {isPlumbingLayout(plumbing)
                        ? PLUMBING_HINTS[plumbing]
                        : "If water only comes out while a pump is running, the room has a pump."}{" "}
                      The switches below have to match this, and a room whose switches stop matching
                      is held rather than watered with the valve open and no pump.
                    </small>
                    {!plumbingConfirmed && isPlumbingLayout(plumbing) && (
                      <div className="workspace-message">
                        <p>
                          This room was set up before it could say how it is plumbed. Its saved
                          switches imply <strong>{PLUMBING_LABELS[plumbing]}</strong>. Until that is
                          confirmed, the controller goes on working it out from whichever switches
                          are mapped.
                        </p>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => setDraft({ ...draft, plumbing })}
                        >
                          <Check size={15} />
                          Confirm this plumbing
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <PlumbingDiagram draft={draft} plumbing={plumbing} />
                <div className="workspace-form-grid">
                  {hardwareFields
                    .filter(([key]) => plumbingUses(plumbing, key))
                    .map(([key, label, kind]) => (
                      <MappingPicker
                        key={key}
                        label={label}
                        values={
                          typeof draft.hardware[key] === "string"
                            ? [String(draft.hardware[key])]
                            : []
                        }
                        candidates={candidates(kind)}
                        disabled={busy}
                        onChange={(values) =>
                          setDraft({
                            ...draft,
                            hardware: { ...draft.hardware, [key]: values[0] || "" },
                          })
                        }
                      />
                    ))}
                </div>
              </section>
              <section className="panel workspace-card" data-setup-reservoir>
                <div className="workspace-section-heading">
                  <div>
                    <h2>Reservoir & dosers</h2>
                    <p className="muted">
                      For nutrient batches, run from Feed → Reservoir. The level sensor reads the
                      distance down to the water; each doser is the switch that powers it. Leave
                      them empty if the controller app does not mix this room's feed.
                    </p>
                  </div>
                </div>
                <div className="workspace-form-grid">
                  {reservoirFields.map(([key, label, kind]) => (
                    <MappingPicker
                      key={key}
                      label={label}
                      values={
                        typeof draft.hardware[key] === "string" ? [String(draft.hardware[key])] : []
                      }
                      candidates={candidates(kind)}
                      disabled={busy}
                      onChange={(values) =>
                        setDraft({
                          ...draft,
                          hardware: { ...draft.hardware, [key]: values[0] || "" },
                        })
                      }
                    />
                  ))}
                </div>
              </section>
              <section className="panel workspace-card">
                <div className="workspace-section-heading">
                  <div>
                    <h2>Zones & sensor mapping</h2>
                    <p className="muted">
                      Each zone has its own valve, probes and delivery sizing. Archived IDs are
                      never renumbered.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      Math.max(0, ...draft.zones.map((z) => z.id)) >= (data.limits.max_zones || 24)
                    }
                    onClick={() => {
                      const id = Math.max(0, ...draft.zones.map((z) => z.id)) + 1;
                      setDraft({ ...draft, zones: [...draft.zones, newZone(id)] });
                    }}
                  >
                    <Plus size={16} />
                    Add zone
                  </Button>
                </div>
                <div className="setup-zones">
                  {activeZones.map((zone) => (
                    <section className="setup-zone" key={zone.id}>
                      <div className="workspace-section-heading">
                        <div>
                          <span className="eyebrow">Zone ID {zone.id}</span>
                          <Input
                            aria-label={"Zone " + zone.id + " name"}
                            value={zone.name}
                            disabled={busy}
                            onChange={(e) => editZone(zone.id, { name: e.target.value })}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => editZone(zone.id, { active: false })}
                        >
                          <Trash2 size={15} />
                          Remove zone
                        </Button>
                      </div>
                      <div className="workspace-form-grid">
                        <MappingPicker
                          label={zone.name + " valve"}
                          values={[zone.valve]}
                          candidates={candidates("switch")}
                          disabled={busy}
                          onChange={(v) => editZone(zone.id, { valve: v[0] || "" })}
                        />
                        <MappingPicker
                          label={zone.name + " VWC probes"}
                          values={zone.vwc_sensors}
                          multiple
                          candidates={candidates("vwc")}
                          disabled={busy}
                          onChange={(v) => editZone(zone.id, { vwc_sensors: v })}
                        />
                        <MappingPicker
                          label={zone.name + " EC probes"}
                          values={zone.ec_sensors}
                          multiple
                          candidates={candidates("ec")}
                          disabled={busy}
                          onChange={(v) => editZone(zone.id, { ec_sensors: v })}
                        />
                      </div>
                      <div className="workspace-form-grid sizing-grid">
                        {(
                          [
                            "plant_count",
                            "substrate_volume",
                            "drippers_per_plant",
                            "dripper_flow_rate",
                          ] as const
                        ).map((key) =>
                          key === "substrate_volume" || key === "dripper_flow_rate" ? (
                            <SizingField
                              key={key}
                              id={"zone-" + zone.id + "-" + key}
                              sizingKey={key}
                              value={zone[key] ?? NaN}
                              disabled={busy}
                              onChange={(metric) => editZone(zone.id, { [key]: metric })}
                            />
                          ) : (
                            <div key={key}>
                              <Label htmlFor={"zone-" + zone.id + "-" + key}>
                                {key === "plant_count" ? "Plants" : "Drippers per plant"}
                              </Label>
                              <Input
                                id={"zone-" + zone.id + "-" + key}
                                type="number"
                                min={1}
                                max={key === "plant_count" ? 1000 : 20}
                                step={1}
                                disabled={busy}
                                value={Number.isFinite(zone[key]) ? zone[key] : ""}
                                onChange={(e) =>
                                  editZone(zone.id, {
                                    [key]: e.target.value === "" ? NaN : Number(e.target.value),
                                  })
                                }
                              />
                            </div>
                          ),
                        )}
                      </div>
                      <div className="workspace-form-grid sizing-helpers">
                        <SubstratePresetPicker
                          key={draft.entry_id + ":" + zone.id}
                          id={"zone-" + zone.id + "-substrate-preset"}
                          volumeFieldId={"zone-" + zone.id + "-substrate_volume"}
                          litres={zone.substrate_volume ?? NaN}
                          disabled={busy}
                          onPick={(litres) => editZone(zone.id, { substrate_volume: litres })}
                        />
                      </div>
                      {(!zone.vwc_sensors.length || !zone.ec_sensors.length) && (
                        <p className="small muted">
                          Missing probes: automatic feedback steering needs valid readings. No
                          sensor is selected automatically.
                        </p>
                      )}
                    </section>
                  ))}
                </div>
                {!!archivedZones.length && (
                  <details className="archived-zones">
                    <summary>
                      {archivedZones.length} archived zone{archivedZones.length === 1 ? "" : "s"}
                    </summary>
                    {archivedZones.map((z) => (
                      <div className="workspace-section-heading" key={z.id}>
                        <span>
                          {z.name} · ID {z.id}
                        </span>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => editZone(z.id, { active: true })}
                        >
                          <RotateCcw size={15} />
                          Restore zone
                        </Button>
                      </div>
                    ))}
                  </details>
                )}
              </section>
              {!!errors.length && (
                <div className="workspace-message error">
                  <strong>Before saving</strong>
                  <ul>
                    {errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!isNew && draft.active && original && (
                <RoomTests
                  key={draft.entry_id}
                  controller={controller}
                  zones={original.zones
                    .filter((z) => z.active)
                    .map((z) => ({
                      id: z.id,
                      name: z.name,
                      plants: z.plant_count,
                      drippers: z.drippers_per_plant ?? NaN,
                      flowLph: z.dripper_flow_rate ?? NaN,
                    }))}
                  why={
                    !connected
                      ? "Connect to Home Assistant to run a test."
                      : draft.prefix !== controller.room.room.prefix
                        ? `A test runs in the room on show: choose ${draft.room_name} in the rooms list (or its chip) to test it.`
                        : dirty
                          ? "Save or discard your changes first: a test runs on the saved configuration."
                          : null
                  }
                />
              )}
              {!isNew && draft.active && (
                <section className="panel workspace-card workspace-section-heading">
                  <div>
                    <h2>Remove this room</h2>
                    <p className="muted">
                      Archive the room while retaining its identifiers and configuration. Watering
                      and the hardware must be off.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy || dirty}
                    onClick={() => {
                      setConfirmName("");
                      setReview("remove");
                    }}
                  >
                    <Trash2 size={15} />
                    Archive room
                  </Button>
                </section>
              )}
            </>
          )}
        </>
      )}
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null);
        }}
      >
        <DialogContent className="plan-review-dialog">
          <DialogHeader>
            <DialogTitle>
              {review === "remove"
                ? "Archive " + draft?.room_name + "?"
                : "Review room configuration"}
            </DialogTitle>
            <DialogDescription>
              {review === "remove"
                ? "This removes the room from active control while preserving its identifiers and stored configuration."
                : isNew
                  ? "Only the selected room configuration is changed. Watering is not switched on and no valve is actuated."
                  : "Saving reloads this room in Home Assistant for a moment. Watering is not switched on and no valve is actuated."}
            </DialogDescription>
          </DialogHeader>
          {review === "remove" ? (
            <div>
              <Label htmlFor="confirm-room-name">Type the room name to confirm</Label>
              <Input
                id="confirm-room-name"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
              />
            </div>
          ) : isNew ? (
            <div className="plan-review-zones">{wholeRoom}</div>
          ) : (
            <div className="plan-review-zones">
              <h3>{draft?.room_name}</h3>
              {changes.length ? (
                <>
                  <div className="workspace-message">
                    <strong>
                      {changes.length} change{changes.length === 1 ? "" : "s"}
                    </strong>
                    <ul className="setup-review-changes">
                      {changes.map((line) => (
                        <li key={line}>{line.charAt(0).toUpperCase() + line.slice(1)}</li>
                      ))}
                    </ul>
                  </div>
                  <p className="muted">Everything else in the room stays as it is.</p>
                </>
              ) : (
                <p>Nothing in the room changes.</p>
              )}
              <details className="setup-review-room">
                <summary>The whole room as it will be saved</summary>
                {wholeRoom}
              </details>
            </div>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setReview(null)}>
              Back to editing
            </Button>
            <Button
              variant={review === "remove" ? "destructive" : "default"}
              disabled={
                busy || !connected || (review === "remove" && confirmName !== draft?.room_name)
              }
              onClick={() => void save()}
            >
              {busy ? "Saving…" : review === "remove" ? "Archive room" : "Save configuration"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
