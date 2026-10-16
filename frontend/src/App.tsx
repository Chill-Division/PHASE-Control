import { useEffect, useRef, useState } from "react";
import {
  CalendarRange,
  ChartNoAxesCombined,
  ArrowUpRight,
  Beaker,
  ChevronRight,
  CircleHelp,
  House,
  Menu,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useController } from "@/lib/use-controller";
import { useHaTheme } from "@/lib/ha-theme";
import { useHaShell } from "@/lib/ha-shell";
import { errorText } from "@/lib/utils";
import { descriptor, roomIsActive, runningVersions } from "@/lib/model";
import { RESERVOIR_KEYS } from "@/lib/feed";
import { RoomOffBanner } from "@/components/room-controls";
import { ActivityPanel } from "@/components/activity-panel";
import { StatusLines } from "@/components/status-line";
import { WaterViewProvider } from "@/lib/water-view";
import { WhatsNewOnUpdate } from "@/components/whats-new";
import { Tour } from "@/components/tour";
import { BrandGlyph } from "@/components/brand-glyph";
import { tourSteps } from "@/lib/tour";
import { time, type Page } from "@/components/dashboard";
import { Overview } from "@/pages/overview";
import { Strategy, type Drafts } from "@/pages/strategy";
import { ActivityPage } from "@/pages/activity";
import { Settings } from "@/pages/settings";
import { Help } from "@/pages/help";
import { GrowPlanner } from "@/pages/grow-planner";
import { Setup } from "@/pages/setup";
import { Insights } from "@/pages/insights";
import { Water } from "@/pages/water";
import { Comparison } from "@/pages/comparison";
import { StockTanks } from "@/pages/stock";
import { Reservoir } from "@/pages/reservoir";

/** The menu: six sections, each one page or a few tabs. A tab is a page with its own address. */
const sections = [
  { id: "overview", label: "Overview", icon: House, tabs: [{ id: "overview", label: "Overview" }] },
  {
    id: "plan",
    label: "Irrigation strategy",
    icon: CalendarRange,
    tabs: [
      { id: "strategy", label: "Today" },
      { id: "grow-plan", label: "Schedule" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    icon: ChartNoAxesCombined,
    tabs: [
      { id: "insights", label: "Zone" },
      { id: "water", label: "Water" },
      { id: "compare", label: "Compare runs" },
      { id: "activity", label: "Activity" },
    ],
  },
  {
    id: "feed",
    label: "Feed",
    icon: Beaker,
    tabs: [
      { id: "reservoir", label: "Reservoir" },
      { id: "stock", label: "Stock tanks" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings2,
    tabs: [
      { id: "settings", label: "General" },
      { id: "setup", label: "Rooms & hardware" },
    ],
  },
  { id: "help", label: "Help", icon: CircleHelp, tabs: [{ id: "help", label: "Help" }] },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: typeof House;
  tabs: readonly { id: Page; label: string }[];
}[];
type Section = (typeof sections)[number];
const sectionOf = (page: Page): Section =>
  sections.find((section) => section.tabs.some((tab) => tab.id === page)) ?? sections[0];
function readPage(): Page {
  const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return sections.some((section) => section.tabs.some((tab) => tab.id === hash))
    ? (hash as Page)
    : "overview";
}
export default function App() {
  const controller = useController();
  const [page, setPage] = useState<Page>(readPage);
  const [mobile, setMobile] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [zoneId, setZoneId] = useState<number | undefined>();
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  // The first-run tour's stop on show; null while it is not.
  const [tour, setTour] = useState<number | null>(null);
  const theme = useHaTheme();
  const haShell = useHaShell();
  const pageRef = useRef(page);
  const dirtyRef = useRef(false);
  dirtyRef.current = Object.keys(drafts).length > 0 || workspaceDirty;
  pageRef.current = page;
  function confirmNavigation(action: () => void) {
    if (dirtyRef.current) setPending(() => action);
    else action();
  }
  function navigate(next: Page, nextZone?: number) {
    if (next === page && nextZone === undefined) {
      setMobile(false);
      return;
    }
    confirmNavigation(() => {
      setPage(next);
      setZoneId(nextZone);
      window.history.pushState(null, "", `#/${next}`);
      setMobile(false);
      window.scrollTo({ top: 0 });
    });
  }
  useEffect(() => {
    const hashChange = () => {
      const next = readPage();
      if (next === pageRef.current) return;
      if (dirtyRef.current) {
        window.history.replaceState(null, "", `#/${pageRef.current}`);
        setPending(() => () => {
          setPage(next);
          window.history.pushState(null, "", `#/${next}`);
        });
      } else {
        setPage(next);
        setZoneId(undefined);
      }
    };
    window.addEventListener("hashchange", hashChange);
    window.addEventListener("popstate", hashChange);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("hashchange", hashChange);
      window.removeEventListener("popstate", hashChange);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  const section = sectionOf(page);
  // A room without a reservoir has no Reservoir tab: Feed opens on its stock tanks.
  const reservoirMapped = RESERVOIR_KEYS.some(
    (key) => descriptor(controller.states, controller.room.room)?.attributes?.[key],
  );
  const tabsOf = (item: Section) =>
    item.tabs.filter((tab) => tab.id !== "reservoir" || reservoirMapped || page === "reservoir");
  const tab = section.tabs.find((item) => item.id === page);
  const pageLabel =
    section.tabs.length > 1 && tab ? `${section.label} › ${tab.label}` : section.label;
  useEffect(() => {
    document.title = `${pageLabel} · ${controller.room.room.name} · PHASE Control`;
  }, [pageLabel, controller.room.room.name]);
  async function refresh() {
    setRefreshing(true);
    setRefreshError("");
    try {
      await controller.refresh();
    } catch (error) {
      setRefreshError(errorText(error));
    } finally {
      setRefreshing(false);
    }
  }
  const versions = runningVersions(controller.states, controller.room.room);
  const sidebar = (variant: string) => (
    <>
      <a
        href="#/overview"
        className="brand"
        onClick={(event) => {
          event.preventDefault();
          navigate("overview");
        }}
      >
        <span className="brand-mark">
          <BrandGlyph />
        </span>
        <span>
          <span className="brand-name">
            <b>PHASE</b> Control
          </span>
          <small>Crop steering</small>
        </span>
      </a>
      <div className="room-selector">
        <label htmlFor={variant + "-room"}>Room</label>
        <select
          id={variant + "-room"}
          value={controller.roomId}
          disabled={!controller.rooms.length}
          onChange={(event) => {
            const id = event.target.value;
            confirmNavigation(() => {
              setDrafts({});
              setZoneId(undefined);
              controller.changeRoom(id);
              setMobile(false);
            });
          }}
        >
          {!controller.roomId && (
            <option value="" disabled>
              {controller.rooms.length ? "Room unavailable - choose a room" : "No room discovered"}
            </option>
          )}
          {controller.rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
              {roomIsActive(controller.states, room) ? "" : " · off"}
            </option>
          ))}
        </select>
        <span>
          <span className={`connection-dot ${controller.connection}`} />
          {controller.demo ? "Isolated demo data" : "Home Assistant controller"}
        </span>
      </div>
      <nav aria-label="Main navigation">
        {sections.map((item) => (
          <button
            key={item.id}
            className={`${section.id === item.id ? "active" : ""} ${item.id === "settings" ? "nav-separated" : ""}`}
            aria-current={section.id === item.id ? "page" : undefined}
            onClick={() =>
              section.id === item.id ? setMobile(false) : navigate(tabsOf(item)[0].id)
            }
          >
            <item.icon size={19} />
            <span>{item.label}</span>
            {item.id === "plan" && Object.keys(drafts).length > 0 && (
              <i className="nav-draft-count">{Object.keys(drafts).length}</i>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        {haShell.available && (
          <Button
            variant="outline"
            onClick={() => {
              setMobile(false);
              haShell.toggle();
            }}
          >
            <House size={17} /> Home Assistant
          </Button>
        )}
        {!controller.demo && (
          <dl
            className="sidebar-versions"
            aria-label="Running versions"
            title="Reported by the running integration and controller, not by this page"
          >
            <div>
              <dt>Integration</dt>
              <dd>{versions.integration ?? "not reported"}</dd>
            </div>
            <div>
              <dt>Controller</dt>
              <dd>{versions.controller ?? "not reported"}</dd>
            </div>
          </dl>
        )}
      </div>
    </>
  );
  const shell = (
    <div className="app-shell">
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="desktop-sidebar">{sidebar("desktop")}</aside>
      <Sheet open={mobile} onOpenChange={setMobile}>
        <SheetContent side="left" className="mobile-sidebar">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Choose a room or dashboard page.</SheetDescription>
          </SheetHeader>
          {sidebar("mobile")}
        </SheetContent>
      </Sheet>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <Button
              className="mobile-menu"
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </Button>
            <span>{controller.room.room.name}</span>
            <ChevronRight size={14} />
            <strong>{pageLabel}</strong>
          </div>
          <div className="connection-info">
            <span className={`connection-label ${controller.connection}`}>
              <span className={`connection-dot ${controller.connection}`} />
              {controller.connection === "live"
                ? "Connected"
                : controller.connection === "demo"
                  ? "Demo mode"
                  : controller.connection === "connecting"
                    ? "Connecting…"
                    : "Offline"}
            </span>
            <span className="last-updated">Updated {time(controller.lastUpdated)}</span>
            <ActivityPanel controller={controller} openLog={() => navigate("activity")} />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh controller data"
              disabled={refreshing || controller.connection === "connecting"}
              onClick={refresh}
            >
              <RefreshCw size={17} className={refreshing ? "spin" : ""} />
            </Button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="main-inner">
            {controller.demo && (
              <div className="demo-banner">
                <span>
                  <strong>Demo data</strong> · Explore sample readings and try settings safely.
                  Changes stay in memory.
                </span>
                <span>No live equipment connected</span>
              </div>
            )}
            {(controller.connection === "offline" || controller.error || refreshError) && (
              <div className="connection-banner" role="alert">
                <div>
                  <strong>
                    {controller.connection === "offline"
                      ? "Controller disconnected"
                      : "Connection needs attention"}
                  </strong>
                  <p>
                    {refreshError ||
                      controller.error ||
                      "Live updates are unavailable. Connect Home Assistant to continue."}
                    {controller.lastUpdated && controller.connection === "offline"
                      ? " Displayed values are the last received readings."
                      : ""}
                  </p>
                </div>
                {page !== "settings" && (
                  <Button variant="outline" onClick={() => navigate("settings")}>
                    Connection settings <ArrowUpRight size={16} />
                  </Button>
                )}
              </div>
            )}
            <StatusLines controller={controller} />
            <RoomOffBanner controller={controller} switchable={page !== "overview"} />
            {page === "overview" && (
              <Overview key={controller.roomId} controller={controller} navigate={navigate} />
            )}
            {tabsOf(section).length > 1 && (
              <div
                className="toolbar section-tabs"
                role="navigation"
                aria-label={`${section.label} views`}
              >
                {tabsOf(section).map((item) => (
                  <Button
                    key={item.id}
                    variant={page === item.id ? "default" : "outline"}
                    aria-current={page === item.id ? "page" : undefined}
                    onClick={() => navigate(item.id)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            )}
            {page === "strategy" && (
              <Strategy
                key={controller.roomId}
                controller={controller}
                drafts={drafts}
                setDrafts={setDrafts}
                selectedZone={zoneId}
              />
            )}
            {page === "grow-plan" && (
              <GrowPlanner
                key={controller.roomId}
                controller={controller}
                onDirtyChange={setWorkspaceDirty}
              />
            )}
            {page === "compare" && (
              <Comparison
                key={controller.roomId}
                controller={controller}
                onDirtyChange={setWorkspaceDirty}
              />
            )}
            {page === "insights" && (
              <Insights key={controller.roomId} controller={controller} navigate={navigate} />
            )}
            {page === "water" && <Water key={controller.roomId} controller={controller} />}
            {page === "setup" && (
              <Setup
                key={controller.roomId}
                controller={controller}
                onDirtyChange={setWorkspaceDirty}
              />
            )}
            {page === "activity" && (
              <ActivityPage key={controller.roomId} controller={controller} />
            )}
            {page === "reservoir" && (
              <Reservoir
                key={controller.roomId}
                controller={controller}
                navigate={navigate}
                onDirtyChange={setWorkspaceDirty}
              />
            )}
            {page === "stock" && (
              <StockTanks key={controller.roomId} controller={controller} navigate={navigate} />
            )}
            {page === "settings" && (
              <Settings
                controller={controller}
                theme={theme.preference}
                setTheme={theme.setPreference}
                themeSource={theme.source}
                embedded={haShell.available}
              />
            )}
            {page === "help" && <Help controller={controller} startTour={() => setTour(0)} />}
          </div>
        </main>
        <footer className="page-footer">
          <span>PHASE Control</span>
          <span>{controller.room.room.name} · Controller-reported data</span>
        </footer>
      </div>
      <WhatsNewOnUpdate controller={controller} onTour={() => setTour(0)} />
      {tour !== null && (
        <Tour
          steps={tourSteps(reservoirMapped)}
          index={tour}
          page={page}
          navigate={navigate}
          onIndex={setTour}
          onClose={() => setTour(null)}
        />
      )}
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved workspace changes?</DialogTitle>
            <DialogDescription>
              You have unsaved changes in {controller.room.room.name}. Leaving this view or changing
              rooms will discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const action = pending;
                setDrafts({});
                setWorkspaceDirty(false);
                dirtyRef.current = false;
                setPending(null);
                action?.();
              }}
            >
              Discard and continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
  return <WaterViewProvider controller={controller}>{shell}</WaterViewProvider>;
}
