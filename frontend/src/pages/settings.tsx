import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Droplets,
  EyeOff,
  LoaderCircle,
  Moon,
  Sprout,
  Sun,
  Monitor,
  Telescope,
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
import { Heading, ReviewDialog, Status } from "@/components/dashboard";
import { Pill, type PillTone } from "@/components/mini-visuals";
import type { Controller } from "@/lib/types";
import { errorText } from "@/lib/utils";
import { RoomPower } from "@/components/room-controls";
import type { ThemePreference, ThemeSource } from "@/lib/ha-theme";
import { defaultRoomChoice, setDefaultRoomChoice } from "@/lib/default-room";
import { useWaterView, type WaterView } from "@/lib/water-view";

/** The connection in the top bar's words, with the colour of its state. */
const CONNECTION: Record<Controller["connection"], { label: string; tone: PillTone }> = {
  live: { label: "Connected", tone: "on" },
  demo: { label: "Demo mode", tone: "warn" },
  connecting: { label: "Connecting…", tone: "warn" },
  offline: { label: "Offline", tone: "off" },
};

export function Settings({
  controller,
  theme,
  setTheme,
  themeSource,
  embedded,
}: {
  controller: Controller;
  theme: ThemePreference;
  setTheme: (value: ThemePreference) => void;
  themeSource: ThemeSource;
  /** Inside Home Assistant, which is the connection: no form to connect with a token. */
  embedded: boolean;
}) {
  const water = useWaterView();
  const [openOn, setOpenOn] = useState(defaultRoomChoice);
  const [waterBusy, setWaterBusy] = useState(false);
  const [waterError, setWaterError] = useState("");
  async function chooseWater(view: WaterView) {
    setWaterBusy(true);
    setWaterError("");
    try {
      await water.setView(view);
    } catch (error) {
      setWaterError(errorText(error));
    } finally {
      setWaterBusy(false);
    }
  }
  const predictions = controller.room.notifyPredictions;
  const [predictBusy, setPredictBusy] = useState(false);
  const [predictError, setPredictError] = useState("");
  async function choosePredictions(include: boolean) {
    if (!predictions.entityId || predictions.enabled === include) return;
    setPredictBusy(true);
    setPredictError("");
    try {
      const result = await controller.write([{ entityId: predictions.entityId, value: include }]);
      if (result.failed.length) setPredictError(result.failed.map((f) => f.reason).join(" "));
    } catch (error) {
      setPredictError(errorText(error));
    } finally {
      setPredictBusy(false);
    }
  }
  const [base, setBase] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [resetDemo, setResetDemo] = useState(false);
  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setConnected(false);
    try {
      await controller.connect(base.trim(), token.trim());
      setToken("");
      setConnected(true);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="Settings" />
      <div className="settings-stack">
        {controller.demo && (
          <section className="panel settings-section">
            <div className="settings-label">
              <h2>Sample workspace</h2>
              <p>
                Synthetic sensor readings, example strategies and historical runs let you explore
                the interface.
              </p>
            </div>
            <div>
              <Button variant="outline" onClick={() => setResetDemo(true)}>
                Reset demo session…
              </Button>
              <p className="small muted mt-3">
                Restore the sample rooms and runs. Saved strategies stay in this browser.
              </p>
            </div>
          </section>
        )}
        {!embedded && (
          <section className="panel settings-section">
            <div className="settings-label">
              <h2>Home Assistant connection</h2>
              <p>
                Use the current Home Assistant session or connect with a long-lived access token.
              </p>
              <Pill
                dot
                tone={CONNECTION[controller.connection].tone}
                data-connection={controller.connection}
              >
                {CONNECTION[controller.connection].label}
              </Pill>
            </div>
            <form onSubmit={connect} className="connection-form">
              <div>
                <Label htmlFor="ha-url">Home Assistant URL</Label>
                <Input
                  id="ha-url"
                  type="url"
                  placeholder="http://homeassistant.local:8123"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                />
                <p className="small muted">
                  Leave blank to use the current origin and available session.
                </p>
              </div>
              <div>
                <Label htmlFor="ha-token">Long-lived access token</Label>
                <Input
                  id="ha-token"
                  type="password"
                  autoComplete="off"
                  placeholder="Paste token for this tab"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <p className="small muted">
                  Kept only for the current tab session. Never added to a URL.
                </p>
              </div>
              {controller.demo && (
                <p className="notice-inline">
                  This tab is in isolated demo mode. Open a copy without the demo parameter to
                  connect to a live controller.
                </p>
              )}
              {(error || controller.error) && (
                <p className="form-error" role="alert">
                  {error || controller.error}
                </p>
              )}
              {connected && controller.connection === "live" && (
                <p className="success-text" role="status">
                  <Check size={16} />
                  Connection verified.
                </p>
              )}
              <div className="form-actions">
                <Button type="submit" disabled={busy || controller.demo}>
                  {busy && <LoaderCircle size={16} className="spin" />}
                  {busy ? "Connecting…" : "Connect"}
                </Button>
                {controller.connection === "live" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      controller.disconnect();
                      setConnected(false);
                    }}
                  >
                    Disconnect this tab
                  </Button>
                )}
              </div>
            </form>
          </section>
        )}
        <section className="panel settings-section">
          <div className="settings-label">
            <h2>Appearance</h2>
            <p>
              {themeSource === "home-assistant"
                ? "Matching your Home Assistant theme, including live changes."
                : theme === "auto"
                  ? "Following your device appearance until embedded in Home Assistant."
                  : theme === "light"
                    ? "Light, the default."
                    : "Dark."}
            </p>
          </div>
          <div className="appearance-options">
            <div className="theme-options" aria-label="Appearance preference">
              {[
                { value: "auto", label: "Home Assistant", icon: Monitor },
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
              ].map((option) => (
                <button
                  key={option.value}
                  className={theme === option.value ? "chosen" : ""}
                  aria-pressed={theme === option.value}
                  onClick={() => setTheme(option.value as ThemePreference)}
                >
                  <option.icon size={20} />
                  <span>{option.label}</span>
                  {theme === option.value && <Check size={16} />}
                </button>
              ))}
            </div>
            {controller.rooms.length > 1 && (
              <div className="default-room">
                <label htmlFor="default-room">
                  <h3>Open on</h3>
                </label>
                <select
                  id="default-room"
                  value={openOn}
                  onChange={(event) => {
                    setOpenOn(event.target.value);
                    setDefaultRoomChoice(event.target.value);
                  }}
                >
                  <option value="">The first room, {controller.rooms[0].name}</option>
                  <option value="last">The room I looked at last</option>
                  {controller.rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
                <p className="small muted mt-3">
                  The room this dashboard opens on, on this device only, like its appearance. A link
                  to a room still opens that room.
                </p>
              </div>
            )}
            <div>
              <h3 id="water-view-label">Water today, shown as</h3>
              <div
                className="theme-options water-view-options"
                role="group"
                aria-labelledby="water-view-label"
              >
                {(
                  [
                    { value: "zone", label: "Zone total", icon: Droplets },
                    { value: "plant", label: "Per plant", icon: Sprout },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    className={water.view === option.value ? "chosen" : ""}
                    aria-pressed={water.view === option.value}
                    disabled={
                      !water.available ||
                      waterBusy ||
                      !["live", "demo"].includes(controller.connection)
                    }
                    onClick={() => void chooseWater(option.value)}
                  >
                    <option.icon size={20} />
                    <span>{option.label}</span>
                    {water.view === option.value && <Check size={16} />}
                  </button>
                ))}
              </div>
              {waterError && (
                <p className="small error-text" role="alert">
                  {waterError}
                </p>
              )}
              <p className="small muted mt-3">
                {water.available
                  ? `For ${controller.room.room.name}: everyone who opens it sees water today this way, and the controller’s vitals notification follows it. `
                  : "This needs the updated PHASE Control integration. "}
                Per plant is each zone’s water today, and its daily limit, divided by its plant
                count from Rooms &amp; hardware, as if every plant got the same. Water use over the
                grow stays in litres per zone.
              </p>
            </div>
          </div>
        </section>
        <section className="panel settings-section">
          <div className="settings-label">
            <h2>Notifications</h2>
            <p>The controller&rsquo;s vitals notification, for {controller.room.room.name}.</p>
          </div>
          <div>
            <h3 id="predictions-label">Include room predictions in informational notifications</h3>
            <div
              className="theme-options water-view-options"
              role="group"
              aria-labelledby="predictions-label"
            >
              {(
                [
                  { value: true, label: "Included", icon: Telescope },
                  { value: false, label: "Left out", icon: EyeOff },
                ] as const
              ).map((option) => (
                <button
                  key={option.label}
                  className={predictions.enabled === option.value ? "chosen" : ""}
                  aria-pressed={predictions.enabled === option.value}
                  disabled={
                    !predictions.entityId ||
                    predictions.enabled === null ||
                    predictBusy ||
                    !["live", "demo"].includes(controller.connection)
                  }
                  onClick={() => void choosePredictions(option.value)}
                >
                  <option.icon size={20} />
                  <span>{option.label}</span>
                  {predictions.enabled === option.value && <Check size={16} />}
                </button>
              ))}
            </div>
            {predictError && (
              <p className="small error-text" role="alert">
                {predictError}
              </p>
            )}
            <p className="small muted mt-3">
              {predictions.entityId
                ? "Under each zone, what the controller will do next, as each zone's Next: line on Overview says it: for example “shot when VWC < 61% (now 58%) · P3 by 22:00”."
                : "This needs the updated PHASE Control integration. Until then the controller includes them."}
            </p>
          </div>
        </section>
      </div>
      {controller.demo && (
        <Dialog open={resetDemo} onOpenChange={setResetDemo}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset demo session?</DialogTitle>
              <DialogDescription>
                Reload the example rooms, sensor readings, run records and planner drafts. Unsaved
                demo work and changes to demo runs or room settings will be lost. Saved strategy
                libraries and live connection data will be kept.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetDemo(false)}>
                Keep exploring
              </Button>
              <Button
                onClick={() => {
                  if (controller.demo) window.location.reload();
                }}
              >
                Reset demo session
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
