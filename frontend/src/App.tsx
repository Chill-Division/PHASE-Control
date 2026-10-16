import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useController } from "@/lib/use-controller";
import { useHaTheme } from "@/lib/ha-theme";
import { useHaShell } from "@/lib/ha-shell";
import { errorText } from "@/lib/utils";
import { descriptor } from "@/lib/model";
import { RESERVOIR_KEYS } from "@/lib/feed";
import { RoomOffBanner } from "@/components/room-controls";
import { StatusLines } from "@/components/status-line";
import { WaterViewProvider } from "@/lib/water-view";
import { WhatsNewOnUpdate } from "@/components/whats-new";
import { Tour } from "@/components/tour";
import { tourSteps } from "@/lib/tour";
import { type Page } from "@/components/dashboard";
import {
  PhoneTabs,
  Rail,
  RoomChips,
  RoomsColumn,
  SectionHeader,
  Utilities,
  type SectionId,
} from "@/components/shell";
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
import { More } from "@/pages/more";

/** The sections, each one page or a few tabs. A tab is a page with its own address. */
const sections = [
  { id: "overview", label: "Overview", tabs: [{ id: "overview", label: "Overview" }] },
  {
    id: "plan",
    label: "Irrigation strategy",
    tabs: [
      { id: "strategy", label: "Today" },
      { id: "grow-plan", label: "Schedule" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
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
    tabs: [
      { id: "reservoir", label: "Reservoir" },
      { id: "recipes", label: "Recipes" },
      { id: "stock", label: "Stock tanks" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    tabs: [
      { id: "settings", label: "General" },
      { id: "setup", label: "Rooms & hardware" },
    ],
  },
  { id: "help", label: "Help", tabs: [{ id: "help", label: "Help" }] },
] as const satisfies readonly {
  id: SectionId;
  label: string;
  tabs: readonly { id: Page; label: string }[];
}[];
type Section = (typeof sections)[number];
const SHARED_DRAFT: readonly Page[] = ["reservoir", "recipes"];
const sectionOf = (page: Page): Section =>
  sections.find((section) => section.tabs.some((tab) => tab.id === page)) ?? sections[0];
function readPage(): Page {
  const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return hash === "more" || sections.some((section) => section.tabs.some((tab) => tab.id === hash))
    ? (hash as Page)
    : "overview";
}
export default function App() {
  const controller = useController();
  const [page, setPage] = useState<Page>(readPage);
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
    if (next === page && nextZone === undefined) return;
    // Feed's Reservoir and Recipes are one draft, saved together: moving between them keeps it.
    const sameDraft = SHARED_DRAFT.includes(page) && SHARED_DRAFT.includes(next);
    (sameDraft ? (action: () => void) => action() : confirmNavigation)(() => {
      setPage(next);
      setZoneId(nextZone);
      window.history.pushState(null, "", `#/${next}`);
      window.scrollTo({ top: 0 });
    });
  }
  function chooseRoom(id: string) {
    if (id === controller.roomId) return;
    confirmNavigation(() => {
      setDrafts({});
      setZoneId(undefined);
      controller.changeRoom(id);
    });
  }
  useEffect(() => {
    const hashChange = () => {
      const next = readPage();
      if (next === pageRef.current) return;
      const sameDraft = SHARED_DRAFT.includes(pageRef.current) && SHARED_DRAFT.includes(next);
      if (dirtyRef.current && !sameDraft) {
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
    item.tabs.filter(
      (tab) => !SHARED_DRAFT.includes(tab.id) || reservoirMapped || SHARED_DRAFT.includes(page),
    );
  const tab = section.tabs.find((item) => item.id === page);
  const pageLabel =
    page === "more"
      ? "More"
      : section.tabs.length > 1 && tab
        ? `${section.label} › ${tab.label}`
        : section.label;
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
  const draftCount = Object.keys(drafts).length;
  const haMenu = haShell.available ? haShell.toggle : null;
  const openSection = (id: SectionId) => {
    const target = sections.find((item) => item.id === id) ?? sections[0];
    if (target.id === section.id && page !== "more") return;
    navigate(tabsOf(target)[0].id);
  };
  const utilities = (
    <Utilities
      controller={controller}
      refresh={refresh}
      refreshing={refreshing}
      openLog={() => navigate("activity")}
    />
  );
  const shell = (
    <div className="app-frame">
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
      <Rail section={section.id} open={openSection} drafts={draftCount} haMenu={haMenu} />
      {controller.rooms.length > 1 && <RoomsColumn controller={controller} choose={chooseRoom} />}
      <div className="app-page">
        <RoomChips controller={controller} choose={chooseRoom} />
        <main id="main-content" tabIndex={-1}>
          <div className="main-inner">
            {page !== "overview" && (
              <SectionHeader
                title={page === "more" ? "More" : section.label}
                tabs={page === "more" ? [] : tabsOf(section)}
                current={page}
                choose={(id) => navigate(id as Page)}
                utilities={utilities}
              />
            )}
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
                      ? "Can’t reach Home Assistant"
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
            <StatusLines
              controller={controller}
              problemsOnly
              skip={page === "overview" ? controller.roomId : null}
            />
            <RoomOffBanner controller={controller} switchable={page !== "overview"} />
            {page === "overview" && (
              <Overview
                key={controller.roomId}
                controller={controller}
                navigate={navigate}
                utilities={utilities}
              />
            )}
            {page === "more" && (
              <More
                controller={controller}
                navigate={navigate}
                startTour={() => setTour(0)}
                haMenu={haMenu}
              />
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
            {(page === "reservoir" || page === "recipes") && (
              <Reservoir
                key={controller.roomId}
                controller={controller}
                navigate={navigate}
                onDirtyChange={setWorkspaceDirty}
                view={page}
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
      </div>
      <PhoneTabs
        section={section.id}
        more={page === "more"}
        open={openSection}
        openMore={() => navigate("more")}
        drafts={draftCount}
      />
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
