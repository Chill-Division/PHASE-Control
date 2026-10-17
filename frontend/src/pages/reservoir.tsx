import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Beaker,
  Check,
  CircleHelp,
  Download,
  GripVertical,
  LoaderCircle,
  Minus,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Empty, Heading, number, ReviewDialog, type Page } from "@/components/dashboard";
import { Pill } from "@/components/mini-visuals";
import {
  canRefill,
  reminderPct,
  documentOf,
  doseOf,
  draftErrors,
  draftOf,
  duration,
  FEED_EC,
  flowOf,
  heldUntil,
  inUse,
  levelPct,
  localDay,
  mappedNumbers,
  MAX_WEEKS,
  moveTo,
  newRecipe,
  NUTRIENT_LINES,
  partMl,
  perLitre,
  pickStage,
  planOf,
  removeSchedule,
  RESERVOIR_KEYS,
  scheduleWeek,
  doserOrder,
  SETTINGS,
  STAGE_NAMES,
  weekStarts,
  type FeedDocument,
  type FeedDraft,
  type FeedPlan,
  type FeedRecipe,
  type FeedSettings,
} from "@/lib/feed";
import {
  lastBatchWords,
  levelMm,
  readBatchStatus,
  STEP_LABELS,
  timeLeft,
  type BatchStatus,
} from "@/lib/feed-status";
import {
  TEMPLATES,
  TEMPLATE_GROUPS,
  exportName,
  exportRecipe,
  importRecipe,
  placeRecipe,
  placedNote,
  type PortableRecipe,
} from "@/lib/feed-library";
import { descriptor } from "@/lib/model";
import type { Controller } from "@/lib/types";
import { errorText } from "@/lib/utils";
import { TankStatus } from "@/components/tank-status";
import "./reservoir.css";

const when = (at: number | null) =>
  at === null
    ? "Never"
    : new Date(at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
const mm = (value: number | null) => (value === null ? "No reading" : `${number(value, 0)} mm`);
const nutrientName = (recipe: FeedRecipe | undefined, doser: number) =>
  recipe?.doses[String(doser)]?.label || `Doser ${doser}`;
const HINTS: Record<keyof FeedSettings, string> = {
  fill_s:
    "How long the fresh-water solenoid runs for a refill. Half-way through, the pump and recirculation start, and the doses go in while it fills.",
  batch_l:
    "The litres that fill adds. The doses are worked out for these: what is left in the reservoir is already mixed.",
  full_mm:
    "The level sensor's distance to the water when the reservoir is full. With the distance when empty, it makes the level a percentage.",
  empty_mm:
    "The level sensor's distance to the water when the reservoir is empty. 0 means no level: no automatic refills, no minimum.",
  min_pct:
    "A refill comes before any shot would take the reservoir under this; without automatic refills, watering waits here. 0 turns it off.",
  remind_pct:
    "Without automatic refills, a notification to refill the reservoir by hand once it gets this low, and again each day it stays there. 0 turns it off.",
  pause_s:
    "A gap before the first doser, once the pump runs, and between one doser and the next, so each mixes in before the next goes in.",
  mix_s:
    "The least the pump and recirculation run after the last dose. Normally the fill is still going, and they run until it ends.",
};

/** `text` downloaded as the file `name`. */
function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Seconds that tick while a step counts down. */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** The reservoir drawn as a vessel: the water as full as it reads, its minimum dashed across. */
function Vessel({
  pct,
  min,
  remind,
}: {
  pct: number | null;
  min: number | null;
  /** The level a person is reminded to refill it by hand at (reminderPct), or null. */
  remind: number | null;
}) {
  const clip = useId();
  const markSet = min !== null && min > 0;
  const y = (level: number) => 99 - (98 * Math.min(Math.max(level, 0), 100)) / 100;
  const low = pct !== null && markSet && pct < min;
  return (
    <svg
      className="res-vessel"
      viewBox="0 0 60 100"
      role="img"
      aria-label={
        pct === null
          ? "No level reading"
          : `The reservoir is ${number(pct, 0)}% full${markSet ? `; it keeps at least ${number(min, 0)}%` : ""}${remind !== null ? `; a reminder to refill it comes at ${number(remind, 0)}%` : ""}`
      }
      data-low={low ? "" : undefined}
    >
      <defs>
        <clipPath id={clip}>
          <rect x="1" y="1" width="58" height="98" rx="8" />
        </clipPath>
      </defs>
      <rect x="1" y="1" width="58" height="98" rx="8" className="res-shell" />
      {pct !== null && (
        <g clipPath={`url(#${clip})`}>
          <rect x="1" y={y(pct)} width="58" height={99 - y(pct)} className="res-water" />
        </g>
      )}
      {markSet && <path d={`M1 ${y(min)} H59`} className="res-mark" />}
      {remind !== null && <path d={`M1 ${y(remind)} H59`} className="res-remind-mark" />}
    </svg>
  );
}

type StepState = "done" | "now" | "next";
interface Stage {
  key: string;
  label: string;
  detail: string;
  state: StepState;
}
interface Steps {
  fill: Stage;
  /** The fill's second half, the pump and recirculation running: the doses go in during it. */
  fillMix: Stage;
  doses: Stage[];
  /** How long the doses take once the pump runs: a pause before the first and between each. */
  dosing: number;
  /** Recirculating after the last dose, when that outlasts the fill; null when it ends with it. */
  mix: Stage | null;
}
/** A refill's steps: the fill, then the fill's mixing half with each dose going in during it, and,
 * when the doses outlast the fill, recirculating after the last. Running, each is done, now or next.
 * An older controller's "settling" reads as the fill's mixing half; one that reports no fill_until
 * stopped the fresh water before the first dose. */
function stepsOf(plan: FeedPlan, status: BatchStatus | null): Steps {
  const running = status?.step && status.step !== "idle" ? status : null;
  const doses = running?.doses.length
    ? running.doses
    : plan.doses.map((d) => ({ ...d, dosed: null }));
  const step = running?.step === "settling" ? "filling_mixing" : running?.step;
  const before = !running || step === "filling" || step === "filling_mixing";
  const given = doses.filter((dose) => dose.seconds > 0);
  const dosing =
    given.reduce((sum, dose) => sum + dose.seconds, 0) + given.length * (plan.pause_s || 0);
  const fits = dosing + (plan.mix_s || 0) <= plan.fill_s / 2;
  return {
    fill: {
      key: "fill",
      label: "Fill",
      detail: duration(plan.fill_s / 2),
      state: !running ? "next" : step === "filling" ? "now" : "done",
    },
    fillMix: {
      key: "fill-mix",
      label: "Fill and mix",
      detail: duration(plan.fill_s / 2),
      state:
        !running || step === "filling"
          ? "next"
          : step === "filling_mixing" || running.fillUntil !== null
            ? "now"
            : "done",
    },
    doses: doses.map((dose) => ({
      key: `dose-${dose.doser}`,
      label: dose.label,
      detail: `${number(dose.ml, 0)} mL · ${duration(dose.seconds)}`,
      state: (before
        ? "next"
        : step === "mixing"
          ? "done"
          : step === "dosing" && running!.doser === dose.doser
            ? "now"
            : dose.dosed !== null
              ? "done"
              : "next") as StepState,
    })),
    dosing,
    mix: fits
      ? null
      : {
          key: "mix",
          label: "Recirculate",
          detail: `${duration(plan.mix_s)} after the last dose`,
          state: step === "mixing" && running!.fillUntil === null ? "now" : "next",
        },
  };
}

function StepItem({ step, children }: { step: Stage; children?: ReactNode }) {
  return (
    <li data-state={step.state} className={children ? "res-steps-group" : undefined}>
      <span className="res-step-dot" aria-hidden="true">
        {step.state === "done" ? <Check size={12} /> : null}
      </span>
      <span className="res-step-label">
        {step.label}
        {step.state === "now" && <span className="sr-only"> (now)</span>}
        {step.state === "done" && <span className="sr-only"> (done)</span>}
      </span>
      <span className="res-step-detail">{step.detail}</span>
      {children}
    </li>
  );
}

function BatchPanel({
  controller,
  doc,
  status,
  level,
  pct,
  mapped,
  refillable,
}: {
  controller: Controller;
  doc: FeedDocument;
  status: BatchStatus | null;
  /** The level sensor's reading in mm: the controller's, or the sensor's own before it reports. */
  level: number | null;
  /** How full the reservoir reads, %: the controller's, or worked out the same way before it reports. */
  pct: number | null;
  mapped: boolean;
  /** It has what a refill needs (canRefill). Without it the panel offers no refill and shows none of
   * one: its level, minimum and whether a shot would wait are what is left. */
  refillable: boolean;
}) {
  const [review, setReview] = useState(false);
  const running = !!status?.step && status.step !== "idle";
  const now = useNow(running);
  const left = running ? timeLeft(status!.until, now) : null;
  const plan = doc.plan;
  const { entityId: autoId, enabled: auto } = controller.room.autoBatches;
  const minimum = plan.min_pct ?? 0;
  const levelSet = (plan.full_mm ?? 0) > 0 && plan.full_mm < plan.empty_mm;
  const due = status?.due ?? (pct === null || minimum <= 0 ? null : pct < minimum);
  // Nothing refills it by itself: a reminder to refill it by hand comes from this level (CS-706).
  const remind = reminderPct(plan.remind_pct, minimum, auto, refillable);
  const soon = remind !== null && pct !== null && pct <= remind;
  const steps = stepsOf(plan, status);
  return (
    <section className="panel res-batch" data-batch-status={status?.step ?? "none"}>
      <div className="res-batch-head">
        <div>
          {/* A room that cannot refill has a reservoir to watch, not batches. */}
          <span className="eyebrow">{refillable ? "Nutrient batch" : "Reservoir"}</span>
          {refillable && (
            <>
              <div className="res-step">
                <strong>{status?.step ? STEP_LABELS[status.step] : "Not reported"}</strong>
                {running && status?.step === "dosing" && status.nutrient && (
                  <span>
                    {status.nutrient} <span className="muted">(doser {status.doser})</span>
                  </span>
                )}
                {left && <Pill tone="water">{left}</Pill>}
              </div>
              <p className="muted small">
                {running
                  ? `${status!.stage ?? "No stage"} refill. Watering in this room waits until it finishes.`
                  : plan.stage
                    ? `Next refill: ${plan.stage}, ${number(plan.batch_l, 1)} L.`
                    : "No feed stage is chosen."}
              </p>
            </>
          )}
        </div>
        <div className="res-batch-actions">
          {/* A refill by hand is a test, out of the way: Settings → Rooms & hardware → Tests. */}
          {refillable && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  window.location.hash = "#/setup?tests";
                }}
              >
                <Beaker size={16} /> Refill by hand…
              </Button>
              <small className="muted">In Settings → Rooms & hardware, under Tests.</small>
            </>
          )}
          {refillable && !running && status?.blocked && (
            <small className="muted">A batch cannot start: {status.blocked}.</small>
          )}
        </div>
      </div>
      {refillable && (
        <ol className="res-steps" aria-label={running ? "This batch's steps" : "What a batch does"}>
          <StepItem step={steps.fill} />
          <StepItem step={steps.fillMix}>
            {!!steps.doses.length && (
              <ol className="res-steps" aria-label="The doses, going in while it fills">
                {steps.doses.map((dose) => (
                  <StepItem key={dose.key} step={dose} />
                ))}
              </ol>
            )}
          </StepItem>
          {steps.mix && <StepItem step={steps.mix} />}
        </ol>
      )}
      {refillable && steps.mix && (
        <p className="muted small">
          The doses take {duration(steps.dosing)}, longer than the fill&rsquo;s mixing half (
          {duration(plan.fill_s / 2)}): the last of them go in after the fresh water stops.
        </p>
      )}
      <div className="res-batch-body">
        <div className="res-level">
          <Vessel pct={pct} min={minimum} remind={remind} />
          <dl className="res-facts">
            <div>
              <dt>Level</dt>
              <dd>
                {pct === null ? (levelSet ? "No reading" : "Not set up") : `${number(pct, 0)}%`}
                <span className="unit"> · {mm(level)} to the water</span>
              </dd>
            </div>
            <div>
              <dt>Minimum</dt>
              <dd>{minimum > 0 ? `${number(minimum, 0)}%` : "Off"}</dd>
            </div>
            {(refillable || !!status?.litresPerPct) && (
              <div>
                <dt>1% holds</dt>
                <dd>
                  {status?.litresPerPct
                    ? `about ${number(status.litresPerPct, 2)} L`
                    : "Not known yet: the first refill shows it"}
                </dd>
              </div>
            )}
            <div>
              <dt>Now</dt>
              <dd>
                {due ? (
                  <Pill tone="warn" dot>
                    Refill due
                  </Pill>
                ) : soon ? (
                  <Pill tone="warn" dot data-refill-soon>
                    Refill soon
                  </Pill>
                ) : due === null ? (
                  <Pill tone="unknown">Unknown</Pill>
                ) : (
                  <Pill tone="on" dot>
                    Enough water
                  </Pill>
                )}
              </dd>
            </div>
          </dl>
        </div>
        {refillable && (
          <div className="res-auto">
            <span className="eyebrow">Automatic refills</span>
            <p>
              {auto === true
                ? !levelSet
                  ? "On, but the reservoir's level is not set up (its distances when full and when empty), so none starts by itself."
                  : minimum <= 0
                    ? "On, but its minimum is 0%, so none starts by itself."
                    : `On: a refill starts by itself when the room's next shots would take the reservoir under its ${number(minimum, 0)}% minimum, three passes in a row.${status && !status.armed ? " Waiting for the reservoir to read enough after the last one." : ""}`
                : auto === false
                  ? minimum > 0 && levelSet
                    ? `Off: refills start only by hand, and watering waits whenever a shot would take the reservoir under its ${number(minimum, 0)}% minimum.`
                    : "Off: refills start only by hand."
                  : "Unavailable: update the PHASE Control integration."}
            </p>
            {autoId && (
              <Button
                variant="outline"
                size="sm"
                disabled={
                  auto === null || !["live", "demo"].includes(controller.connection) || !mapped
                }
                onClick={() => setReview(true)}
              >
                <Sparkles size={15} /> {auto ? "Turn automatic off…" : "Turn automatic on…"}
              </Button>
            )}
          </div>
        )}
        {(refillable || !!status?.last) && (
          <div className="res-last">
            <span className="eyebrow">Last batch</span>
            {status?.last ? (
              <>
                <p>
                  <strong>{status.last.stage ?? "No stage"}</strong>, {when(status.last.at)}{" "}
                  <Pill tone={status.last.result === "done" ? "on" : "warn"}>
                    {status.last.result === "done" ? "Done" : "Stopped"}
                  </Pill>
                </p>
                {status.last.result !== "done" && (
                  <p className="muted small">{status.last.result.replace(/^stopped: /, "")}</p>
                )}
                <p className="muted small">{lastBatchWords(status.last, doc.recipes)}</p>
              </>
            ) : (
              <p className="muted">{status ? "None yet" : "Not reported"}</p>
            )}
          </div>
        )}
      </div>
      {!status && mapped && (
        <p className="workspace-message res-note">
          The controller app has not reported on this reservoir yet. It does once it is running and
          has picked up the reservoir mapped here.
        </p>
      )}
      {autoId && (
        <ReviewDialog
          open={review}
          onOpenChange={setReview}
          controller={controller}
          title={auto ? "Turn automatic refills off?" : "Turn automatic refills on?"}
          items={[
            {
              change: { entityId: autoId, value: !auto },
              label: `${controller.room.room.name} automatic refills`,
              before: auto ? "On" : "Off",
              after: auto ? "Off" : "On",
            },
          ]}
          note={
            auto
              ? "Refills then start only by hand, and watering waits whenever a shot would take the reservoir under its minimum."
              : "The controller app then refills, mixes and doses the reservoir by itself whenever the room's next shots would take it under its minimum. Check the fill time, the fill litres and both distances first."
          }
        />
      )}
    </section>
  );
}

/** The room's dosers, by number, as small cards like the schedule's weeks: what each pumps in the
 * stage in use, and its flow. Each recipe has its own dosing order. */
function DoserFlows({
  draft,
  mapped,
  entities,
  stage,
  onChange,
}: {
  draft: FeedDraft;
  mapped: number[];
  entities: Record<string, string>;
  stage: FeedRecipe | undefined;
  onChange: (next: FeedDraft) => void;
}) {
  const id = useId();
  return (
    <ul className="res-dosers">
      {mapped.map((doser) => {
        const label = stage?.doses[String(doser)]?.label;
        return (
          <li
            key={doser}
            data-doser={doser}
            className="res-doser"
            title={`${entities[String(doser)]}${label ? ` · ${label} in ${stage!.name}` : ""}`}
          >
            <strong>Doser {doser}</strong>
            <small className="muted">
              {label ?? (stage ? `Not in ${stage.name}` : "No stage in use")}
            </small>
            <span className="res-flow">
              <Input
                id={`${id}-flow-${doser}`}
                aria-label={`Doser ${doser} flow, mL per minute`}
                type="number"
                min={1}
                max={10000}
                step={1}
                value={Number.isFinite(flowOf(draft, doser)) ? String(flowOf(draft, doser)) : ""}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    dosers: {
                      ...draft.dosers,
                      [String(doser)]: {
                        flow_ml_min: event.target.value === "" ? NaN : Number(event.target.value),
                      },
                    },
                  })
                }
              />
              <span className="muted small">mL/min</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A number box that shows `value` rounded to `digits` while it is not being typed in, and what is
 * typed while it is. */
function RoundedInput({
  value,
  digits,
  onValue,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: number;
  digits: number;
  onValue: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = Number.isFinite(value) ? String(Number(value.toFixed(digits))) : "";
  return (
    <Input
      {...props}
      type="number"
      value={text ?? shown}
      onFocus={() => setText(shown)}
      onBlur={() => setText(null)}
      onChange={(event) => {
        setText(event.target.value);
        onValue(event.target.value === "" ? NaN : Number(event.target.value));
      }}
    />
  );
}

function RecipeCard({
  draft,
  recipe,
  index,
  rows,
  mapped,
  onChange,
  onRemove,
  listId,
}: {
  draft: FeedDraft;
  recipe: FeedRecipe;
  index: number;
  /** Its dosers in its order, then any other it names. */
  rows: number[];
  mapped: number[];
  onChange: (recipe: FeedRecipe) => void;
  onRemove: () => void;
  listId: string;
}) {
  const id = useId();
  const body = useRef<HTMLTableSectionElement>(null);
  const label = recipe.name || `feed recipe ${index + 1}`;
  const [dragging, setDragging] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  const total = perLitre(recipe);
  const batch = rows.reduce((sum, n) => sum + doseOf(draft, recipe, n).ml, 0);
  const inUse = draft.stage === recipe.id;
  const part = partMl(draft, recipe);
  const fill = draft.batch_l;
  const dose = (n: number) => recipe.doses[String(n)] ?? { label: "", parts: 0 };
  const setDose = (n: number, change: Partial<{ label: string; parts: number }>) =>
    onChange({ ...recipe, doses: { ...recipe.doses, [String(n)]: { ...dose(n), ...change } } });
  // The dosers that dose, in the order they do: each row's turn.
  const turns = rows.filter((n) => dose(n).parts > 0);
  // The help's example: the biggest dose, as parts × 1 part.
  const example = turns
    .filter((n) => dose(n).parts !== 1 && dose(n).label.trim())
    .sort((a, b) => dose(b).parts - dose(a).parts)[0];
  const place = (next: number[], moved: number) => {
    onChange({ ...recipe, order: next });
    setSaid(`Doser ${moved} moved to position ${next.indexOf(moved) + 1} of ${next.length}.`);
  };
  const move = (event: PointerEvent) => {
    if (dragging === null || !body.current) return;
    const items = [...body.current.querySelectorAll<HTMLElement>("[data-dose]")];
    const to = items.filter((row) => {
      if (Number(row.dataset.dose) === dragging) return false;
      const box = row.getBoundingClientRect();
      return event.clientY > box.top + box.height / 2;
    }).length;
    const next = moveTo(rows, rows.indexOf(dragging), to);
    if (next.join() !== rows.join()) place(next, dragging);
  };
  const drop = () => setDragging(null);
  return (
    <fieldset className="panel res-recipe" data-recipe={recipe.name || `recipe-${index + 1}`}>
      <legend className="sr-only">{recipe.name || `Feed recipe ${index + 1}`}</legend>
      <div className="res-recipe-head">
        <div>
          <Label htmlFor={`${id}-name`}>Stage name</Label>
          <Input
            id={`${id}-name`}
            list={`${listId}-stages`}
            value={recipe.name}
            maxLength={40}
            placeholder="Vege, Flower, Fade…"
            onChange={(event) => onChange({ ...recipe, name: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-strength`}>mL per litre per part</Label>
          <RoundedInput
            id={`${id}-strength`}
            min={0}
            max={20}
            step={0.001}
            value={recipe.strength}
            digits={4}
            onValue={(strength) => onChange({ ...recipe, strength })}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-part`}>1 part (mL)</Label>
          <RoundedInput
            id={`${id}-part`}
            min={0}
            step={1}
            value={part}
            digits={1}
            disabled={!(fill > 0)}
            aria-describedby={`${id}-part-help`}
            onValue={(ml) => onChange({ ...recipe, strength: ml / fill })}
          />
        </div>
        <div className="res-recipe-actions">
          {inUse && (
            <Pill tone="on" dot>
              In use
            </Pill>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Export ${label}`}
            title="Export to a recipe file"
            onClick={() => download(exportRecipe(recipe), exportName(recipe))}
          >
            <Download size={16} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      </div>
      <p id={`${id}-part-help`} className="muted small res-part-help">
        {Number.isFinite(part) && fill > 0
          ? `1 part is ${number(part, 0)} mL of nutrient in each ${number(fill, 1)} L fill, so a nutrient gets its parts × ${number(part, 0)} mL${
              example
                ? ` (${dose(example).label.trim()}: ${number(dose(example).parts, 2)} × ${number(part, 0)} = ${number(doseOf(draft, recipe, example).ml, 0)} mL)`
                : ""
            }. Set it here or as mL per litre per part: each sets the other.`
          : "Set the fill litres to see what 1 part is."}
      </p>
      <div className="table-scroll" tabIndex={0} aria-label={`${recipe.name || "Recipe"} doses`}>
        <table className="data-table res-recipe-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Doser</th>
              <th>Nutrient</th>
              <th>Parts</th>
              <th className="numeric">Per batch</th>
              <th className="numeric">Runs</th>
              <th>
                <span className="sr-only">Move</span>
              </th>
            </tr>
          </thead>
          {/* The body, not the handle, holds the pointer while a row is dragged: reordering moves the
              dragged row in the page, which would let go of a pointer its handle held. */}
          <tbody
            ref={body}
            onPointerMove={move}
            onPointerUp={drop}
            onPointerCancel={drop}
            onLostPointerCapture={drop}
          >
            {rows.map((n, at) => {
              const amount = doseOf(draft, recipe, n);
              const turn = turns.indexOf(n);
              return (
                <tr key={n} data-dose={n} data-dragging={dragging === n ? "" : undefined}>
                  <td>
                    <span className="res-order">
                      <span
                        className="res-grip"
                        aria-hidden="true"
                        title="Drag to reorder"
                        onPointerDown={(event) => {
                          if (event.button !== 0 || !body.current) return;
                          event.preventDefault();
                          body.current.setPointerCapture(event.pointerId);
                          setDragging(n);
                        }}
                      >
                        <GripVertical size={18} />
                      </span>
                      {turn >= 0 ? (
                        <span className="res-doser-position" title="Its turn in this recipe">
                          {turn + 1}
                        </span>
                      ) : (
                        <span className="res-doser-position res-unused" title="Doses nothing">
                          –
                        </span>
                      )}
                    </span>
                  </td>
                  <td>
                    {n}
                    {!mapped.includes(n) && (
                      <Pill tone="warn" className="pill res-unmapped">
                        No switch
                      </Pill>
                    )}
                  </td>
                  <td>
                    <Input
                      aria-label={`Doser ${n} nutrient`}
                      list={`${listId}-nutrients`}
                      value={dose(n).label}
                      maxLength={40}
                      placeholder="Nothing"
                      onChange={(event) => setDose(n, { label: event.target.value })}
                    />
                  </td>
                  <td>
                    <Input
                      aria-label={`Doser ${n} parts`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={Number.isFinite(dose(n).parts) ? String(dose(n).parts) : ""}
                      onChange={(event) =>
                        setDose(n, {
                          parts: event.target.value === "" ? NaN : Number(event.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="numeric">
                    {amount.ml > 0 ? number(amount.ml, 0) : "—"}
                    {amount.ml > 0 && <span className="unit"> mL</span>}
                  </td>
                  <td className="numeric">{amount.ml > 0 ? duration(amount.seconds) : "—"}</td>
                  <td>
                    <span className="res-doser-move">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Move doser ${n} earlier`}
                        disabled={at === 0}
                        onClick={() => place(moveTo(rows, at, at - 1), n)}
                      >
                        <ArrowUp size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Move doser ${n} later`}
                        disabled={at === rows.length - 1}
                        onClick={() => place(moveTo(rows, at, at + 1), n)}
                      >
                        <ArrowDown size={16} />
                      </Button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small res-recipe-total">
        {Number.isFinite(total) ? number(total, 2) : "—"} mL per litre · {number(batch, 0)} mL in a{" "}
        {number(draft.batch_l, 1)} L batch · dosed in the order above: drag a row by its handle, or
        use its arrows
      </p>
      <div className="res-recipe-ec">
        <div>
          <Label htmlFor={`${id}-ec`}>Feed EC (mS/cm)</Label>
          <RoundedInput
            id={`${id}-ec`}
            min={FEED_EC[0]}
            max={FEED_EC[1]}
            step={0.1}
            value={recipe.ec ?? NaN}
            digits={2}
            placeholder="Not given"
            aria-describedby={`${id}-ec-help`}
            onValue={(ec) => onChange({ ...recipe, ec: Number.isNaN(ec) ? null : ec })}
          />
        </div>
        <p id={`${id}-ec-help`} className="muted small">
          What it mixes to: measure it once mixed. The controller flushes or dilutes only a
          substrate saltier than its feed, and without this counts the feed as 3.0 mS/cm.
        </p>
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </fieldset>
  );
}

/** "Mon 5 Oct", for a day (YYYY-MM-DD). */
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/** The feed schedule: each week of the grow's recipe, from the day Week 1 starts (feed.py). Strains
 * differ, so the weeks are as many as the grow needs; after the last, its recipe carries on. */
function FeedSchedulePanel({
  draft,
  today,
  onChange,
}: {
  draft: FeedDraft;
  today: string;
  onChange: (next: FeedDraft) => void;
}) {
  const id = useId();
  const { start, weeks } = draft.schedule;
  const recipes = draft.recipes;
  const name = (recipe: string | null) => recipes.find((r) => r.id === recipe)?.name || "no recipe";
  // A colour for each recipe, kept clear of red, amber and green (they mean state).
  const tone = (recipe: string) =>
    Math.max(
      0,
      recipes.findIndex((r) => r.id === recipe),
    ) % 6;
  const now = scheduleWeek(draft, today);
  const held = heldUntil(draft, today);
  const setSchedule = (change: Partial<FeedDraft["schedule"]>) =>
    onChange({ ...draft, schedule: { ...draft.schedule, ...change } });
  const count = (wanted: number) => {
    if (!Number.isFinite(wanted)) return;
    const target = Math.max(0, Math.min(MAX_WEEKS, Math.round(wanted)));
    // A week added doses what the last one did; the first, the stage in use.
    const fill = weeks[weeks.length - 1] ?? inUse(draft, today) ?? recipes[0]?.id;
    if (target > weeks.length && !fill) return;
    setSchedule({
      weeks:
        target > weeks.length
          ? [...weeks, ...Array<string>(target - weeks.length).fill(fill!)]
          : weeks.slice(0, target),
    });
  };
  const next = now ? weeks[Math.min(now.week, weeks.length - 1)] : null;
  const status = !weeks.length
    ? "No schedule: the stage in use is the one picked by hand. Add weeks to start one."
    : !start
      ? "Set the day Week 1 starts on to run it."
      : !now
        ? `Starts on ${dayLabel(start)} with ${name(weeks[0])}. Until then, the stage is the one picked by hand.`
        : held
          ? `This week ${name(draft.stage)} is held by hand, until Week ${now.week + 1} starts on ${dayLabel(held)}; then the schedule's ${name(next)} takes over again. If you don't want the scheduled recipe, remove the schedule.`
          : now.week < weeks.length
            ? `This week: Week ${now.week} of ${weeks.length}, ${name(now.recipe)}. Week ${now.week + 1} (${name(weeks[now.week])}) starts on ${dayLabel(weekStarts(draft, now.week + 1))}.`
            : now.week === weeks.length
              ? `This week: Week ${now.week} of ${weeks.length}, ${name(now.recipe)}. After it, ${name(now.recipe)} carries on.`
              : `Week ${now.week}: the schedule's ${weeks.length} weeks are done, and ${name(now.recipe)} carries on.`;
  return (
    <section className="panel workspace-card res-schedule" data-feed-schedule>
      <div className="workspace-section-heading">
        <div>
          <h2>Feed schedule</h2>
          <p className="muted small">
            Each week of the grow doses its own recipe, from the day Week 1 starts; after the last
            week, its recipe carries on. Strains differ: give this grow as many weeks as it needs.
          </p>
        </div>
        {!!weeks.length && (
          <Button variant="outline" onClick={() => onChange(removeSchedule(draft, today))}>
            Remove the schedule
          </Button>
        )}
      </div>
      {!recipes.length ? (
        <p className="muted">Add a feed recipe below first: each week doses one.</p>
      ) : (
        <>
          <div className="res-schedule-controls">
            <div>
              <Label htmlFor={`${id}-start`}>Week 1 starts on</Label>
              <Input
                id={`${id}-start`}
                type="date"
                value={start ?? ""}
                onChange={(event) => setSchedule({ start: event.target.value || null })}
              />
            </div>
            <div>
              <Label htmlFor={`${id}-weeks`}>Weeks</Label>
              <div className="res-week-count">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="One week fewer"
                  disabled={!weeks.length}
                  onClick={() => count(weeks.length - 1)}
                >
                  <Minus size={16} />
                </Button>
                <Input
                  id={`${id}-weeks`}
                  type="number"
                  min={0}
                  max={MAX_WEEKS}
                  step={1}
                  value={String(weeks.length)}
                  onChange={(event) => count(Number(event.target.value))}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="One more week"
                  disabled={weeks.length >= MAX_WEEKS}
                  onClick={() => count(weeks.length + 1)}
                >
                  <Plus size={16} />
                </Button>
              </div>
            </div>
          </div>
          {!!weeks.length && (
            <div
              className="res-weeks-scroll"
              tabIndex={0}
              role="region"
              aria-label="The feed schedule's weeks"
            >
              <ol className="res-weeks">
                {weeks.map((recipe, index) => {
                  const week = index + 1;
                  const current =
                    !!now &&
                    (now.week === week || (now.week > weeks.length && week === weeks.length));
                  return (
                    <li
                      key={index}
                      className="res-week"
                      data-week={week}
                      data-tone={tone(recipe)}
                      data-now={current ? "" : undefined}
                    >
                      <Label htmlFor={`${id}-week-${week}`}>
                        Week {week}
                        {current && <span className="res-week-now"> · now</span>}
                      </Label>
                      {start && (
                        <small className="muted">{dayLabel(weekStarts(draft, week))}</small>
                      )}
                      <select
                        id={`${id}-week-${week}`}
                        className="res-select"
                        value={recipe}
                        onChange={(event) =>
                          setSchedule({
                            weeks: weeks.map((item, at) =>
                              at === index ? event.target.value : item,
                            ),
                          })
                        }
                      >
                        {!recipes.some((r) => r.id === recipe) && (
                          <option value={recipe}>Removed recipe</option>
                        )}
                        {recipes.map((r, at) => (
                          <option key={r.id} value={r.id}>
                            {r.name || `Recipe ${at + 1}`}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          <p className="muted small res-schedule-status" data-schedule-status>
            {status}
          </p>
        </>
      )}
    </section>
  );
}

export function Reservoir({
  controller,
  navigate,
  onDirtyChange,
  view = "reservoir",
}: {
  controller: Controller;
  navigate: (page: Page) => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Feed › Reservoir (batches, the schedule, dosers) or Feed › Recipes: one draft, one save. */
  view?: "reservoir" | "recipes";
}) {
  const [doc, setDoc] = useState<FeedDocument | null>(null);
  const [draft, setDraft] = useState<FeedDraft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const listId = useId();
  // What a new feed recipe starts from (a template's id, or "" for a blank one), and what the last one
  // added, or a recipe file that could not be, said.
  const [template, setTemplate] = useState("");
  const [added, setAdded] = useState<{ text: string; error: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let current = true;
    setDoc(null);
    setDraft(null);
    setError("");
    controller
      .operator<FeedDocument>("feed_get")
      .then((result) => {
        if (!current) return;
        setDoc(result);
        setDraft(draftOf(result));
      })
      .catch((err) => current && setError(errorText(err)));
    return () => {
      current = false;
    };
  }, [controller.roomId, controller.connection]);
  const dirty = !!doc && !!draft && JSON.stringify(draft) !== JSON.stringify(draftOf(doc));
  useLayoutEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const attributes = descriptor(controller.states, controller.room.room)?.attributes ?? {};
  const reservoir = RESERVOIR_KEYS.some((key) => attributes[key]);
  // A reminder to refill it by hand can come only while automatic refills don't keep it up.
  const reminds = !(canRefill(attributes) && controller.room.autoBatches.enabled === true);
  const status = readBatchStatus(controller.states, controller.room.room.prefix);
  const sensor = attributes.reservoir_distance_sensor;
  // Once the controller reports, its reading is the one: none there (the sensor reads nothing to it)
  // is none here, whatever the sensor shows now.
  const level = status
    ? status.levelMm
    : typeof sensor === "string" && sensor
      ? levelMm(controller.states[sensor])
      : null;
  const mapped = doc ? mappedNumbers(doc.mapped) : [];
  const errors = draft && doc ? draftErrors(draft, doc.max_recipes) : [];
  const today = localDay();
  const preview = draft ? planOf(draft, mapped, today) : null;
  // The stage in use today: the feed schedule's this week, or the one picked by hand.
  const using = draft ? inUse(draft, today) : null;
  const stage = draft?.recipes.find((r) => r.id === using);
  const week = draft ? scheduleWeek(draft, today) : null;
  const holding = draft ? heldUntil(draft, today) : null;
  const full = !doc || !draft || draft.recipes.length >= doc.max_recipes;

  /** A new feed recipe: blank (named for the next stage), or a template's or a recipe file's, each
   * nutrient on the doser that carries it, saying where any went that no recipe here names. */
  function add(source: PortableRecipe | null) {
    if (!draft || full) return;
    if (!source) {
      const name =
        STAGE_NAMES.find(
          (stageName) =>
            !draft.recipes.some((r) => r.name.trim().toLowerCase() === stageName.toLowerCase()),
        ) ?? "";
      setDraft({ ...draft, recipes: [...draft.recipes, newRecipe(draft, mapped, name)] });
      setAdded(null);
      return;
    }
    const { recipe, placed, unplaced } = placeRecipe(source, draft, mapped);
    setDraft({ ...draft, recipes: [...draft.recipes, recipe] });
    setAdded({ text: placedNote(recipe.name, placed, unplaced), error: false });
  }
  async function importFile(chosen: File | undefined) {
    if (!chosen) return;
    try {
      add(importRecipe(await chosen.text()));
    } catch (err) {
      setAdded({ text: errorText(err), error: true });
    } finally {
      if (file.current) file.current.value = "";
    }
  }

  async function save() {
    if (!doc || !draft) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await controller.operator<FeedDocument>("feed_save", {
        expected_revision: doc.revision,
        document: documentOf(draft),
      });
      setDoc(result);
      setDraft(draftOf(result));
      setNotice("Saved. The controller app runs the next batch with these settings.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  const setting = (key: keyof FeedSettings) => {
    const [label, unit, low, high, whole] = SETTINGS[key];
    const value = draft![key];
    return (
      <div key={key} className="res-setting">
        <Label htmlFor={`${listId}-${key}`}>
          {label} ({unit})
        </Label>
        <Input
          id={`${listId}-${key}`}
          type="number"
          min={low}
          max={high}
          step={whole ? 1 : 0.1}
          value={Number.isFinite(value) ? String(value) : ""}
          onChange={(event) =>
            setDraft({
              ...draft!,
              [key]: event.target.value === "" ? NaN : Number(event.target.value),
            })
          }
        />
        <small className="muted">
          {unit === "s" && Number.isFinite(value) && value >= 60 ? `${duration(value)}. ` : ""}
          {HINTS[key]}
        </small>
        {key === "remind_pct" && value > 0 && value <= draft!.min_pct && (
          <small className="res-setting-note" data-remind-note>
            At or under the {number(draft!.min_pct, 0)}% minimum, where watering waits for a refill:
            set it higher to be reminded first.
          </small>
        )}
        {(key === "empty_mm" || key === "full_mm") && level !== null && (
          <Button
            type="button"
            variant="link"
            className="inline-link"
            onClick={() => setDraft({ ...draft!, [key]: Math.round(level) })}
          >
            Use the reading now ({number(level, 0)} mm)
          </Button>
        )}
      </div>
    );
  };
  const rows = (recipe: FeedRecipe) => {
    const used = Object.entries(recipe.doses)
      .filter(([n, dose]) => !mapped.includes(Number(n)) && (dose.parts > 0 || dose.label))
      .map(([n]) => Number(n));
    return [...doserOrder(recipe.order ?? draft!.order, mapped), ...used.sort((a, b) => a - b)];
  };
  const pct = status
    ? status.levelPct
    : doc
      ? levelPct(level, doc.plan.full_mm ?? 0, doc.plan.empty_mm)
      : null;

  return (
    <>
      <Heading title={view === "recipes" ? "Feed recipes" : "Reservoir"} />
      {error && (
        <p className="workspace-message error" role="alert">
          {error}
        </p>
      )}
      {doc?.error && (
        <p className="workspace-message error" role="alert">
          {doc.error}
        </p>
      )}
      {notice && (
        <p className="workspace-message" role="status">
          {notice}
        </p>
      )}
      {!doc && !error && <p className="muted">Loading the reservoir…</p>}
      {doc && !reservoir && !mapped.length && (
        <Empty
          title="No reservoir mapped"
          detail="Map this room's reservoir level sensor, its fresh-water and recirculation solenoids and up to six dosers in Settings → Rooms & hardware. The controller app then refills the reservoir, mixes and doses each batch."
          action={<Button onClick={() => navigate("setup")}>Map them in Rooms & hardware</Button>}
        />
      )}
      {doc && draft && (reservoir || !!mapped.length) && (
        <>
          {view === "reservoir" && (
            <>
              <BatchPanel
                controller={controller}
                doc={doc}
                status={status}
                level={level}
                pct={pct}
                mapped={reservoir}
                refillable={canRefill(attributes)}
              />
              <TankStatus controller={controller} onConfigure={() => navigate("setup")} />
              <FeedSchedulePanel draft={draft} today={today} onChange={setDraft} />
              <div className="res-columns">
                <section className="panel workspace-card res-stage">
                  <h2>Feed stage</h2>
                  <p className="muted small">
                    The recipe the next batch mixes: the feed schedule&apos;s this week, or one
                    picked here. Swap the bottles on the dosers if that stage uses other nutrients.
                  </p>
                  <Label htmlFor={`${listId}-stage`}>Stage in use</Label>
                  <select
                    id={`${listId}-stage`}
                    className="res-select"
                    value={using ?? ""}
                    onChange={(event) =>
                      setDraft(pickStage(draft, event.target.value || null, today))
                    }
                  >
                    <option value="">None: no batches</option>
                    {draft.recipes.map((recipe, index) => (
                      <option key={recipe.id} value={recipe.id}>
                        {recipe.name || `Recipe ${index + 1}`}
                      </option>
                    ))}
                  </select>
                  {week &&
                    (holding ? (
                      <p className="workspace-message" data-stage-held>
                        Held by hand only until Week {week.week + 1} starts on {dayLabel(holding)};
                        then the feed schedule takes over again. If you don&apos;t want the
                        scheduled recipe, remove the schedule.
                      </p>
                    ) : (
                      <p className="muted small" data-stage-source>
                        From the feed schedule: Week {week.week}. Another picked here holds only
                        until the schedule&apos;s next week starts, on{" "}
                        {dayLabel(weekStarts(draft, week.week + 1))}.
                      </p>
                    ))}
                  {preview?.problem ? (
                    <p className="workspace-message" data-feed-problem>
                      {preview.problem}
                    </p>
                  ) : (
                    preview && (
                      <table className="data-table res-plan" aria-label="The next batch's doses">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Nutrient</th>
                            <th className="numeric">Dose</th>
                            <th className="numeric">Runs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.doses.map((dose, index) => (
                            <tr key={dose.doser}>
                              <td>{index + 1}</td>
                              <td>
                                {dose.label} <span className="muted small">doser {dose.doser}</span>
                              </td>
                              <td className="numeric">
                                {number(dose.ml, 0)}
                                <span className="unit"> mL</span>
                              </td>
                              <td className="numeric">{duration(dose.seconds)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  )}
                </section>
                <section className="panel workspace-card res-settings">
                  <h2>Batch</h2>
                  <div className="res-setting-grid">
                    {(Object.keys(SETTINGS) as (keyof FeedSettings)[])
                      .filter((key) => key !== "remind_pct" || reminds)
                      .map(setting)}
                  </div>
                </section>
              </div>
              <section className="panel workspace-card">
                <div className="res-dosers-head">
                  <h2>Dosers</h2>
                  {!!mapped.length && (
                    <Popover.Root>
                      <Popover.Trigger asChild>
                        <button
                          type="button"
                          className="setting-help-trigger"
                          aria-label="About the dosers"
                        >
                          <CircleHelp size={15} aria-hidden="true" />
                        </button>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content
                          className="setting-help"
                          side="bottom"
                          align="start"
                          sideOffset={6}
                          collisionPadding={12}
                        >
                          <p>Each card shows what its doser pumps in the feed stage in use.</p>
                          <p>
                            Flow is how many mL the doser pumps a minute, as calibrated on the doser
                            itself. The controller uses it to work out how long to run the doser for
                            each dose.
                          </p>
                          <p>The order the dosers run in is set in each feed recipe.</p>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  )}
                </div>
                {mapped.length ? (
                  <DoserFlows
                    draft={draft}
                    mapped={mapped}
                    entities={doc.mapped}
                    stage={stage}
                    onChange={setDraft}
                  />
                ) : (
                  <p className="muted">
                    No doser is mapped.{" "}
                    <Button
                      variant="link"
                      className="inline-link"
                      onClick={() => navigate("setup")}
                    >
                      Map them in Rooms & hardware
                    </Button>
                    .
                  </p>
                )}
              </section>
            </>
          )}
          {view === "recipes" && (
            <section className="res-recipes" aria-labelledby={`${listId}-recipes`}>
              <div className="workspace-section-heading">
                <div>
                  <h2 id={`${listId}-recipes`}>Feed recipes</h2>
                  <p className="muted small">
                    One per growth stage. Parts are the ratio, as on the nutrient chart (Athena
                    Flower is 3 Core : 5 Bloom : 1 Balance : 0.5 Cleanse); the strength is how many
                    mL per litre one part is. Each nutrient is the bottle on that doser in that
                    stage.
                  </p>
                </div>
                <div className="res-recipes-actions">
                  <Label htmlFor={`${listId}-template`} className="sr-only">
                    Start from
                  </Label>
                  <select
                    id={`${listId}-template`}
                    className="res-select"
                    value={template}
                    onChange={(event) => setTemplate(event.target.value)}
                  >
                    <option value="">Blank recipe</option>
                    {TEMPLATE_GROUPS.map(({ group, templates }) => (
                      <optgroup key={group} label={group}>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    disabled={full}
                    onClick={() => add(TEMPLATES.find((t) => t.id === template) ?? null)}
                  >
                    <Plus size={16} /> Add a feed recipe
                  </Button>
                  <Button variant="outline" disabled={full} onClick={() => file.current?.click()}>
                    <Upload size={16} /> Import recipe file
                  </Button>
                  <input
                    ref={file}
                    className="sr-only"
                    type="file"
                    accept="application/json,.json"
                    aria-label="Import a feed recipe file"
                    tabIndex={-1}
                    onChange={(event) => void importFile(event.target.files?.[0])}
                  />
                </div>
              </div>
              {added && (
                <p
                  className={`workspace-message${added.error ? " error" : ""}`}
                  role={added.error ? "alert" : "status"}
                  data-recipe-added
                >
                  {added.text}
                </p>
              )}
              <datalist id={`${listId}-stages`}>
                {STAGE_NAMES.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <datalist id={`${listId}-nutrients`}>
                {[...new Set(Object.values(NUTRIENT_LINES).flat())].map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {!draft.recipes.length && (
                <p className="muted">No feed recipes yet: add one for each stage you feed.</p>
              )}
              {draft.recipes.map((recipe, index) => (
                <RecipeCard
                  key={recipe.id || index}
                  draft={draft}
                  recipe={recipe}
                  index={index}
                  rows={rows(recipe)}
                  mapped={mapped}
                  listId={listId}
                  onChange={(next) =>
                    setDraft({
                      ...draft,
                      recipes: draft.recipes.map((r, i) => (i === index ? next : r)),
                    })
                  }
                  onRemove={() =>
                    setDraft({
                      ...draft,
                      recipes: draft.recipes.filter((_, i) => i !== index),
                      stage: draft.stage === recipe.id ? null : draft.stage,
                    })
                  }
                />
              ))}
            </section>
          )}
          {dirty && (
            <div className="res-savebar" role="region" aria-label="Unsaved changes">
              {!!errors.length && (
                <ul className="workspace-message error" role="alert">
                  {errors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              <div className="res-savebar-row">
                <span>Unsaved changes</span>
                <Button variant="ghost" disabled={busy} onClick={() => setDraft(draftOf(doc))}>
                  Discard
                </Button>
                <Button disabled={busy || !!errors.length || !!doc.error} onClick={save}>
                  {busy && <LoaderCircle className="spin" size={16} />} Save
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
